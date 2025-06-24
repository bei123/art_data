const express = require('express');
const router = express.Router();
const axios = require('axios');
const jwt = require('jsonwebtoken');
const db = require('../db');
const multer = require('multer');
const upload = multer();
const { uploadToOSS } = require('../config/oss');
const OcrClient = require('../utils/ocrClient');
const Dytnsapi20200217 = require('@alicloud/dytnsapi20200217');
const OpenApi = require('@alicloud/openapi-client');
const Util = require('@alicloud/tea-util');
const Credential = require('@alicloud/credentials');

// 创建阿里云二要素核验客户端
function createDytnsClient() {
    let credential = new Credential.default();
    let config = new OpenApi.Config({
        credential: credential,
    });
    config.endpoint = 'dytnsapi.aliyuncs.com';
    return new Dytnsapi20200217.default(config);
}

// 微信小程序获取手机号接口
async function getAccessToken(appid, secret) {
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`;
    const res = await axios.get(url);
    return res.data.access_token;
}

async function getPhoneNumberFromWx(code, access_token) {
    const url = `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${access_token}`;
    const res = await axios.post(url, { code });
    return res.data;
}

// 新增：获取手机号接口
router.post('/getPhoneNumber', async (req, res) => {
    const { code } = req.body;
    if (!code) {
        return res.status(400).json({ error: '缺少 code' });
    }

    // 你的微信小程序 appid 和 appsecret
    const appid = 'wx96a502c78c9156d0'; // TODO: 替换为你自己的
    const secret = 'bf47d45e6b0a96b1d1b73b186860c4cb'; // TODO: 替换为你自己的

    try {
        // 1. 获取 access_token
        const access_token = await getAccessToken(appid, secret);
        // 2. 用 code 换手机号
        const result = await getPhoneNumberFromWx(code, access_token);
        if (result.errcode === 0) {
            res.json(result); // result.phone_info.phoneNumber 就是手机号
        } else {
            res.status(400).json({ error: result.errmsg });
        }
    } catch (err) {
        res.status(500).json({ error: '服务器错误' });
    }
});

// 小程序登录注册接口
router.post('/login', async (req, res) => {
    const { code } = req.body;
    if (!code) {
        return res.status(400).json({ error: '缺少 code' });
    }

    const appid = 'wx96a502c78c9156d0';
    const secret = 'bf47d45e6b0a96b1d1b73b186860c4cb';

    try {
        // 1. 用 code 换 openid 和 session_key
        const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${code}&grant_type=authorization_code`;
        const wxRes = await axios.get(url);
        const { openid, session_key } = wxRes.data;

        if (!openid) {
            return res.status(400).json({ error: '微信登录失败', detail: wxRes.data });
        }

        // 2. 在你自己的数据库查找或注册用户（表名改为 wx_users）
        let [users] = await db.query('SELECT * FROM wx_users WHERE openid = ?', [openid]);
        let user;
        if (users.length === 0) {
            // 没有则注册
            const [result] = await db.query('INSERT INTO wx_users (openid, session_key) VALUES (?, ?)', [openid, session_key]);
            user = { id: result.insertId, openid, session_key };
        } else {
            // 有则更新 session_key
            await db.query('UPDATE wx_users SET session_key = ? WHERE openid = ?', [session_key, openid]);
            user = users[0];
        }

        // 3. 生成你自己系统的 token（如 JWT）
        const token = jwt.sign({ userId: user.id, openid }, 'your_jwt_secret', { expiresIn: '7d' });

        // 4. 返回用户信息和 token, 包含用户所有信息，并过滤掉敏感字段
        const { session_key: sk, ...userProfile } = user;
        res.json({
            token,
            user: userProfile
        });
    } catch (err) {
        res.status(500).json({ error: '服务器错误', detail: err.message });
    }
});

