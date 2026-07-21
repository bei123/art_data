const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const { pool, query } = require('./db');
const {
  JWT_SECRET,
  extractBearerToken,
  verifyActiveSessionToken,
  resolveAuthFromRequest,
} = require('./utils/sessionAuth');
const { revokeWxRefreshTokensForUser, revokeWxAccessSession } = require('./utils/wxSessionTokens');
const {
  issueAdminTokenPair,
  refreshAdminAccessToken,
  revokeAdminRefreshTokensForUser,
  revokeAdminAccessSession,
} = require('./utils/adminSessionTokens');
const { appendClientErrorDetail } = require('./utils/clientErrorDetail');

// 生成JWT token（兼容旧调用；新登录走 issueAdminTokenPair）
const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '24h' });
};

// 验证token中间件（JWT 与 user_sessions 一致：登出或过期会话即失效）
const authenticateToken = async (req, res, next) => {
  const token = extractBearerToken(req.headers['authorization']);

  if (!token) {
    return res.status(401).json({ error: '未提供认证token' });
  }

  try {
    const verified = await verifyActiveSessionToken(token);
    if (!verified.ok) {
      return res.status(verified.status).json({ error: verified.error });
    }

    const decoded = { userId: verified.userId, openid: verified.openid };

    if (decoded.openid) {
      const [wxUsers] = await query(
        'SELECT id, openid, nickname, avatar, phone, created_at, updated_at FROM wx_users WHERE id = ?',
        [decoded.userId]
      );

      if (wxUsers && wxUsers.length > 0) {
        if (String(wxUsers[0].openid) !== String(decoded.openid)) {
          return res.status(403).json({ error: '无效的token' });
        }
        req.user = { ...wxUsers[0], is_wx_user: true };
        return next();
      }
    }

    const [users] = await query('SELECT * FROM users WHERE id = ?', [decoded.userId]);

    if (users.length > 0) {
      req.user = users[0];
      return next();
    }

    const [wxUsers] = await query(
      'SELECT id, openid, nickname, avatar, phone, created_at, updated_at FROM wx_users WHERE id = ?',
      [decoded.userId]
    );

    if (!wxUsers || wxUsers.length === 0) {
      return res.status(401).json({ error: '用户不存在' });
    }

    req.user = { ...wxUsers[0], is_wx_user: true };
    next();
  } catch (error) {
    console.error('authenticateToken', error);
    return res.status(500).json({ error: '认证服务暂时不可用' });
  }
};

/**
 * 有 token 则解析并挂载 req.user；无 token 或无效 token 不报错。
 * 若已登录且为后台用户（非微信用户）且角色为 admin，则 req.includeHidden = true（可查看未公开展示的艺术家/原作）。
 */
const optionalAuthenticate = async (req, res, next) => {
  req.user = undefined;
  req.includeHidden = false;
  const authHeader = req.headers['authorization'];
  const token = extractBearerToken(authHeader);
  if (!token) return next();
  try {
    const verified = await verifyActiveSessionToken(token);
    if (!verified.ok) return next();

    const decoded = { userId: verified.userId, openid: verified.openid };

    if (decoded.openid) {
      const [wxUsers] = await query(
        'SELECT id, openid, nickname, avatar, phone, created_at, updated_at FROM wx_users WHERE id = ?',
        [decoded.userId]
      );
      if (wxUsers && wxUsers.length > 0 && String(wxUsers[0].openid) === String(decoded.openid)) {
        req.user = { ...wxUsers[0], is_wx_user: true };
      }
    }

    if (!req.user) {
      const [users] = await query('SELECT * FROM users WHERE id = ?', [decoded.userId]);
      if (users.length > 0) {
        req.user = users[0];
      } else {
        const [wxUsers] = await query(
          'SELECT id, openid, nickname, avatar, phone, created_at, updated_at FROM wx_users WHERE id = ?',
          [decoded.userId]
        );
        if (wxUsers && wxUsers.length > 0) req.user = { ...wxUsers[0], is_wx_user: true };
      }
    }

    if (req.user && !req.user.is_wx_user) {
      const [userRoles] = await query(
        'SELECT r.name FROM roles r JOIN users u ON r.id = u.role_id WHERE u.id = ?',
        [req.user.id]
      );
      if (userRoles.length > 0 && userRoles[0].name === 'admin') req.includeHidden = true;
    }
  } catch {
    /* 匿名访问 */
  }
  next();
};

/**
 * 仅允许访问本人数据，或角色为 admin 的用户访问他人数据（防水平越权）
 * @returns {{ ok: true, userId: number } | { ok: false, status: number, error: string }}
 */
