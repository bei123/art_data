const express = require('express');
const router = express.Router();
const axios = require('axios');

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
  }
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

module.exports = router; 