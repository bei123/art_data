const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const querystring = require('querystring');
const db = require('../db');
const redisClient = require('../utils/redisClient');

// Redis缓存键前缀
const REDIS_EXTERNAL_USER_KEY_PREFIX = 'external_user:';
const REDIS_EXTERNAL_USER_BY_WX_ID_KEY_PREFIX = 'external_user:wx_id:';
const REDIS_EXTERNAL_USER_CACHE_TTL = 86400; // 24小时过期

/**
 * MD5加密函数
 * @param {string} str - 需要加密的字符串
 * @returns {string} MD5加密后的字符串
 */
function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * 生成appInfo的Base64编码
 * @param {string} clientId - 客户端ID
 * @param {string} clientSecret - 客户端密钥
 * @returns {string} Base64编码的appInfo
 */
function generateAppInfo(clientId, clientSecret) {
  const appInfoStr = `${clientId}:${clientSecret}`;
  return Buffer.from(appInfoStr, 'utf8').toString('base64');
}

/**
 * 验证appInfo格式
 * @param {string} appInfo - Base64编码的appInfo
 * @returns {object|null} 解析后的clientId和clientSecret，或null
 */
function validateAppInfo(appInfo) {
  try {
    const decoded = Buffer.from(appInfo, 'base64').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length === 2) {
      return {
        clientId: parts[0],
        clientSecret: parts[1]
      };
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * 外部API配置
 */
const EXTERNAL_API_CONFIG = {
  BASE_URL: 'https://yapi.licenseinfo.cn/mock/600',
  ASSET_TYPES: {
    SAVE: '/assetsApi/pr/basic/pt/type/save',
    LIST: '/assetsApi/pr/basic/type/list'
  },
  USER: {
    GET_TOKEN: '/userApi/user/getToken'
  },
  ASSETS: {
    LIST_COUNT: '/assetsApi/pr/assets/list/count'
  },
  // 验证码服务配置（使用不同的基础URL）
  VERIFICATION_CODE_BASE_URL: 'https://node.wespace.cn'
};

/**
 * 生成appInfo的Base64编码
 * POST /api/external/user/generate-app-info
 * 辅助接口，用于生成appInfo
 */
router.post('/user/generate-app-info', async (req, res) => {
  try {
    const { clientId, clientSecret } = req.body;

    // 参数验证
    if (!clientId || typeof clientId !== 'string' || clientId.trim().length === 0) {
      return res.status(400).json({
        error: 'clientId参数不能为空'
      });
    }

    if (!clientSecret || typeof clientSecret !== 'string' || clientSecret.trim().length === 0) {
      return res.status(400).json({
        error: 'clientSecret参数不能为空'
      });
    }

    // 生成appInfo
    const appInfo = generateAppInfo(clientId.trim(), clientSecret.trim());

    res.json({
      success: true,
      appInfo: appInfo,
      message: 'appInfo生成成功'
    });

  } catch (error) {
    console.error('生成appInfo失败:', error);
    res.status(500).json({
      error: '服务器内部错误'
    });
  }
});

/**
 * 获取访问令牌
 * POST /api/external/user/get-token
 * 转发到外部接口：POST /userApi/user/getToken
 */
router.post('/user/get-token', async (req, res) => {
  try {
    const { appInfo } = req.query;

    // 参数验证
    if (!appInfo || typeof appInfo !== 'string' || appInfo.trim().length === 0) {
      return res.status(400).json({
        error: 'appInfo参数不能为空'
      });
    }

    // 验证appInfo格式
    const appInfoData = validateAppInfo(appInfo);
    if (!appInfoData) {
      return res.status(400).json({
        error: 'appInfo格式不正确，应为clientId:clientSecret的Base64编码'
      });
    }

    // 调用外部API获取token
    const response = await axios.post(
      `${EXTERNAL_API_CONFIG.BASE_URL}${EXTERNAL_API_CONFIG.USER.GET_TOKEN}`,
      null, // 没有请求体
      {
        params: {
          appInfo: appInfo.trim()
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      }
    );

    // 返回外部API的响应
    res.json(response.data);

  } catch (error) {
    console.error('获取访问令牌失败:', error);

    // 处理不同类型的错误
    if (error.response) {
      // 外部API返回了错误响应
      res.status(error.response.status).json({
        error: error.response.data?.error || '获取访问令牌失败'
      });
    } else if (error.request) {
      // 请求发送失败
      res.status(500).json({
        error: '外部接口连接失败'
      });
    } else {
      // 其他错误
      res.status(500).json({
        error: '服务器内部错误'
      });
    }
  }
});

/**
 * 获取手机验证码
 * GET /api/external/user/get-mobile-verification-code
 * 转发到外部接口：GET https://node.wespace.cn/userApi/user/getMobileVerificationCode
 */
router.get('/user/get-mobile-verification-code', async (req, res) => {
  try {
    const { mobile } = req.query;

    // 参数验证
    if (!mobile || typeof mobile !== 'string' || mobile.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: '手机号参数不能为空'
      });
    }

    // 获取 authorization，优先从请求头获取，如果没有则从环境变量获取
    const authorization = req.headers.authorization ||
      req.headers.Authorization ||
      process.env.VERIFICATION_CODE_AUTHORIZATION ||
      'Basic d2VzcGFjZTp3ZXNwYWNlLXNlY3JldA=='; // 默认值作为fallback

    // 调用外部API获取验证码
    const response = await axios.get(
      `${EXTERNAL_API_CONFIG.VERIFICATION_CODE_BASE_URL}/userApi/user/getMobileVerificationCode`,
      {
        params: {
          mobile: mobile.trim()
        },
        headers: {
          'authorization': authorization,
          'apptype': '6',
          'tenantid': 'wespace',
          'content-type': 'application/x-www-form-urlencoded',
          'origin': 'https://m.wespace.cn',
          'x-requested-with': 'cn.org.pfp',
          'sec-fetch-site': 'same-site',
          'sec-fetch-mode': 'cors',
          'sec-fetch-dest': 'empty',
          'referer': 'https://m.wespace.cn/',
          'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        timeout: 10000 // 10秒超时
      }
    );

    // 检查响应数据，判断是否为业务错误
    // 外部API可能返回200 HTTP状态码，但业务逻辑失败（如code: 209, status: false）
    if (response.data && typeof response.data === 'object') {
      // 成功响应：code: 200 且 status: true
      const isSuccess = response.data.code === 200 && response.data.status === true;

      if (!isSuccess) {
        // 业务错误：code不是200或status为false
        // 例如：{"code": 209, "status": false, "message": "手机号格式异常！"}
        const httpStatus = (response.data.code && response.data.code >= 400) ? response.data.code : 400;
        return res.status(httpStatus).json(response.data);
      }
    }

    // 返回外部API的响应（成功情况：code: 200, status: true）
    res.json(response.data);

  } catch (error) {
    console.error('获取手机验证码失败:', error);

    // 处理不同类型的错误
    if (error.response) {
      // 外部API返回了HTTP错误响应
      const statusCode = error.response.status || 500;
      const responseData = error.response.data || {
        code: statusCode,
        status: false,
        message: '获取验证码失败'
      };
      res.status(statusCode).json(responseData);
    } else if (error.request) {
      // 请求发送失败
      res.status(500).json({
        code: 500,
        status: false,
        message: '外部接口连接失败'
      });
    } else {
      // 其他错误
      res.status(500).json({
        code: 500,
        status: false,
        message: '服务器内部错误'
      });
    }
  }
});

/**
 * 用户登录
 * POST /api/external/user/login
 * 转发到外部接口：POST https://node.wespace.cn/userApi/user/login
 */
router.post('/user/login', async (req, res) => {
  try {
    const { account, captcha } = req.body;

    // 参数验证
    if (!account || typeof account !== 'string' || account.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: '账号参数不能为空'
      });
    }

    if (!captcha || typeof captcha !== 'string' || captcha.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: '验证码参数不能为空'
      });
    }

    // 登录接口需要使用 Basic 认证，不是 Bearer token
    // 支持从专门的请求头 'x-external-authorization' 获取，或者从环境变量获取
    // 如果请求头是 Basic 开头的，也可以使用
    let authorization = req.headers['x-external-authorization'] ||
      req.headers['X-External-Authorization'];

    // 如果请求头传入的是 Basic 认证，也可以使用
    if (!authorization && req.headers.authorization && req.headers.authorization.startsWith('Basic ')) {
      authorization = req.headers.authorization;
    }

    // 如果还是没有，使用环境变量或默认值
    if (!authorization) {
      authorization = process.env.VERIFICATION_CODE_AUTHORIZATION ||
        'Basic d2VzcGFjZTp3ZXNwYWNlLXNlY3JldA==';
    }

    // 构建 form-urlencoded 格式的请求体（直接拼接，参考成功请求格式）
    // 成功格式：account=13611329007&captcha=5857
    const formData = `account=${account.trim()}&captcha=${captcha.trim()}`;

    // 调用外部API登录
    const loginUrl = `${EXTERNAL_API_CONFIG.VERIFICATION_CODE_BASE_URL}/userApi/user/login`;
    console.log('调用外部登录接口:', loginUrl);
    console.log('请求参数:', { account: account.trim(), captcha: '***' });
    console.log('请求体数据:', formData);
    console.log('Authorization:', authorization ? (authorization.startsWith('Basic ') ? authorization.substring(0, 20) + '...' : 'Basic ...') : '未设置');

    const response = await axios.post(
      loginUrl,
      formData,
      {
        headers: {
          'authorization': authorization,
          'apptype': '16', // 成功请求中使用的是 16，不是 6
          'tenantid': 'wespace',
          'origin': 'https://m.wespace.cn',
          'x-requested-with': 'cn.org.pfp',
          'sec-fetch-site': 'same-site',
          'sec-fetch-mode': 'cors',
          'sec-fetch-dest': 'empty',
          'referer': 'https://m.wespace.cn/',
          'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
          'content-type': 'application/x-www-form-urlencoded'
        },
        // 确保axios不会自动转换数据
        transformRequest: [(data) => {
          // 如果数据是字符串，直接返回（不进行JSON序列化）
          return typeof data === 'string' ? data : data;
        }],
        timeout: 10000 // 10秒超时
      }
    );

    console.log('外部API响应状态:', response.status);
    console.log('外部API响应数据:', JSON.stringify(response.data));

    // 检查响应数据，判断是否为业务错误
    // 外部API可能返回200 HTTP状态码，但业务逻辑失败
    // 失败示例：
    //   {"code": 204, "status": false, "message": "验证码验证失败，剩余尝试次数：4"}
    //   {"code": 500, "status": false, "message": "服务异常"}
    // 成功示例：{"code": 200, "status": true, "message": "success", "data": {...}}
    if (response.data && typeof response.data === 'object') {
      // 成功响应：code: 200 且 status: true
      const isSuccess = response.data.code === 200 && response.data.status === true;

      if (!isSuccess) {
        // 业务错误：code不是200或status为false
        // 如果业务错误码>=400（如500），使用该码作为HTTP状态码，否则使用400
        const httpStatus = (response.data.code && response.data.code >= 400) ? response.data.code : 400;
        console.log('检测到业务错误，返回HTTP状态码:', httpStatus, '业务错误码:', response.data.code);
        return res.status(httpStatus).json(response.data);
      }
    }

    // 登录成功，将用户数据写入数据库
    if (response.data && response.data.code === 200 && response.data.status === true && response.data.data) {
      try {
        const userData = response.data.data;
        const externalUser = userData.user;
        
        if (externalUser && externalUser.usn) {
          // 通过手机号查找 wx_users 表中的用户
          let wxUserId = null;
          
          if (externalUser.mobile) {
            const [usersByPhone] = await db.query(
              'SELECT id FROM wx_users WHERE phone = ?',
              [externalUser.mobile]
            );
            if (usersByPhone.length > 0) {
              wxUserId = usersByPhone[0].id;
            }
          }

          if (!wxUserId) {
            console.warn('未找到对应的wx_users用户, 手机号:', externalUser.mobile, 'usn:', externalUser.usn);
            // 如果找不到对应的wx_users用户，可以选择创建或跳过
            // 这里选择跳过，只记录警告日志
          } else {
            // 找到了对应的wx_users用户，保存/更新外部用户数据到 external_users 表
            // 检查 external_users 表中是否已存在该用户的记录
            const [existingExternalUsers] = await db.query(
              'SELECT id FROM external_users WHERE wx_user_id = ? OR usn = ?',
              [wxUserId, externalUser.usn]
            );

            if (existingExternalUsers.length > 0) {
              // 已存在，检查数据是否有变化
              const externalUserId = existingExternalUsers[0].id;
              
              // 查询当前数据
              const [currentData] = await db.query(
                'SELECT * FROM external_users WHERE id = ?',
                [externalUserId]
              );
              
              if (currentData.length > 0) {
                const current = currentData[0];
                
                // 比较数据是否有变化（处理null和undefined）
                const normalizeValue = (val) => val === null || val === undefined ? null : String(val);
                const normalizeJsonValue = (val) => {
                  if (val === null || val === undefined) return null;
                  if (Array.isArray(val) || typeof val === 'object') {
                    return JSON.stringify(val);
                  }
                  return String(val);
                };
                
                const hasChanges = 
                  (normalizeValue(current.external_user_id) !== normalizeValue(externalUser.id || externalUser.userId)) ||
                  (normalizeValue(current.username) !== normalizeValue(externalUser.username)) ||
                  (normalizeValue(current.truename) !== normalizeValue(externalUser.truename)) ||
                  (normalizeValue(current.nickname) !== normalizeValue(externalUser.nickname)) ||
                  (normalizeValue(current.mobile) !== normalizeValue(externalUser.mobile)) ||
                  (normalizeValue(current.avatar) !== normalizeValue(externalUser.avatar)) ||
                  (normalizeValue(current.access_token) !== normalizeValue(userData.accessToken)) ||
                  (normalizeValue(current.refresh_token) !== normalizeValue(userData.refreshToken)) ||
                  (normalizeValue(current.token) !== normalizeValue(externalUser.token)) ||
                  (normalizeValue(current.expire) !== normalizeValue(userData.expire)) ||
                  (normalizeValue(current.app_type) !== normalizeValue(userData.appType)) ||
                  (normalizeValue(current.app_type_name) !== normalizeValue(userData.appTypeName)) ||
                  (normalizeValue(current.set_password) !== normalizeValue(userData.setPassword ? '1' : '0')) ||
                  (normalizeValue(current.ws_token) !== normalizeValue(userData.wsToken)) ||
                  (normalizeValue(current.ws_stoken) !== normalizeValue(externalUser.wsStoken)) ||
                  (normalizeValue(current.node_org) !== normalizeValue(userData.nodeOrg)) ||
                  (normalizeValue(current.im_token) !== normalizeValue(externalUser.imToken)) ||
                  (normalizeValue(current.identity_authentication) !== normalizeValue(externalUser.identityAuthentication)) ||
                  (normalizeValue(current.postcode) !== normalizeValue(externalUser.postcode)) ||
                  (normalizeValue(current.nation) !== normalizeValue(externalUser.nation)) ||
                  (normalizeValue(current.invite_code) !== normalizeValue(externalUser.inviteCode)) ||
                  (normalizeValue(current.channel) !== normalizeValue(externalUser.channel)) ||
                  (normalizeValue(current.client_id) !== normalizeValue(externalUser.clientId)) ||
                  (normalizeJsonValue(current.privileges) !== normalizeJsonValue(externalUser.privileges)) ||
                  (normalizeValue(current.chain_status) !== normalizeValue(externalUser.chainStatus)) ||
                  (normalizeValue(current.status) !== normalizeValue(externalUser.status)) ||
                  (normalizeValue(current.id_card_no) !== normalizeValue(externalUser.idCardNo));
                
                // 只有数据有变化时才更新
                if (hasChanges) {
                  await db.query(
                    `UPDATE external_users SET
                      external_user_id = ?,
                      username = ?,
                      truename = ?,
                      nickname = ?,
                      mobile = ?,
                      avatar = ?,
                      access_token = ?,
                      refresh_token = ?,
                      token = ?,
                      expire = ?,
                      app_type = ?,
                      app_type_name = ?,
                      set_password = ?,
                      ws_token = ?,
                      ws_stoken = ?,
                      node_org = ?,
                      im_token = ?,
                      identity_authentication = ?,
                      postcode = ?,
                      nation = ?,
                      invite_code = ?,
                      channel = ?,
                      client_id = ?,
                      privileges = ?,
                      chain_status = ?,
                      status = ?,
                      id_card_no = ?,
                      updated_at = NOW()
                    WHERE id = ?`,
                    [
                      externalUser.id || externalUser.userId,
                      externalUser.username,
                      externalUser.truename,
                      externalUser.nickname,
                      externalUser.mobile,
                      externalUser.avatar,
                      userData.accessToken,
                      userData.refreshToken,
                      externalUser.token,
                      userData.expire,
                      userData.appType,
                      userData.appTypeName,
                      userData.setPassword ? 1 : 0,
                      userData.wsToken,
                      externalUser.wsStoken,
                      userData.nodeOrg,
                      externalUser.imToken,
                      externalUser.identityAuthentication,
                      externalUser.postcode,
                      externalUser.nation,
                      externalUser.inviteCode,
                      externalUser.channel,
                      externalUser.clientId,
                      externalUser.privileges ? JSON.stringify(externalUser.privileges) : null,
                      externalUser.chainStatus,
                      externalUser.status,
                      externalUser.idCardNo,
                      externalUserId
                    ]
                  );
                  console.log('已更新external_users数据, wx_user_id:', wxUserId, 'usn:', externalUser.usn);
                  
                  // 更新Redis缓存
                  try {
                    const cacheData = {
                      id: externalUserId,
                      wx_user_id: wxUserId,
                      usn: externalUser.usn,
                      external_user_id: externalUser.id || externalUser.userId,
                      username: externalUser.username,
                      truename: externalUser.truename,
                      nickname: externalUser.nickname,
                      mobile: externalUser.mobile,
                      avatar: externalUser.avatar,
                      access_token: userData.accessToken,
                      refresh_token: userData.refreshToken,
                      token: externalUser.token,
                      expire: userData.expire,
                      app_type: userData.appType,
                      app_type_name: userData.appTypeName,
                      set_password: userData.setPassword,
                      ws_token: userData.wsToken,
                      ws_stoken: externalUser.wsStoken,
                      node_org: userData.nodeOrg,
                      im_token: externalUser.imToken,
                      identity_authentication: externalUser.identityAuthentication,
                      postcode: externalUser.postcode,
                      nation: externalUser.nation,
                      invite_code: externalUser.inviteCode,
                      channel: externalUser.channel,
                      client_id: externalUser.clientId,
                      privileges: externalUser.privileges,
                      chain_status: externalUser.chainStatus,
                      status: externalUser.status,
                      id_card_no: externalUser.idCardNo
                    };
                    
                    // 使用usn和wx_user_id作为缓存键
                    await redisClient.setEx(
                      `${REDIS_EXTERNAL_USER_KEY_PREFIX}${externalUser.usn}`,
                      REDIS_EXTERNAL_USER_CACHE_TTL,
                      JSON.stringify(cacheData)
                    );
                    await redisClient.setEx(
                      `${REDIS_EXTERNAL_USER_BY_WX_ID_KEY_PREFIX}${wxUserId}`,
                      REDIS_EXTERNAL_USER_CACHE_TTL,
                      JSON.stringify(cacheData)
                    );
                    console.log('已更新Redis缓存, usn:', externalUser.usn, 'wx_user_id:', wxUserId);
                  } catch (redisError) {
                    console.error('Redis缓存更新失败:', redisError);
                    // Redis错误不影响主要流程
                  }
                } else {
                  console.log('external_users数据无变化，跳过更新, wx_user_id:', wxUserId, 'usn:', externalUser.usn);
                }
              }
            } else {
              // 不存在，插入新记录
              // 准备插入的数据
              const insertData = [
                wxUserId,                              // wx_user_id
                externalUser.usn,                       // usn
                externalUser.id || externalUser.userId, // external_user_id
                externalUser.username,                  // username
                externalUser.truename,                  // truename
                externalUser.nickname,                  // nickname
                externalUser.mobile,                    // mobile
                externalUser.avatar,                     // avatar
                userData.accessToken,                    // access_token
                userData.refreshToken,                   // refresh_token
                externalUser.token,                      // token
                userData.expire,                        // expire
                userData.appType,                       // app_type
                userData.appTypeName,                    // app_type_name
                userData.setPassword ? 1 : 0,           // set_password
                userData.wsToken,                       // ws_token
                externalUser.wsStoken,                  // ws_stoken
                userData.nodeOrg,                       // node_org
                externalUser.imToken,                   // im_token
                externalUser.identityAuthentication,     // identity_authentication
                externalUser.postcode,                   // postcode
                externalUser.nation,                     // nation
                externalUser.inviteCode,                // invite_code
                externalUser.channel,                   // channel
                externalUser.clientId,                  // client_id
                externalUser.privileges ? JSON.stringify(externalUser.privileges) : null, // privileges
                externalUser.chainStatus,                // chain_status
                externalUser.status,                     // status
                externalUser.idCardNo                    // id_card_no
              ];
              
              // 确保参数数量正确：29个参数 + 2个NOW() = 31个列
              const [result] = await db.query(
                `INSERT INTO external_users (
                  wx_user_id, usn, external_user_id, username, truename, nickname, mobile, avatar,
                  access_token, refresh_token, token, expire, app_type, app_type_name, set_password,
                  ws_token, ws_stoken, node_org, im_token,
                  identity_authentication, postcode, nation, invite_code, channel, client_id, privileges,
                  chain_status, status, id_card_no, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                insertData
              );
              console.log('已创建external_users数据, wx_user_id:', wxUserId, 'usn:', externalUser.usn, '外部用户数据ID:', result.insertId);
              
              // 写入Redis缓存
              try {
                const cacheData = {
                  id: result.insertId,
                  wx_user_id: wxUserId,
                  usn: externalUser.usn,
                  external_user_id: externalUser.id || externalUser.userId,
                  username: externalUser.username,
                  truename: externalUser.truename,
                  nickname: externalUser.nickname,
                  mobile: externalUser.mobile,
                  avatar: externalUser.avatar,
                  access_token: userData.accessToken,
                  refresh_token: userData.refreshToken,
                  token: externalUser.token,
                  expire: userData.expire,
                  app_type: userData.appType,
                  app_type_name: userData.appTypeName,
                  set_password: userData.setPassword,
                  ws_token: userData.wsToken,
                  ws_stoken: externalUser.wsStoken,
                  node_org: userData.nodeOrg,
                  im_token: externalUser.imToken,
                  identity_authentication: externalUser.identityAuthentication,
                  postcode: externalUser.postcode,
                  nation: externalUser.nation,
                  invite_code: externalUser.inviteCode,
                  channel: externalUser.channel,
                  client_id: externalUser.clientId,
                  privileges: externalUser.privileges,
                  chain_status: externalUser.chainStatus,
                  status: externalUser.status,
                  id_card_no: externalUser.idCardNo
                };
                
                // 使用usn和wx_user_id作为缓存键
                await redisClient.setEx(
                  `${REDIS_EXTERNAL_USER_KEY_PREFIX}${externalUser.usn}`,
                  REDIS_EXTERNAL_USER_CACHE_TTL,
                  JSON.stringify(cacheData)
                );
                await redisClient.setEx(
                  `${REDIS_EXTERNAL_USER_BY_WX_ID_KEY_PREFIX}${wxUserId}`,
                  REDIS_EXTERNAL_USER_CACHE_TTL,
                  JSON.stringify(cacheData)
                );
                console.log('已写入Redis缓存, usn:', externalUser.usn, 'wx_user_id:', wxUserId);
              } catch (redisError) {
                console.error('Redis缓存写入失败:', redisError);
                // Redis错误不影响主要流程
              }
            }
          }
        }
      } catch (dbError) {
        // 数据库操作失败不影响登录流程，只记录错误
        console.error('保存用户数据到数据库失败:', dbError);
        // 继续返回登录响应
      }
    }

    // 返回外部API的响应（成功情况：code: 200, status: true）
    res.json(response.data);

  } catch (error) {
    console.error('用户登录失败:', error);
    console.error('错误详情:', {
      message: error.message,
      response: error.response ? {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers
      } : null,
      request: error.request ? {
        method: error.config?.method,
        url: error.config?.url,
        data: error.config?.data
      } : null
    });

    // 处理不同类型的错误
    if (error.response) {
      // 外部API返回了HTTP错误响应
      const statusCode = error.response.status || 500;
      const responseData = error.response.data || {
        code: statusCode,
        status: false,
        message: '登录失败'
      };
      res.status(statusCode).json(responseData);
    } else if (error.request) {
      // 请求发送失败
      res.status(500).json({
        code: 500,
        status: false,
        message: '外部接口连接失败'
      });
    } else {
      // 其他错误
      res.status(500).json({
        code: 500,
        status: false,
        message: '服务器内部错误'
      });
    }
  }
});

/**
 * 用户注册
 * POST /api/external/user/register
 * 转发到外部接口：POST https://node.wespace.cn/userApi/user/register
 */
router.post('/user/register', async (req, res) => {
  try {
    const { mobile, channel, isRegister, password, captcha, inviteCode, type, passCard } = req.body;

    // 参数验证
    if (!mobile || typeof mobile !== 'string' || mobile.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: '手机号参数不能为空'
      });
    }

    // 验证手机号格式
    const mobileRegex = /^1[3-9]\d{9}$/;
    if (!mobileRegex.test(mobile.trim())) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: '手机号格式不正确'
      });
    }

    if (!password || typeof password !== 'string' || password.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: '密码参数不能为空'
      });
    }

    if (!captcha || typeof captcha !== 'string' || captcha.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: '验证码参数不能为空'
      });
    }

    // 注册接口需要使用 Basic 认证
    let authorization = req.headers['x-external-authorization'] ||
      req.headers['X-External-Authorization'];

    if (!authorization && req.headers.authorization && req.headers.authorization.startsWith('Basic ')) {
      authorization = req.headers.authorization;
    }

    if (!authorization) {
      authorization = process.env.VERIFICATION_CODE_AUTHORIZATION ||
        'Basic d2VzcGFjZTp3ZXNwYWNlLXNlY3JldA==';
    }

    // 对密码进行MD5加密
    const passwordMd5 = md5(password.trim());

    // 构建 form-urlencoded 格式的请求体
    // 处理可选参数和URL编码
    const params = {
      mobile: mobile.trim(),
      channel: channel || '千年时间_h5',
      isRegister: isRegister !== undefined ? isRegister : '1',
      password: passwordMd5, // 使用MD5加密后的密码
      captcha: captcha.trim(),
      inviteCode: inviteCode || '',
      type: type !== undefined ? type.toString() : '1',
      passCard: passCard || JSON.stringify({
        From_IP: '',
        From_Device: 'H5',
        From_MAC: '',
        From_OS: 'uniapp',
        From_ID: mobile.trim(),
        Hash_Subject: '',
        Invite_code: inviteCode || '',
        Timestamp: Date.now()
      })
    };

    // 构建查询字符串
    const formDataParts = [];
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        // 对于passCard这种JSON字符串，需要先URL编码
        const encodedValue = key === 'passCard' ? encodeURIComponent(value) : value;
        formDataParts.push(`${key}=${encodedValue}`);
      }
    }
    const formData = formDataParts.join('&');

    // 调用外部API注册
    const registerUrl = `${EXTERNAL_API_CONFIG.VERIFICATION_CODE_BASE_URL}/userApi/user/register`;
    console.log('调用外部注册接口:', registerUrl);
    console.log('请求参数:', { mobile: mobile.trim(), captcha: '***', type: params.type });
    console.log('请求体数据长度:', formData.length);

    const response = await axios.post(
      registerUrl,
      formData,
      {
        headers: {
          'authorization': authorization,
          'apptype': '16',
          'tenantid': 'wespace',
          'origin': 'https://m.wespace.cn',
          'x-requested-with': 'cn.org.pfp',
          'sec-fetch-site': 'same-site',
          'sec-fetch-mode': 'cors',
          'sec-fetch-dest': 'empty',
          'referer': 'https://m.wespace.cn/',
          'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
          'content-type': 'application/x-www-form-urlencoded'
        },
        transformRequest: [(data) => {
          return typeof data === 'string' ? data : data;
        }],
        timeout: 10000
      }
    );

    console.log('外部API响应状态:', response.status);
    console.log('外部API响应数据:', JSON.stringify(response.data));

    // 检查响应数据，判断是否为业务错误
    // 失败示例：
    //   {"code": 201, "status": false, "message": "该账号已存在!"}
    //   {"code": 204, "status": false, "message": "验证码验证失败，剩余尝试次数：4"}
    //   {"code": 500, "status": false, "message": "服务异常"}
    // 成功示例：{"code": 200, "status": true, "message": "success", "data": {...}}
    if (response.data && typeof response.data === 'object') {
      const isSuccess = response.data.code === 200 && response.data.status === true;

      if (!isSuccess) {
        // 业务错误：code不是200或status为false
        // 如果业务错误码>=400（如500），使用该码作为HTTP状态码，否则使用400
        const httpStatus = (response.data.code && response.data.code >= 400) ? response.data.code : 400;
        console.log('检测到业务错误，返回HTTP状态码:', httpStatus, '业务错误码:', response.data.code, '错误信息:', response.data.message);
        return res.status(httpStatus).json(response.data);
      }
    }

    // 返回外部API的响应（成功情况）
    res.json(response.data);

  } catch (error) {
    console.error('用户注册失败:', error);
    console.error('错误详情:', {
      message: error.message,
      response: error.response ? {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers
      } : null,
      request: error.request ? {
        method: error.config?.method,
        url: error.config?.url,
        data: error.config?.data
      } : null
    });

    if (error.response) {
      const statusCode = error.response.status || 500;
      const responseData = error.response.data || {
        code: statusCode,
        status: false,
        message: '注册失败'
      };
      res.status(statusCode).json(responseData);
    } else if (error.request) {
      res.status(500).json({
        code: 500,
        status: false,
        message: '外部接口连接失败'
      });
    } else {
      res.status(500).json({
        code: 500,
        status: false,
        message: '服务器内部错误'
      });
    }
  }
});

/**
 * 调用外部API保存资产类型
 * POST /api/external/asset-types/save
 * 转发到外部接口：POST /assetsApi/pr/basic/pt/type/save
 */
router.post('/asset-types/save', async (req, res) => {
  try {
    const { name, pid } = req.body;

    // 参数验证
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: '类型名称不能为空',
        data: null
      });
    }

    // 构建请求参数
    const requestData = {
      name: name.trim(),
      pid: pid || null
    };

    // 调用外部API
    const response = await axios.post(
      `${EXTERNAL_API_CONFIG.BASE_URL}${EXTERNAL_API_CONFIG.ASSET_TYPES.SAVE}`,
      requestData,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10秒超时
      }
    );

    // 返回外部API的响应
    res.json(response.data);

  } catch (error) {
    console.error('调用外部资产类型保存接口失败:', error);

    // 处理不同类型的错误
    if (error.response) {
      // 外部API返回了错误响应
      res.status(error.response.status).json({
        code: error.response.status,
        status: false,
        message: error.response.data?.message || '外部接口调用失败',
        data: null
      });
    } else if (error.request) {
      // 请求发送失败
      res.status(500).json({
        code: 500,
        status: false,
        message: '外部接口连接失败',
        data: null
      });
    } else {
      // 其他错误
      res.status(500).json({
        code: 500,
        status: false,
        message: '服务器内部错误',
        data: null
      });
    }
  }
});

/**
 * 获取用户资产列表
 * GET /api/external/assets/list
 * 转发到外部接口：GET /assetsApi/pr/assets/list/count
 */
router.get('/assets/list', async (req, res) => {
  try {
    const { usn, rightsType, currentPage, pageSize } = req.query;
    const authToken = req.headers.authorization;

    // 参数验证
    if (!usn || typeof usn !== 'string' || usn.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'usn参数不能为空',
        data: null
      });
    }

    if (!currentPage || isNaN(parseInt(currentPage)) || parseInt(currentPage) < 1) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'currentPage参数必须为正整数',
        data: null
      });
    }

    if (!pageSize || isNaN(parseInt(pageSize)) || parseInt(pageSize) < 1) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'pageSize参数必须为正整数',
        data: null
      });
    }

    if (!authToken || typeof authToken !== 'string' || authToken.trim().length === 0) {
      return res.status(401).json({
        code: 401,
        status: false,
        message: 'Authorization头部不能为空',
        data: null
      });
    }

    // 构建请求参数
    const params = {
      usn: usn.trim(),
      currentPage: parseInt(currentPage),
      pageSize: parseInt(pageSize)
    };

    // 添加可选参数
    if (rightsType !== undefined && rightsType !== null && rightsType !== '') {
      if (!['1', '2'].includes(rightsType)) {
        return res.status(400).json({
          code: 400,
          status: false,
          message: 'rightsType参数值必须为1或2',
          data: null
        });
      }
      params.rightsType = rightsType;
    }

    // 调用外部API获取用户资产列表
    const response = await axios.get(
      `${EXTERNAL_API_CONFIG.BASE_URL}${EXTERNAL_API_CONFIG.ASSETS.LIST_COUNT}`,
      {
        params,
        headers: {
          'Authorization': authToken.trim()
        },
        timeout: 10000
      }
    );

    // 返回外部API的响应
    res.json(response.data);

  } catch (error) {
    console.error('获取用户资产列表失败:', error);

    // 处理不同类型的错误
    if (error.response) {
      // 外部API返回了错误响应
      res.status(error.response.status).json({
        code: error.response.status,
        status: false,
        message: error.response.data?.message || '外部接口调用失败',
        data: null
      });
    } else if (error.request) {
      // 请求发送失败
      res.status(500).json({
        code: 500,
        status: false,
        message: '外部接口连接失败',
        data: null
      });
    } else {
      // 其他错误
      res.status(500).json({
        code: 500,
        status: false,
        message: '服务器内部错误',
        data: null
      });
    }
  }
});

/**
 * 获取外部资产类型列表（树形结构）
 * GET /api/external/asset-types/list
 * 转发到外部接口：GET /assetsApi/pr/basic/type/list
 */
router.get('/asset-types/list', async (req, res) => {
  try {
    // 调用外部API获取资产类型列表
    const response = await axios.get(
      `${EXTERNAL_API_CONFIG.BASE_URL}${EXTERNAL_API_CONFIG.ASSET_TYPES.LIST}`,
      {
        timeout: 10000
      }
    );

    // 返回外部API的响应
    res.json(response.data);

  } catch (error) {
    console.error('获取外部资产类型列表失败:', error);

    // 处理不同类型的错误
    if (error.response) {
      // 外部API返回了错误响应
      res.status(error.response.status).json({
        code: error.response.status,
        status: false,
        message: error.response.data?.message || '外部接口调用失败',
        data: null
      });
    } else if (error.request) {
      // 请求发送失败
      res.status(500).json({
        code: 500,
        status: false,
        message: '外部接口连接失败',
        data: null
      });
    } else {
      // 其他错误
      res.status(500).json({
        code: 500,
        status: false,
        message: '服务器内部错误',
        data: null
      });
    }
  }
});

/**
 * 更新外部资产类型
 * PUT /api/external/asset-types/:id
 */
router.put('/asset-types/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, pid } = req.body;

    // 参数验证
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: '类型名称不能为空',
        data: null
      });
    }

    // 构建请求参数
    const requestData = {
      name: name.trim(),
      pid: pid || null
    };

    // 调用外部API
    const response = await axios.put(
      `${EXTERNAL_API_CONFIG.BASE_URL}/assetsApi/pr/basic/pt/type/update/${id}`,
      requestData,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    res.json(response.data);

  } catch (error) {
    console.error('更新外部资产类型失败:', error);

    if (error.response) {
      res.status(error.response.status).json({
        code: error.response.status,
        status: false,
        message: error.response.data?.message || '外部接口调用失败',
        data: null
      });
    } else {
      res.status(500).json({
        code: 500,
        status: false,
        message: '服务器内部错误',
        data: null
      });
    }
  }
});

/**
 * 删除外部资产类型
 * DELETE /api/external/asset-types/:id
 */
router.delete('/asset-types/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 调用外部API
    const response = await axios.delete(
      `${EXTERNAL_API_CONFIG.BASE_URL}/assetsApi/pr/basic/pt/type/delete/${id}`,
      {
        timeout: 10000
      }
    );

    res.json(response.data);

  } catch (error) {
    console.error('删除外部资产类型失败:', error);

    if (error.response) {
      res.status(error.response.status).json({
        code: error.response.status,
        status: false,
        message: error.response.data?.message || '外部接口调用失败',
        data: null
      });
    } else {
      res.status(500).json({
        code: 500,
        status: false,
        message: '服务器内部错误',
        data: null
      });
    }
  }
});

/**
 * 通用外部API代理
 * 可以用于转发其他外部接口调用
 */
router.all('/proxy/*', async (req, res) => {
  try {
    const targetPath = req.params[0]; // 获取通配符匹配的路径
    const method = req.method.toLowerCase();
    const requestData = method === 'get' ? req.query : req.body;

    // 构建目标URL
    const targetUrl = `${EXTERNAL_API_CONFIG.BASE_URL}/${targetPath}`;

    // 配置请求选项
    const config = {
      method,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    // 根据请求方法设置参数
    if (method === 'get') {
      config.params = requestData;
    } else {
      config.data = requestData;
    }

    // 调用外部API
    const response = await axios(targetUrl, config);

    // 返回外部API的响应
    res.json(response.data);

  } catch (error) {
    console.error('外部API代理调用失败:', error);

    if (error.response) {
      res.status(error.response.status).json({
        code: error.response.status,
        status: false,
        message: error.response.data?.message || '外部接口调用失败',
        data: null
      });
    } else {
      res.status(500).json({
        code: 500,
        status: false,
        message: '服务器内部错误',
        data: null
      });
    }
  }
});

/**
 * 获取订单列表
 * POST /api/external/order/list
 * 转发到外部接口：POST https://node.wespace.cn/orderApi/order/list
 */
router.post('/order/list', async (req, res) => {
  try {
    // 从请求头获取 authorization 和 tenantid
    const authorization = req.headers.authorization || req.headers.Authorization;
    const tenantid = req.headers.tenantid || req.headers.Tenantid || 'wespace';

    // 构建请求体（保持原始格式）
    let requestBody;
    if (typeof req.body === 'string') {
      // 如果请求体是字符串，直接使用
      requestBody = req.body;
    } else if (req.body && typeof req.body === 'object') {
      // 如果是对象，转换为 form-urlencoded 格式
      const formDataParts = [];
      for (const [key, value] of Object.entries(req.body)) {
        if (value !== undefined && value !== null) {
          formDataParts.push(`${key}=${encodeURIComponent(String(value))}`);
        }
      }
      requestBody = formDataParts.join('&');
    } else {
      requestBody = '';
    }

    // 调用外部API
    const response = await axios.post(
      `${EXTERNAL_API_CONFIG.VERIFICATION_CODE_BASE_URL}/orderApi/order/list`,
      requestBody,
      {
        headers: {
          'authorization': authorization,
          'tenantid': tenantid,
          'apptype': req.headers.apptype || '16',
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': req.headers['content-length'] || String(Buffer.byteLength(requestBody, 'utf8')),
          'pragma': req.headers.pragma || 'no-cache',
          'cache-control': req.headers['cache-control'] || 'no-cache',
          'origin': req.headers.origin || 'https://m.wespace.cn',
          'referer': req.headers.referer || 'https://m.wespace.cn/',
          'user-agent': req.headers['user-agent'] || 'Mozilla/5.0',
          'accept': req.headers.accept || '*/*',
          'accept-encoding': req.headers['accept-encoding'] || 'gzip, deflate, br, zstd',
          'accept-language': req.headers['accept-language'] || 'zh-CN,zh;q=0.9,en;q=0.8',
          'sec-fetch-site': req.headers['sec-fetch-site'] || 'same-site',
          'sec-fetch-mode': req.headers['sec-fetch-mode'] || 'cors',
          'sec-fetch-dest': req.headers['sec-fetch-dest'] || 'empty',
          'priority': req.headers.priority || 'u=1, i'
        },
        transformRequest: [(data) => {
          return typeof data === 'string' ? data : data;
        }],
        timeout: 10000
      }
    );

    // 直接返回外部API的响应
    res.status(response.status).json(response.data);

  } catch (error) {
    console.error('获取订单列表失败:', error);

    if (error.response) {
      // 外部API返回了错误响应
      const statusCode = error.response.status || 500;
      const responseData = error.response.data || {
        code: statusCode,
        status: false,
        message: '获取订单列表失败'
      };
      res.status(statusCode).json(responseData);
    } else if (error.request) {
      // 请求发送失败
      res.status(500).json({
        code: 500,
        status: false,
        message: '外部接口连接失败'
      });
    } else {
      // 其他错误
      res.status(500).json({
        code: 500,
        status: false,
        message: '服务器内部错误'
      });
    }
  }
});

/**
 * 获取订单详情
 * POST /api/external/order/detail
 * 转发到外部接口：POST https://node.wespace.cn/orderApi/order/detail
 */
router.post('/order/detail', async (req, res) => {
  try {
    // 从请求头获取 authorization 和 tenantid
    const authorization = req.headers.authorization || req.headers.Authorization;
    const tenantid = req.headers.tenantid || req.headers.Tenantid || 'wespace';

    // 构建请求体（保持原始格式）
    let requestBody;
    if (typeof req.body === 'string') {
      // 如果请求体是字符串，直接使用
      requestBody = req.body;
    } else if (req.body && typeof req.body === 'object') {
      // 如果是对象，转换为 form-urlencoded 格式
      const formDataParts = [];
      for (const [key, value] of Object.entries(req.body)) {
        if (value !== undefined && value !== null) {
          formDataParts.push(`${key}=${encodeURIComponent(String(value))}`);
        }
      }
      requestBody = formDataParts.join('&');
    } else {
      requestBody = '';
    }

    // 调用外部API
    const response = await axios.post(
      `${EXTERNAL_API_CONFIG.VERIFICATION_CODE_BASE_URL}/orderApi/order/detail`,
      requestBody,
      {
        headers: {
          'authorization': authorization,
          'tenantid': tenantid,
          'apptype': req.headers.apptype || '16',
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': req.headers['content-length'] || String(Buffer.byteLength(requestBody, 'utf8')),
          'pragma': req.headers.pragma || 'no-cache',
          'cache-control': req.headers['cache-control'] || 'no-cache',
          'origin': req.headers.origin || 'https://m.wespace.cn',
          'referer': req.headers.referer || 'https://m.wespace.cn/',
          'user-agent': req.headers['user-agent'] || 'Mozilla/5.0',
          'accept': req.headers.accept || '*/*',
          'accept-encoding': req.headers['accept-encoding'] || 'gzip, deflate, br, zstd',
          'accept-language': req.headers['accept-language'] || 'zh-CN,zh;q=0.9,en;q=0.8',
          'sec-fetch-site': req.headers['sec-fetch-site'] || 'same-site',
          'sec-fetch-mode': req.headers['sec-fetch-mode'] || 'cors',
          'sec-fetch-dest': req.headers['sec-fetch-dest'] || 'empty',
          'priority': req.headers.priority || 'u=1, i'
        },
        transformRequest: [(data) => {
          return typeof data === 'string' ? data : data;
        }],
        timeout: 10000
      }
    );

    // 直接返回外部API的响应
    res.status(response.status).json(response.data);

  } catch (error) {
    console.error('获取订单详情失败:', error);

    if (error.response) {
      // 外部API返回了错误响应
      const statusCode = error.response.status || 500;
      const responseData = error.response.data || {
        code: statusCode,
        status: false,
        message: '获取订单详情失败'
      };
      res.status(statusCode).json(responseData);
    } else if (error.request) {
      // 请求发送失败
      res.status(500).json({
        code: 500,
        status: false,
        message: '外部接口连接失败'
      });
    } else {
      // 其他错误
      res.status(500).json({
        code: 500,
        status: false,
        message: '服务器内部错误'
      });
    }
  }
});

module.exports = router; 