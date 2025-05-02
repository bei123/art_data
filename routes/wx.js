const express = require('express');
const router = express.Router();
const axios = require('axios');
const jwt = require('jsonwebtoken');
const db = require('../db');

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
  app.post('/api/wx/getPhoneNumber', async (req, res) => {
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
  app.post('/api/wx/login', async (req, res) => {
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
  app.post('/api/wx/bindUserInfo', async (req, res) => {
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
  app.get('/api/wx/userInfo', async (req, res) => {
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

module.exports = router; 