// 绑定/更新小程序用户信息（手机号、昵称、头像）
router.post('/bindUserInfo', async (req, res) => {
    // 解析 token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: '未登录' });
    }
    const token = authHeader.replace('Bearer ', '');
    let payload;
    try {
        payload = jwt.verify(token, 'your_jwt_secret');
    } catch (err) {
        return res.status(401).json({ error: 'token无效' });
    }

    const { phone, nickname, avatar } = req.body;
    if (!phone && !nickname && !avatar) {
        return res.status(400).json({ error: '缺少参数' });
    }

    try {
        // 先查询用户，判断是否已存在自定义信息
        const [existingUsers] = await db.query('SELECT nickname, avatar FROM wx_users WHERE id = ?', [payload.userId]);
        if (existingUsers.length === 0) {
            return res.status(404).json({ error: '用户不存在' });
        }
        const existingUser = existingUsers[0];

        // 只更新有传的字段
        const fields = [];
        const values = [];

        // 手机号可以更新
        if (phone) {
            fields.push('phone = ?');
            values.push(phone);
        }
        // 只有当数据库中没有昵称时，才使用微信的昵称进行填充
        if (nickname && !existingUser.nickname) {
            fields.push('nickname = ?');
            values.push(nickname);
        }
        // 只有当数据库中没有头像时，才使用微信的头像进行填充
        if (avatar && !existingUser.avatar) {
            fields.push('avatar = ?');
            values.push(avatar);
        }

        // 如果有需要更新的字段，才执行更新操作
        if (fields.length > 0) {
            values.push(payload.userId);
            const sql = `UPDATE wx_users SET ${fields.join(', ')} WHERE id = ?`;
            await db.query(sql, values);
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: '服务器错误' });
    }
});

// 获取当前小程序用户信息
router.get('/userInfo', async (req, res) => {
    // 解析 token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: '未登录' });
    }
    const token = authHeader.replace('Bearer ', '');
    let payload;
    try {
        payload = jwt.verify(token, 'your_jwt_secret');
    } catch (err) {
        return res.status(401).json({ error: 'token无效' });
    }

    try {
        const [users] = await db.query('SELECT * FROM wx_users WHERE id = ?', [payload.userId]);
        if (!users || users.length === 0) {
            return res.status(404).json({ error: '用户不存在' });
        }
        const user = users[0];
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: '服务器错误' });
    }
});

// 新增：更新用户昵称和头像（支持上传头像到OSS）
router.post('/updateProfile', upload.single('avatar'), async (req, res) => {
    // 1. 验证用户身份
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: '未登录' });
    }
    const token = authHeader.replace('Bearer ', '');
    let payload;
    try {
        payload = jwt.verify(token, 'your_jwt_secret');
    } catch (err) {
        return res.status(401).json({ error: 'token无效' });
    }

    const { nickname } = req.body;
    const avatarFile = req.file;

    // 2. 校验参数
    if (!nickname && !avatarFile) {
        return res.status(400).json({ error: '昵称和头像至少需要提供一个' });
    }

    try {
        const fieldsToUpdate = {};
        if (nickname) {
            fieldsToUpdate.nickname = nickname;
        }

        // 如果有上传头像，则上传到OSS
        if (avatarFile) {
            const folderPrefix = `avatars/${payload.userId}/`;
            const ossResult = await uploadToOSS(avatarFile, folderPrefix);
            fieldsToUpdate.avatar = ossResult.url;
        }

        // 3. 更新数据库
        await db.query('UPDATE wx_users SET ? WHERE id = ?', [fieldsToUpdate, payload.userId]);

        // 4. 查询并返回更新后的用户信息
        const [users] = await db.query('SELECT id, openid, nickname, avatar, phone FROM wx_users WHERE id = ?', [payload.userId]);
        if (users.length === 0) {
            return res.status(404).json({ error: '用户不存在' });
        }

        res.json({
            success: true,
            message: '用户信息更新成功',
            user: users[0]
        });
    } catch (err) {
        console.error('更新用户信息失败:', err);
        res.status(500).json({ error: '服务器错误', detail: err.message });
    }
});

// 获取外部token接口
router.post('/userApi/user/getToken', express.urlencoded({ extended: false }), async (req, res) => {
    const { appInfo } = req.body;
    if (!appInfo) {
        return res.status(400).json({ error: '缺少 appInfo 参数' });
    }

    try {
        // 调用外部API获取token
        const response = await axios.post('https://yapi.licenseinfo.cn/mock/600/userApi/user/getToken', 
            `appInfo=${appInfo}`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        // 直接返回外部API的响应
        res.json(response.data);
    } catch (err) {
        console.error('获取token失败:', err);
        res.status(500).json({ 
            error: '获取token失败',
            detail: err.message 
        });
    }
});

// 实名注册接口
router.post('/userApi/external/user/real_name_registration/simplify/v3', async (req, res) => {
    // 从请求头获取token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ 
            code: 401,
            status: false,
            message: '缺少token' 
        });
    }

    const token = authHeader.replace('Bearer ', '');
    
    try {
        // 调用外部API进行实名注册，带上token
        const response = await axios.post(
            'https://yapi.licenseinfo.cn/mock/600/userApi/external/user/real_name_registration/simplify/v3',
            req.body,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        // 直接返回外部API的响应
        res.json(response.data);
    } catch (err) {
        console.error('实名注册失败:', err);
        res.status(500).json({ 
            code: 500,
            status: false,
            message: '实名注册失败',
            detail: err.message 
        });
    }
});