async function assertSelfOrAdmin(req, targetUserId) {
  const id = parseInt(String(targetUserId), 10)
  if (!targetUserId || Number.isNaN(id) || id <= 0) {
    return { ok: false, status: 400, error: '无效的用户ID' }
  }
  if (!req.user) {
    return { ok: false, status: 401, error: '未认证' }
  }
  if (Number(req.user.id) === id) {
    return { ok: true, userId: id }
  }
  if (req.user.is_wx_user) {
    return { ok: false, status: 403, error: '无权查看该用户的购买记录' }
  }
  const [userRoles] = await query(
    'SELECT r.name FROM roles r JOIN users u ON r.id = u.role_id WHERE u.id = ?',
    [req.user.id]
  )
  if (userRoles.length > 0 && userRoles[0].name === 'admin') {
    return { ok: true, userId: id }
  }
  return { ok: false, status: 403, error: '无权查看该用户的购买记录' }
}

// 检查角色权限中间件
const checkRole = (roles) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: '未认证' });
    }

    if (req.user.is_wx_user) {
      return res.status(403).json({ error: '权限不足' });
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

    // 生成 access + refresh
    const tokenPair = await issueAdminTokenPair({
      userId: result.insertId,
      connection,
    });

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
        token: tokenPair.token,
        refreshToken: tokenPair.refreshToken,
        expires_at: tokenPair.expires_at,
        expiresIn: tokenPair.expiresIn,
        refresh_expires_at: tokenPair.refresh_expires_at,
        refreshExpiresIn: tokenPair.refreshExpiresIn,
      }
    });
  } catch (error) {
    // 回滚事务
    if (connection) {
      await connection.rollback();
    }
    console.error('注册失败:', error);
    res.status(500).json(appendClientErrorDetail({
      success: false,
      error: '注册失败',
    }, error));
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

    // 生成 access + refresh
    const tokenPair = await issueAdminTokenPair({
      userId: user.id,
      connection,
    });

    // 更新最后登录时间
    await connection.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
      [user.id]
    );

    await connection.commit();

    res.json({
      success: true,
      message: '登录成功',
      data: {
        token: tokenPair.token,
        refreshToken: tokenPair.refreshToken,
        expires_at: tokenPair.expires_at,
        expiresIn: tokenPair.expiresIn,
        refresh_expires_at: tokenPair.refresh_expires_at,
        refreshExpiresIn: tokenPair.refreshExpiresIn,
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
    res.status(500).json(appendClientErrorDetail({
      success: false,
      error: '登录失败',
    }, error));
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// 获取当前用户信息
const getCurrentUser = async (req, res) => {
  try {
    if (req.user?.is_wx_user) {
      return res.json({
        id: req.user.id,
        openid: req.user.openid,
        nickname: req.user.nickname,
        avatar: req.user.avatar,
        phone: req.user.phone,
        role: 'wx_user'
      });
    }

    // db.query 与 mysql2 pool.query 一致，返回 [rows, fields]；只取 rows 的首行作为单个用户对象
    const queryTuple = await query(
      'SELECT u.id, u.username, u.email, r.name as role FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?',
      [req.user.id]
    );
    const rows = queryTuple[0];
    const user = rows?.[0];

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json(user);
  } catch (error) {
    console.error('获取用户信息失败:', error);
    res.status(500).json(appendClientErrorDetail({ error: '获取用户信息失败' }, error));
  }
};

// 刷新 access token
const refresh = async (req, res) => {
  try {
    const { refreshToken: refreshTokenValue } = req.body || {};
    const result = await refreshAdminAccessToken(refreshTokenValue);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    return res.json({
      success: true,
      data: {
        token: result.token,
        refreshToken: result.refreshToken,
        expires_at: result.expires_at,
        expiresIn: result.expiresIn,
        refresh_expires_at: result.refresh_expires_at,
        refreshExpiresIn: result.refreshExpiresIn,
      },
    });
  } catch (error) {
    console.error('刷新 token 失败:', error);
    return res.status(500).json(appendClientErrorDetail({
      success: false,
      error: '刷新登录状态失败',
    }, error));
  }
};

// 退出登录
const logout = async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    if (token) {
      if (req.user?.is_wx_user) {
        await revokeWxAccessSession(token);
      } else {
        await revokeAdminAccessSession(token);
      }
    }
    if (req.user?.is_wx_user && req.user?.id) {
      await revokeWxRefreshTokensForUser(req.user.id);
    } else if (req.user?.id && !req.user?.is_wx_user) {
      await revokeAdminRefreshTokensForUser(req.user.id);
    }
    res.json({ message: '退出成功' });
  } catch (error) {
    console.error('退出失败:', error);
    res.status(500).json(appendClientErrorDetail({ error: '退出失败' }, error));
  }
};

/** 须后台 admin 角色；用法：router.post('/x', ...requireAdmin, handler) */
const requireAdmin = [authenticateToken, checkRole(['admin'])];

module.exports = {
  authenticateToken,
  optionalAuthenticate,
  assertSelfOrAdmin,
  checkRole,
  requireAdmin,
  extractBearerToken,
  verifyActiveSessionToken,
  resolveAuthFromRequest,
  register,
  login,
  refresh,
  getCurrentUser,
  logout,
  generateToken,
}; 