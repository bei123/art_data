const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const { pool, query } = require('./db');
const redisClient = require('./utils/redisClient');

// JWT配置
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const REDIS_TOKEN_PREFIX = 'auth:token:';
const REDIS_USER_PREFIX = 'auth:user:';
const REDIS_SESSION_PREFIX = 'auth:session:';

// 检查必要的环境变量
if (!process.env.JWT_SECRET) {
    console.warn('警告: 未设置JWT_SECRET环境变量，使用默认密钥');
}

// 生成JWT token
const generateToken = (userId, role) => {
  return jwt.sign(
    { 
      userId, 
      role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24小时
    }, 
    JWT_SECRET, 
    { expiresIn: JWT_EXPIRES_IN }
  );
};

// 验证token中间件
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      success: false,
      error: '未提供认证token' 
    });
  }

  try {
    // 首先检查Redis中是否存在该token
    const redisKey = `${REDIS_TOKEN_PREFIX}${token}`;
    const cachedUser = await redisClient.get(redisKey);
    
    if (cachedUser) {
      // 从Redis缓存中获取用户信息
      const user = JSON.parse(cachedUser);
      req.user = user;
      req.token = token;
      
      // 更新token的最后访问时间
      await redisClient.setEx(redisKey, 24 * 60 * 60, cachedUser);
      return next();
    }

    // 如果Redis中没有，验证JWT token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // 从数据库获取用户信息
    const [users] = await query(
      'SELECT u.*, r.name as role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ? AND u.status = ?',
      [decoded.userId, 'active']
    );
    
    if (users.length === 0) {
      return res.status(401).json({ 
        success: false,
        error: '用户不存在或已被禁用' 
      });
    }

    const user = users[0];
    
    // 将用户信息存储到Redis中
    const userData = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role_name,
      status: user.status
    };
    
    await redisClient.setEx(redisKey, 24 * 60 * 60, JSON.stringify(userData));
    
    req.user = userData;
    req.token = token;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false,
        error: 'token已过期' 
      });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({ 
        success: false,
        error: '无效的token' 
      });
    }
    console.error('Token验证错误:', error);
    return res.status(500).json({ 
      success: false,
      error: '认证服务错误' 
    });
  }
};

// 检查角色权限中间件
const checkRole = (roles) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false,
        error: '未认证' 
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false,
        error: '权限不足' 
      });
    }

    next();
  };
};

// 检查管理员权限
const requireAdmin = checkRole(['admin', 'super_admin']);

// 注册用户
const register = async (req, res) => {
  console.log('收到注册请求:', req.body);
  
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log('验证错误:', errors.array());
    return res.status(400).json({ 
      success: false,
      errors: errors.array() 
    });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const { username, email, password } = req.body;
    console.log('处理注册数据:', { username, email });

    // 检查用户名和邮箱是否已存在
    const [existingUsers] = await connection.query(
      'SELECT * FROM users WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existingUsers.length > 0) {
      console.log('用户已存在:', existingUsers);
      await connection.rollback();
      return res.status(400).json({ 
        success: false,
        error: '用户名或邮箱已存在' 
      });
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
      return res.status(500).json({ 
        success: false,
        error: '系统错误：无法获取角色信息' 
      });
    }

    // 加密密码
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    // 创建用户
    const [result] = await connection.query(
      'INSERT INTO users (username, email, password_hash, role_id, status, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [username, email, passwordHash, roles[0].id, 'active']
    );

    // 生成token
    const token = generateToken(result.insertId, 'user');

    // 将用户信息存储到Redis
    const userData = {
      id: result.insertId,
      username,
      email,
      role: 'user',
      status: 'active'
    };

    const redisKey = `${REDIS_TOKEN_PREFIX}${token}`;
    await redisClient.setEx(redisKey, 24 * 60 * 60, JSON.stringify(userData));

    // 创建用户会话记录
    await connection.query(
      'INSERT INTO user_sessions (user_id, token, expires_at, created_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR), NOW())',
      [result.insertId, token]
    );

    await connection.commit();
    
    console.log('用户创建成功:', result.insertId);

    res.status(201).json({
      success: true,
      message: '注册成功',
      data: {
        userId: result.insertId,
        username,
        email,
        token,
        role: 'user'
      }
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('注册失败:', error);
    res.status(500).json({ 
      success: false,
      error: '注册失败: ' + error.message 
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// 用户登录
const login = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      success: false,
      errors: errors.array() 
    });
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
      return res.status(401).json({ 
        success: false,
        error: '用户名或密码错误' 
      });
    }

    const user = users[0];

    // 验证密码
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      await connection.rollback();
      return res.status(401).json({ 
        success: false,
        error: '用户名或密码错误' 
      });
    }

    // 检查用户状态
    if (user.status !== 'active') {
      await connection.rollback();
      return res.status(403).json({ 
        success: false,
        error: '账户已被禁用' 
      });
    }

    // 生成token
    const token = generateToken(user.id, user.role_name);

    // 更新最后登录时间
    await connection.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
      [user.id]
    );

    // 将用户信息存储到Redis
    const userData = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role_name,
      status: user.status
    };

    const redisKey = `${REDIS_TOKEN_PREFIX}${token}`;
    await redisClient.setEx(redisKey, 24 * 60 * 60, JSON.stringify(userData));

    // 创建会话记录
    await connection.query(
      'INSERT INTO user_sessions (user_id, token, expires_at, created_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR), NOW())',
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
    if (!req.user) {
      return res.status(401).json({ 
        success: false,
        error: '未认证' 
      });
    }

    res.json({
      success: true,
      data: req.user
    });
  } catch (error) {
    console.error('获取用户信息失败:', error);
    res.status(500).json({ 
      success: false,
      error: '获取用户信息失败: ' + error.message 
    });
  }
};

