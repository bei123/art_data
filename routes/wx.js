const express = require('express');
const router = express.Router();
const axios = require('axios');
const jwt = require('jsonwebtoken');
const db = require('../db');
const multer = require('multer');
const upload = multer();
const { uploadToOSS } = require('../config/oss');

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

        // 4. 返回用户信息和 token
        res.json({
            token,
            user: {
                id: user.id,
                openid
            }
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
        // 只更新有传的字段
        const fields = [];
        const values = [];
        if (phone) {
            fields.push('phone = ?');
            values.push(phone);
        }
        if (nickname) {
            fields.push('nickname = ?');
            values.push(nickname);
        }
        if (avatar) {
            fields.push('avatar = ?');
            values.push(avatar);
        }
        values.push(payload.userId);

        const sql = `UPDATE wx_users SET ${fields.join(', ')} WHERE id = ?`;
        await db.query(sql, values);

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
    { name: 'idCardFront', maxCount: 1 },  // 身份证正面
    { name: 'idCardBack', maxCount: 1 },   // 身份证背面
    { name: 'businessLicense', maxCount: 1 }  // 营业执照（可选）
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
            businessLicenseUrl: ''
        };

        // 使用用户ID创建文件夹前缀
        const folderPrefix = `idcards/${userId}/`;

        // 上传身份证正面照片
        if (files.idCardFront && files.idCardFront[0]) {
            const frontResult = await uploadToOSS(files.idCardFront[0], folderPrefix);
            result.idCardFrontUrl = frontResult.url;
        }

        // 上传身份证背面照片
        if (files.idCardBack && files.idCardBack[0]) {
            const backResult = await uploadToOSS(files.idCardBack[0], folderPrefix);
            result.idCardBackUrl = backResult.url;
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

module.exports = router; 