// 上传身份证照片接口
router.post('/userApi/external/user/upload/idcard', upload.fields([
    { name: 'idCardFront', maxCount: 1 },
    { name: 'idCardBack', maxCount: 1 },
    { name: 'businessLicense', maxCount: 1 }
]), async (req, res) => {
    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({
            code: 400,
            status: false,
            message: '缺少用户ID'
        });
    }

    try {
        const files = req.files;
        const result = {
            idCardFrontUrl: '',
            idCardBackUrl: '',
            businessLicenseUrl: '',
            idCardInfo: null,
            idCardBackInfo: null,
            idCardVerify: null
        };

        // 使用用户ID创建文件夹前缀
        const folderPrefix = `idcards/${userId}/`;

        // 上传身份证正面照片并进行识别
        if (files.idCardFront && files.idCardFront[0]) {
            const frontFile = files.idCardFront[0];
            const frontResult = await uploadToOSS(frontFile, folderPrefix);
            result.idCardFrontUrl = frontResult.url;
            
            // 进行身份证识别
            try {
                const ocrResult = await OcrClient.recognizeIdCard(frontFile.buffer);
                console.log('OCR原始结果:', JSON.stringify(ocrResult, null, 2));
                
                // 解析嵌套的JSON字符串
                let parsedData;
                if (ocrResult && ocrResult.data) {
                    if (typeof ocrResult.data === 'string') {
                        parsedData = JSON.parse(ocrResult.data);
                    } else {
                        parsedData = ocrResult.data;
                    }
                }
                
                // 修正所有 value 字段乱码
                if (parsedData && parsedData.data && parsedData.data.face && Array.isArray(parsedData.data.face.prism_keyValueInfo)) {
                    parsedData.data.face.prism_keyValueInfo.forEach(item => {
                        if (typeof item.value === 'string') {
                            try {
                                // 尝试多种编码方式
                                const encodings = ['utf8', 'gbk', 'gb2312', 'latin1'];
                                for (const encoding of encodings) {
                                    try {
                                        const decoded = Buffer.from(item.value, encoding).toString('utf8');
                                        if (decoded && !decoded.includes('')) {
                                            item.value = decoded;
                                            break;
                                        }
                                    } catch (e) {
                                        continue;
                                    }
                                }
                            } catch (e) {
                                console.error('解码失败:', e);
                            }
                        }
                    });
                }
                
                result.idCardInfo = {
                    ...ocrResult,
                    data: parsedData
                };

                // 自动进行二要素核验
                let certName = '', certNo = '';
                
                // 从prism_keyValueInfo中提取姓名和身份证号
                if (parsedData && parsedData.data && parsedData.data.face && Array.isArray(parsedData.data.face.prism_keyValueInfo)) {
                    const keyValueInfo = parsedData.data.face.prism_keyValueInfo;
                    console.log('解析后的keyValueInfo:', JSON.stringify(keyValueInfo, null, 2));
                    
                    const nameItem = keyValueInfo.find(item => item.key === 'name');
                    const idNumberItem = keyValueInfo.find(item => item.key === 'idNumber');
                    
                    if (nameItem) {
                        certName = nameItem.value;
                        console.log('找到姓名:', certName);
                    }
                    
                    if (idNumberItem) {
                        certNo = idNumberItem.value;
                        console.log('找到身份证号:', certNo);
                    }
                }

                if (certName && certNo) {
                    console.log('开始二要素核验:', { certName, certNo });
                    try {
                        const client = createDytnsClient();
                        const request = new Dytnsapi20200217.CertNoTwoElementVerificationRequest({
                            certName: certName,
                            certNo: certNo,
                            authCode: process.env.ALIYUN_IDCARD_AUTHCODE // 添加AuthCode
                        });
                        const runtime = new Util.RuntimeOptions({});
                        
                        console.log('发送二要素核验请求...');
                        const verifyRes = await client.certNoTwoElementVerificationWithOptions(request, runtime);
                        console.log('二要素核验响应:', verifyRes);
                        result.idCardVerify = verifyRes.body;
                    } catch (verifyErr) {
                        console.error('二要素核验失败:', {
                            error: verifyErr,
                            message: verifyErr.message,
                            recommend: verifyErr.data?.Recommend,
                            stack: verifyErr.stack
                        });
                        result.idCardVerify = { 
                            code: 500, 
                            message: '二要素核验失败', 
                            detail: verifyErr.message,
                            recommend: verifyErr.data?.Recommend 
                        };
                    }
                } else {
                    console.log('无法获取姓名或身份证号:', { 
                        certName, 
                        certNo,
                        parsedData: JSON.stringify(parsedData, null, 2)
                    });
                }
            } catch (ocrError) {
                console.error('身份证识别失败:', {
                    error: ocrError,
                    message: ocrError.message,
                    stack: ocrError.stack
                });
            }
        }

        // 上传身份证背面照片并进行识别
        if (files.idCardBack && files.idCardBack[0]) {
            const backFile = files.idCardBack[0];
            const backResult = await uploadToOSS(backFile, folderPrefix);
            result.idCardBackUrl = backResult.url;

            // 进行身份证背面识别
            try {
                const ocrBackResult = await OcrClient.recognizeIdCard(backFile.buffer);
                if (ocrBackResult && typeof ocrBackResult.data === 'string') {
                    ocrBackResult.data = JSON.parse(ocrBackResult.data);
                    // 修正所有 value 字段乱码
                    if (ocrBackResult.data && ocrBackResult.data.face && Array.isArray(ocrBackResult.data.face.prism_keyValueInfo)) {
                        ocrBackResult.data.face.prism_keyValueInfo.forEach(item => {
                            if (typeof item.value === 'string') {
                                item.value = Buffer.from(item.value, 'latin1').toString('utf8');
                            }
                        });
                    }
                }
                result.idCardBackInfo = ocrBackResult;
            } catch (ocrError) {
                console.error('身份证背面识别失败:', ocrError);
                // 识别失败不影响上传流程
            }
        }

        // 上传营业执照照片（如果有）
        if (files.businessLicense && files.businessLicense[0]) {
            const licenseResult = await uploadToOSS(files.businessLicense[0], folderPrefix);
            result.businessLicenseUrl = licenseResult.url;
        }

        res.json({
            code: 200,
            status: true,
            message: '上传成功',
            data: result
        });
    } catch (err) {
        console.error('上传身份证照片失败:', err);
        res.status(500).json({
            code: 500,
            status: false,
            message: '上传失败',
            detail: err.message
        });
    }
});