// 退出登录
const logout = async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    if (token) {
      // 从Redis中删除token
      const redisKey = `${REDIS_TOKEN_PREFIX}${token}`;
      await redisClient.del(redisKey);
      
      // 从数据库中删除会话记录
      await query('DELETE FROM user_sessions WHERE token = ?', [token]);
    }
    
    res.json({ 
      success: true,
      message: '退出成功' 
    });
  } catch (error) {
    console.error('退出失败:', error);
    res.status(500).json({ 
      success: false,
      error: '退出失败: ' + error.message 
    });
  }
};

// 刷新token
const refreshToken = async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ 
        success: false,
        error: '未提供token' 
      });
    }

    // 验证当前token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // 获取用户信息
    const [users] = await query(
      'SELECT u.*, r.name as role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ? AND u.status = ?',
      [decoded.userId, 'active']
    );

    if (users.length === 0) {
      return res.status(401).json({ 
        success: false,
        error: '用户不存在或已被禁用' 
      });
    }

    const user = users[0];

    // 生成新token
    const newToken = generateToken(user.id, user.role_name);

    // 更新Redis中的token
    const oldRedisKey = `${REDIS_TOKEN_PREFIX}${token}`;
    const newRedisKey = `${REDIS_TOKEN_PREFIX}${newToken}`;
    
    const userData = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role_name,
      status: user.status
    };

    // 删除旧token，存储新token
    await redisClient.del(oldRedisKey);
    await redisClient.setEx(newRedisKey, 24 * 60 * 60, JSON.stringify(userData));

    // 更新数据库中的会话记录
    await query(
      'UPDATE user_sessions SET token = ?, expires_at = DATE_ADD(NOW(), INTERVAL 24 HOUR) WHERE token = ?',
      [newToken, token]
    );

    res.json({
      success: true,
      message: 'token刷新成功',
      data: {
        token: newToken,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role_name
        }
      }
    });
  } catch (error) {
    console.error('token刷新失败:', error);
    res.status(500).json({ 
      success: false,
      error: 'token刷新失败: ' + error.message 
    });
  }
};

// 获取用户会话列表（管理员功能）
const getUserSessions = async (req, res) => {
  try {
    if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ 
        success: false,
        error: '权限不足' 
      });
    }

    const [sessions] = await query(`
      SELECT 
        us.*,
        u.username,
        u.email
      FROM user_sessions us
      JOIN users u ON us.user_id = u.id
      WHERE us.expires_at > NOW()
      ORDER BY us.created_at DESC
    `);

    res.json({
      success: true,
      data: sessions
    });
  } catch (error) {
    console.error('获取会话列表失败:', error);
    res.status(500).json({ 
      success: false,
      error: '获取会话列表失败: ' + error.message 
    });
  }
};

// 强制下线用户（管理员功能）
const forceLogout = async (req, res) => {
  try {
    if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ 
        success: false,
        error: '权限不足' 
      });
    }

    const { userId } = req.params;

    // 获取用户的所有活跃会话
    const [sessions] = await query(
      'SELECT token FROM user_sessions WHERE user_id = ? AND expires_at > NOW()',
      [userId]
    );

    // 从Redis中删除所有相关token
    for (const session of sessions) {
      const redisKey = `${REDIS_TOKEN_PREFIX}${session.token}`;
      await redisClient.del(redisKey);
    }

    // 从数据库中删除会话记录
    await query(
      'DELETE FROM user_sessions WHERE user_id = ?',
      [userId]
    );

    res.json({
      success: true,
      message: '用户已强制下线'
    });
  } catch (error) {
    console.error('强制下线失败:', error);
    res.status(500).json({ 
      success: false,
      error: '强制下线失败: ' + error.message 
    });
  }
};

// 清理过期会话（定时任务）
const cleanupExpiredSessions = async () => {
  try {
    // 清理数据库中的过期会话
    await query('DELETE FROM user_sessions WHERE expires_at < NOW()');
    
    console.log('过期会话清理完成');
  } catch (error) {
    console.error('清理过期会话失败:', error);
  }
};

// 每小时清理一次过期会话
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

module.exports = {
  authenticateToken,
  checkRole,
  requireAdmin,
  register,
  login,
  getCurrentUser,
  logout,
  refreshToken,
  getUserSessions,
  forceLogout,
  cleanupExpiredSessions
}; 