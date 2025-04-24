const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const db = require('./db');

// JWT密钥
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// 生成JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '24h' });
};

// 验证token中间件
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: '未提供认证token' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const [users] = await db.query('SELECT * FROM users WHERE id = ?', [decoded.userId]);
    
    if (users.length === 0) {
      return res.status(401).json({ error: '用户不存在' });
    }

    req.user = users[0];
    next();
  } catch (error) {
    return res.status(403).json({ error: '无效的token' });
  }
};

// 检查角色权限中间件
const checkRole = (roles) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: '未认证' });
    }

    const [userRoles] = await db.query(
      'SELECT r.name FROM roles r JOIN users u ON r.id = u.role_id WHERE u.id = ?',
      [req.user.id]
    );

    if (userRoles.length === 0 || !roles.includes(userRoles[0].name)) {
      return res.status(403).json({ error: '权限不足' });
    }

    next();
  };
};

// 注册用户
const register = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { username, email, password } = req.body;

    // 检查用户名和邮箱是否已存在
    const [existingUsers] = await db.query(
      'SELECT * FROM users WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({ error: '用户名或邮箱已存在' });
    }

    // 获取普通用户角色ID
    const [roles] = await db.query('SELECT id FROM roles WHERE name = ?', ['user']);
    if (roles.length === 0) {
      return res.status(500).json({ error: '系统错误：角色不存在' });
    }

    // 加密密码
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 创建用户
    const [result] = await db.query(
      'INSERT INTO users (username, email, password_hash, role_id) VALUES (?, ?, ?, ?)',
      [username, email, passwordHash, roles[0].id]
    );

    res.status(201).json({
      message: '注册成功',
      userId: result.insertId
    });
  } catch (error) {
    console.error('注册失败:', error);
    res.status(500).json({ error: '注册失败' });
  }
};

// 用户登录
const login = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { username, password } = req.body;

    // 查找用户
    const [users] = await db.query(
      'SELECT u.*, r.name as role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.username = ?',
      [username]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const user = users[0];

    // 验证密码
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 检查用户状态
    if (user.status !== 'active') {
      return res.status(403).json({ error: '账户已被禁用' });
    }

    // 生成token
    const token = generateToken(user.id);

    // 更新最后登录时间
    await db.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

    // 创建会话记录
    await db.query(
      'INSERT INTO user_sessions (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))',
      [user.id, token]
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role_name
      }
    });
  } catch (error) {
    console.error('登录失败:', error);
    res.status(500).json({ error: '登录失败' });
  }
};

// 获取当前用户信息
const getCurrentUser = async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT u.id, u.username, u.email, r.name as role FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json(users[0]);
  } catch (error) {
    console.error('获取用户信息失败:', error);
    res.status(500).json({ error: '获取用户信息失败' });
  }
};

// 退出登录
const logout = async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    if (token) {
      await db.query('DELETE FROM user_sessions WHERE token = ?', [token]);
    }
    res.json({ message: '退出成功' });
  } catch (error) {
    console.error('退出失败:', error);
    res.status(500).json({ error: '退出失败' });
  }
};

module.exports = {
  authenticateToken,
  checkRole,
  register,
  login,
  getCurrentUser,
  logout
}; 