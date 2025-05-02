const express = require('express');
const router = express.Router();
const axios = require('axios');
const jwt = require('jsonwebtoken');
const db = require('../db');

// 获取微信 access_token
async function getAccessToken(appid, secret) {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`;
  const res = await axios.get(url);
  return res.data.access_token;
}

// 获取微信用户手机号
async function getPhoneNumberFromWx(code, access_token) {
  const url = `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${access_token}`;
  const res = await axios.post(url, { code });
  return res.data;
}

// 获取手机号接口
router.post('/getPhoneNumber', async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: '缺少 code' });
  }

  const appid = 'wx96a502c78c9156d0';
  const secret = 'bf47d45e6b0a96b1d1b73b186860c4cb';

  try {
    const access_token = await getAccessToken(appid, secret);
    const result = await getPhoneNumberFromWx(code, access_token);
    if (result.errcode === 0) {
      res.json(result);
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
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${code}&grant_type=authorization_code`;
    const wxRes = await axios.get(url);
    const { openid, session_key } = wxRes.data;

    if (!openid) {
      return res.status(400).json({ error: '微信登录失败', detail: wxRes.data });
    }

    let [users] = await db.query('SELECT * FROM wx_users WHERE openid = ?', [openid]);
    let user;
    if (users.length === 0) {
      const [result] = await db.query('INSERT INTO wx_users (openid, session_key) VALUES (?, ?)', [openid, session_key]);
      user = { id: result.insertId, openid, session_key };
    } else {
      await db.query('UPDATE wx_users SET session_key = ? WHERE openid = ?', [session_key, openid]);
      user = users[0];
    }

    const token = jwt.sign({ userId: user.id, openid }, 'your_jwt_secret', { expiresIn: '7d' });

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

// 绑定/更新小程序用户信息
router.post('/bindUserInfo', async (req, res) => {
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

module.exports = router; 