// 获取用户IP接口
router.get('/getIp', (req, res) => {
    // 兼容代理、CDN等多种场景
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // 如果是数组，取第一个
    if (Array.isArray(ip)) {
        ip = ip[0];
    }

    // 如果是IPv4映射的IPv6地址（如 ::ffff:127.0.0.1），则清理前缀
    if (ip && typeof ip === 'string' && ip.startsWith('::ffff:')) {
        ip = ip.substring(7);
    }

    res.json({ ip });
});

// 身份证二要素核验接口
router.post('/userApi/external/user/idcard-verify', async (req, res) => {
    const { certName, certNo } = req.body;
    if (!certName || !certNo) {
        return res.status(400).json({ code: 400, message: '缺少姓名或身份证号' });
    }

    try {
        const client = createDytnsClient();
        const request = new Dytnsapi20200217.CertNoTwoElementVerificationRequest({
            certName: certName,
            certNo: certNo
        });
        const runtime = new Util.RuntimeOptions({});
        
        const response = await client.certNoTwoElementVerificationWithOptions(request, runtime);
        res.json(response.body);
    } catch (err) {
        console.error('二要素核验失败:', err);
        res.status(500).json({ 
            code: 500, 
            message: '核验失败', 
            detail: err.message,
            recommend: err.data?.Recommend 
        });
    }
});

module.exports = router; 