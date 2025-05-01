const jwt = require('jsonwebtoken');
const axios = require('axios');
const db = require('../../db');

class UserService {
  static async login(code) {
    if (!code) {
      throw new Error('缺少 code');
    }

    const appid = 'wx96a502c78c9156d0';
    const secret = 'bf47d45e6b0a96b1d1b73b186860c4cb';

    // 1. 用 code 换 openid 和 session_key
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${code}&grant_type=authorization_code`;
    const wxRes = await axios.get(url);
    const { openid, session_key } = wxRes.data;

    if (!openid) {
      throw new Error('微信登录失败');
    }

    // 2. 在数据库中查找或注册用户
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

    // 3. 生成 token
    const token = await this.generateToken(user.id, openid);

    return {
      token,
      user: {
        id: user.id,
        openid
      }
    };
  }

  static async getPhoneNumber(code) {
    if (!code) {
      throw new Error('缺少 code');
    }

    const appid = 'wx96a502c78c9156d0';
    const secret = 'bf47d45e6b0a96b1d1b73b186860c4cb';

    // 1. 获取 access_token
    const access_token = await this.getAccessToken(appid, secret);
    
    // 2. 用 code 换手机号
    const result = await this.getPhoneNumberFromWx(code, access_token);
    if (result.errcode === 0) {
      return result.phone_info.phoneNumber;
    } else {
      throw new Error(result.errmsg);
    }
  }

  static async getAccessToken(appid, secret) {
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`;
    const res = await axios.get(url);
    return res.data.access_token;
  }

  static async getPhoneNumberFromWx(code, access_token) {
    const url = `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${access_token}`;
    const res = await axios.post(url, { code });
    return res.data;
  }

  static async bindUserInfo(userId, userData) {
    const { phone, nickname, avatar } = userData;
    if (!phone && !nickname && !avatar) {
      throw new Error('缺少参数');
    }

    const updateFields = [];
    const values = [];
    
    if (phone) {
      updateFields.push('phone = ?');
      values.push(phone);
    }
    if (nickname) {
      updateFields.push('nickname = ?');
      values.push(nickname);
    }
    if (avatar) {
      updateFields.push('avatar = ?');
      values.push(avatar);
    }

    values.push(userId);
    
    const query = `
      UPDATE wx_users 
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `;

    await db.query(query, values);
    return { success: true };
  }

  static async getUserInfo(userId) {
    const [users] = await db.query('SELECT * FROM wx_users WHERE id = ?', [userId]);
    if (!users || users.length === 0) {
      throw new Error('用户不存在');
    }
    return users[0];
  }

  static async generateToken(userId, openid) {
    return jwt.sign({ userId, openid }, 'your_jwt_secret', { expiresIn: '7d' });
  }
}

module.exports = UserService; 