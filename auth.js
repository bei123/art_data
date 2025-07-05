const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const { pool, query } = require('./db');

// JWT密钥
const JWT_SECRET = process.env.JWT_SECRET;

// 检查必要的环境变量
if (!JWT_SECRET) {
    console.error('错误: 缺少必要的环境变量 JWT_SECRET');
    process.exit(1);
}

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
    const [users] = await query('SELECT * FROM users WHERE id = ?', [decoded.userId]);
    
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

    const [userRoles] = await query(
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
  console.log('收到注册请求:', req.body)
  
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log('验证错误:', errors.array())
    return res.status(400).json({ errors: errors.array() });
  }

  let connection;
  try {
    // 获取数据库连接
    const db = require('./db');
    connection = await db.pool.getConnection();
    await connection.beginTransaction();

    const { username, email, password } = req.body;
    console.log('处理注册数据:', { username, email })

    // 检查用户名和邮箱是否已存在
    const [existingUsers] = await connection.query(
      'SELECT * FROM users WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existingUsers.length > 0) {
      console.log('用户已存在:', existingUsers)
      await connection.rollback();
      return res.status(400).json({ error: '用户名或邮箱已存在' });
    }

    // 检查并获取用户角色ID
    let [roles] = await connection.query('SELECT id FROM roles WHERE name = ?', ['user']);
    
    // 如果角色不存在，创建角色
    if (!roles || roles.length === 0) {
      console.log('创建用户角色');
      const [result] = await connection.query(
        'INSERT INTO roles (name, description) VALUES (?, ?)',
        ['user', '普通用户']
      );
      roles = [{ id: result.insertId }];
    }

    if (!roles[0]?.id) {
      console.error('获取角色ID失败');
      await connection.rollback();
      return res.status(500).json({ error: '系统错误：无法获取角色信息' });
    }

    // 加密密码
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 创建用户
    const [result] = await connection.query(
      'INSERT INTO users (username, email, password_hash, role_id, status) VALUES (?, ?, ?, ?, ?)',
      [username, email, passwordHash, roles[0].id, 'active']
    );

    // 生成token
    const token = generateToken(result.insertId);

    // 创建用户会话
    await connection.query(
      'INSERT INTO user_sessions (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))',
      [result.insertId, token]
    );

    // 提交事务
    await connection.commit();
    
    console.log('用户创建成功:', result.insertId);

    // 返回成功响应
    res.status(200).json({
      success: true,
      message: '注册成功',
      data: {
        userId: result.insertId,
        username,
        email,
        token
      }
    });
  } catch (error) {
    // 回滚事务
    if (connection) {
      await connection.rollback();
    }
    console.error('注册失败:', error);
    res.status(500).json({ 
      success: false,
      error: '注册失败: ' + error.message 
    });
  } finally {
    // 释放连接
    if (connection) {
      connection.release();
    }
  }
};

// 用户登录
const login = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const { username, password } = req.body;

    // 查找用户
    const [users] = await connection.query(
      'SELECT u.*, r.name as role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.username = ?',
      [username]
    );

    if (!users || users.length === 0) {
      await connection.rollback();
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const user = users[0];

    // 验证密码
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      await connection.rollback();
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 检查用户状态
    if (user.status !== 'active') {
      await connection.rollback();
      return res.status(403).json({ error: '账户已被禁用' });
    }

    // 生成token
    const token = generateToken(user.id);

    // 更新最后登录时间
    await connection.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
      [user.id]
    );

    // 创建会话记录
    await connection.query(
      'INSERT INTO user_sessions (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))',
      [user.id, token]
    );

    await connection.commit();

    res.json({
      success: true,
      message: '登录成功',
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role_name
        }
      }
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('登录失败:', error);
    res.status(500).json({ 
      success: false,
      error: '登录失败: ' + error.message 
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// 获取当前用户信息
const getCurrentUser = async (req, res) => {
  try {
    const users = await query(
      'SELECT u.id, u.username, u.email, r.name as role FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json(users[0]);
  } catch (error) {
    console.error('获取用户信息失败:', error);
    res.status(500).json({ error: '获取用户信息失败: ' + error.message });
  }
};

// 退出登录
const logout = async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    if (token) {
      await query('DELETE FROM user_sessions WHERE token = ?', [token]);
    }
    res.json({ message: '退出成功' });
  } catch (error) {
    console.error('退出失败:', error);
    res.status(500).json({ error: '退出失败: ' + error.message });
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