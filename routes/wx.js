const express = require('express');
const router = express.Router();
const axios = require('axios');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db');
const multer = require('multer');
const upload = multer();
const { uploadToOSS } = require('../config/oss');
const OcrClient = require('../utils/ocrClient');
const Dytnsapi20200217 = require('@alicloud/dytnsapi20200217');
const OpenApi = require('@alicloud/openapi-client');
const Util = require('@alicloud/tea-util');
const Credential = require('@alicloud/credentials');
const sharp = require('sharp');
const redisClient = require('../utils/redisClient');

// 新增：MD5加密函数
const crypto = require('crypto');
function md5(str) {
    return crypto.createHash('md5').update(str).digest('hex');
}
// 新增：生成随机盐
function generateSalt(length = 16) {
    return crypto.randomBytes(length).toString('hex').slice(0, length);
}
// 新增：多次MD5加盐加密
function md5WithSalt(password, salt, times = 3) {
    let hash = password + salt;
    for (let i = 0; i < times; i++) {
        hash = crypto.createHash('md5').update(hash).digest('hex');
    }
    return hash;
}

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
    const cacheKey = `wx:access_token:${appid}`;
    // 先查redis
    const cache = await redisClient.get(cacheKey);
    if (cache) {
        return cache;
    }
    // 没有缓存，请求微信
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`;
    const res = await axios.get(url);
    const access_token = res.data.access_token;
    const expires_in = res.data.expires_in || 7200;
    // 写入redis，提前1分钟过期
    await redisClient.setEx(cacheKey, expires_in - 60, access_token);
    return access_token;
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

    // 从环境变量获取微信小程序配置
    const appid = process.env.WX_APPID;
    const secret = process.env.WX_SECRET;
    
    // 检查必要的环境变量
    if (!appid || !secret) {
        console.error('错误: 缺少必要的微信小程序环境变量 WX_APPID 或 WX_SECRET');
        return res.status(500).json({ error: '服务器配置错误' });
    }

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
        res.status(500).json({ error: '获取手机号服务暂时不可用' });
    }
});

// 小程序登录注册接口
router.post('/login', async (req, res) => {
    const { code } = req.body;
    if (!code) {
        return res.status(400).json({ error: '缺少 code' });
    }

    const appid = process.env.WX_APPID;
    const secret = process.env.WX_SECRET;
    
    // 检查必要的环境变量
    if (!appid || !secret) {
        console.error('错误: 缺少必要的微信小程序环境变量 WX_APPID 或 WX_SECRET');
        return res.status(500).json({ error: '服务器配置错误' });
    }

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
        const token = jwt.sign({ userId: user.id, openid }, process.env.JWT_SECRET, { expiresIn: '7d' });

        // 4. 返回用户信息和 token, 过滤掉敏感字段
        const { session_key: sk, salt, password_hash, ...userProfile } = user;
        res.json({
            token,
            user: userProfile
        });
    } catch (err) {
        res.status(500).json({ error: '获取用户信息服务暂时不可用', detail: err.message });
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
        payload = jwt.verify(token, process.env.JWT_SECRET);
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
        res.status(500).json({ error: '更新用户信息服务暂时不可用' });
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
        payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        return res.status(401).json({ error: 'token无效' });
    }

    try {
        const [users] = await db.query('SELECT * FROM wx_users WHERE id = ?', [payload.userId]);
        if (!users || users.length === 0) {
            return res.status(404).json({ error: '用户不存在' });
        }
        const user = users[0];
        if ('salt' in user) delete user.salt;
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: '获取用户信息服务暂时不可用' });
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
        payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        return res.status(401).json({ error: 'token无效' });
    }

    const { nickname } = req.body;
    const avatarFile = req.file;

    // 2. 校验参数
    if (!nickname && !avatarFile) {
        return res.status(400).json({ error: '昵称和头像至少需要提供一个' });
    }
    
    // 输入验证
    if (nickname && (typeof nickname !== 'string' || nickname.trim().length === 0)) {
        return res.status(400).json({ error: '昵称不能为空' });
    }
    
    if (nickname && nickname.length > 50) {
        return res.status(400).json({ error: '昵称长度不能超过50个字符' });
    }

    try {
        const fieldsToUpdate = {};
        if (nickname) {
            fieldsToUpdate.nickname = nickname.trim();
        }

        // 如果有上传头像，则上传到OSS
        if (avatarFile) {
            const folderPrefix = `avatars/${payload.userId}/`;

            // 1. 转换为 webp 格式
            const webpBuffer = await sharp(avatarFile.buffer).webp().toBuffer();

            // 检查webpBuffer的元数据
            const meta = await sharp(webpBuffer).metadata();
            console.log('webp meta:', meta); // 应该有 format: 'webp'

            // 2. 构造 webp 文件对象
            const webpFile = {
                ...avatarFile,
                buffer: webpBuffer,
                originalname: avatarFile.originalname.replace(/\.[\w]+$/, '.webp'),
                mimetype: 'image/webp'
            };
            console.log('webpFile.originalname:', webpFile.originalname);

            // 3. 上传到OSS
            const ossResult = await uploadToOSS(webpFile, folderPrefix);
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
        res.status(500).json({ error: '更新用户信息服务暂时不可用', detail: err.message });
    }
});

// 获取外部token接口
router.post('/userApi/user/getToken', express.urlencoded({ extended: false }), async (req, res) => {
    const { appInfo } = req.body;
    
    // 输入验证
    if (!appInfo || typeof appInfo !== 'string') {
        return res.status(400).json({ error: '缺少有效的 appInfo 参数' });
    }
    
    if (appInfo.length > 1000) {
        return res.status(400).json({ error: 'appInfo 参数长度不能超过1000个字符' });
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
            error: '获取外部token服务暂时不可用',
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
    
    // 输入验证
    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({
            code: 400,
            status: false,
            message: '请求体格式错误'
        });
    }
    
    // 验证请求体大小
    const bodySize = JSON.stringify(req.body).length;
    if (bodySize > 10000) {
        return res.status(400).json({
            code: 400,
            status: false,
            message: '请求体过大'
        });
    }
    
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
            message: '实名注册服务暂时不可用',
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
    
    // 输入验证
    if (!userId) {
        return res.status(400).json({
            code: 400,
            status: false,
            message: '缺少用户ID'
        });
    }
    
    const cleanUserId = parseInt(userId);
    if (isNaN(cleanUserId) || cleanUserId <= 0) {
        return res.status(400).json({
            code: 400,
            status: false,
            message: '无效的用户ID'
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
        const folderPrefix = `idcards/${cleanUserId}/`;

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
            message: '上传身份证照片服务暂时不可用',
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
    
    // 输入验证
    if (!certName || typeof certName !== 'string' || certName.trim().length === 0) {
        return res.status(400).json({ code: 400, message: '缺少有效的姓名' });
    }
    
    if (!certNo || typeof certNo !== 'string' || certNo.trim().length === 0) {
        return res.status(400).json({ code: 400, message: '缺少有效的身份证号' });
    }
    
    // 验证姓名长度
    if (certName.length > 50) {
        return res.status(400).json({ code: 400, message: '姓名长度不能超过50个字符' });
    }
    
    // 验证身份证号格式
    const idCardRegex = /^[1-9]\d{5}(18|19|20)\d{2}((0[1-9])|(1[0-2]))(([0-2][1-9])|10|20|30|31)\d{3}[0-9Xx]$/;
    if (!idCardRegex.test(certNo)) {
        return res.status(400).json({ code: 400, message: '身份证号格式不正确' });
    }
    
    // 清理输入
    const cleanCertName = certName.trim();
    const cleanCertNo = certNo.trim();

    try {
        const client = createDytnsClient();
        const request = new Dytnsapi20200217.CertNoTwoElementVerificationRequest({
            certName: cleanCertName,
            certNo: cleanCertNo
        });
        const runtime = new Util.RuntimeOptions({});
        
        const response = await client.certNoTwoElementVerificationWithOptions(request, runtime);
        res.json(response.body);
    } catch (err) {
        console.error('二要素核验失败:', err);
        res.status(500).json({ 
            code: 500, 
            message: '身份证核验服务暂时不可用', 
            detail: err.message,
            recommend: err.data?.Recommend 
        });
    }
});

// 获取微信小程序字体文件链接
router.get('/font-url', (req, res) => {
    // 这里可以根据需要返回不同字体，这里写死一个示例
    res.json({
        url: 'https://wx.oss.2000gallery.art/font/SF-Pro.ttf'
    });
});

// 设置用户密码接口
router.post('/setPassword', async (req, res) => {
    // 解析 token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: '未登录' });
    }
    const token = authHeader.replace('Bearer ', '');
    let payload;
    try {
        payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        return res.status(401).json({ error: 'token无效' });
    }

    const { password } = req.body;
    
    // 输入验证
    if (!password || typeof password !== 'string') {
        return res.status(400).json({ error: '缺少密码参数' });
    }
    
    if (password.length < 6) {
        return res.status(400).json({ error: '密码长度至少6位' });
    }
    
    if (password.length > 50) {
        return res.status(400).json({ error: '密码长度不能超过50位' });
    }
    
    // 验证密码复杂度
    const passwordRegex = /^(?=.*[a-zA-Z])(?=.*\d)[a-zA-Z\d@#$%^&+=]{6,}$/;
    if (!passwordRegex.test(password)) {
        return res.status(400).json({ error: '密码必须包含字母和数字' });
    }

    try {
        // 检查用户是否存在
        const [users] = await db.query('SELECT id FROM wx_users WHERE id = ?', [payload.userId]);
        if (users.length === 0) {
            return res.status(404).json({ error: '用户不存在' });
        }

        // 检查是否已经设置过密码
        const [existingUser] = await db.query('SELECT password_hash FROM wx_users WHERE id = ?', [payload.userId]);
        if (existingUser[0].password_hash) {
            return res.status(400).json({ error: '密码已经设置过，如需修改请使用修改密码接口' });
        }

        // 生成盐
        const salt = generateSalt(16);
        // 多次MD5加密
        const passwordHash = md5WithSalt(password, salt, 3);

        // 更新用户密码和盐
        await db.query('UPDATE wx_users SET password_hash = ?, salt = ? WHERE id = ?', [passwordHash, salt, payload.userId]);

        res.json({
            success: true,
            message: '密码设置成功'
        });
    } catch (err) {
        console.error('设置密码失败:', err);
        res.status(500).json({ error: '设置密码服务暂时不可用', detail: err.message });
    }
});

// 修改用户密码接口
router.post('/changePassword', async (req, res) => {
    // 解析 token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: '未登录' });
    }
    const token = authHeader.replace('Bearer ', '');
    let payload;
    try {
        payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        return res.status(401).json({ error: 'token无效' });
    }

    const { oldPassword, newPassword } = req.body;
    
    // 输入验证
    if (!oldPassword || typeof oldPassword !== 'string') {
        return res.status(400).json({ error: '缺少旧密码参数' });
    }
    
    if (!newPassword || typeof newPassword !== 'string') {
        return res.status(400).json({ error: '缺少新密码参数' });
    }
    
    if (newPassword.length < 6) {
        return res.status(400).json({ error: '新密码长度至少6位' });
    }
    
    if (newPassword.length > 50) {
        return res.status(400).json({ error: '新密码长度不能超过50位' });
    }
    
    // 验证新密码复杂度
    const passwordRegex = /^(?=.*[a-zA-Z])(?=.*\d)[a-zA-Z\d@#$%^&+=]{6,}$/;
    if (!passwordRegex.test(newPassword)) {
        return res.status(400).json({ error: '新密码必须包含字母和数字' });
    }
    
    // 验证新旧密码不能相同
    if (oldPassword === newPassword) {
        return res.status(400).json({ error: '新密码不能与旧密码相同' });
    }

    try {
        // 检查用户是否存在并获取当前密码和盐
        const [users] = await db.query('SELECT password_hash, salt FROM wx_users WHERE id = ?', [payload.userId]);
        if (users.length === 0) {
            return res.status(404).json({ error: '用户不存在' });
        }

        const user = users[0];
        
        // 检查是否已经设置过密码
        if (!user.password_hash) {
            return res.status(400).json({ error: '用户尚未设置密码，请先设置密码' });
        }

        // 验证旧密码（多次MD5+盐）
        const isValidOldPassword = (md5WithSalt(oldPassword, user.salt, 3) === user.password_hash);
        if (!isValidOldPassword) {
            return res.status(400).json({ error: '旧密码错误' });
        }

        // 生成新盐
        const newSalt = generateSalt(16);
        // 多次MD5加密新密码
        const newPasswordHash = md5WithSalt(newPassword, newSalt, 3);

        // 更新用户密码和盐
        await db.query('UPDATE wx_users SET password_hash = ?, salt = ? WHERE id = ?', [newPasswordHash, newSalt, payload.userId]);

        res.json({
            success: true,
            message: '密码修改成功'
        });
    } catch (err) {
        console.error('修改密码失败:', err);
        res.status(500).json({ error: '修改密码服务暂时不可用', detail: err.message });
    }
});

// 验证用户密码接口
router.post('/verifyPassword', async (req, res) => {
    // 解析 token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: '未登录' });
    }
    const token = authHeader.replace('Bearer ', '');
    let payload;
    try {
        payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        return res.status(401).json({ error: 'token无效' });
    }

    const { password } = req.body;
    if (!password) {
        return res.status(400).json({ error: '缺少密码参数' });
    }

    try {
        // 检查用户是否存在并获取密码和盐
        const [users] = await db.query('SELECT password_hash, salt FROM wx_users WHERE id = ?', [payload.userId]);
        if (users.length === 0) {
            return res.status(404).json({ error: '用户不存在' });
        }

        const user = users[0];
        
        // 检查是否已经设置过密码
        if (!user.password_hash) {
            return res.status(400).json({ error: '用户尚未设置密码' });
        }

        // 验证密码（多次MD5+盐）
        const isValidPassword = (md5WithSalt(password, user.salt, 3) === user.password_hash);
        
        res.json({
            success: true,
            isValid: isValidPassword,
            message: isValidPassword ? '密码验证成功' : '密码错误'
        });
    } catch (err) {
        console.error('验证密码失败:', err);
        res.status(500).json({ error: '验证密码服务暂时不可用', detail: err.message });
    }
});

module.exports = router; 