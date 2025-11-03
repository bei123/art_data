const express = require('express');
const router = express.Router();
const axios = require('axios');

/**
 * 外部API配置
 */
const EXTERNAL_API_CONFIG = {
  BASE_URL: 'https://yapi.licenseinfo.cn/mock/600',
  ISSUANCE: {
    // 发行铸造相关接口路径配置
    CREATE: '/issuance/create',
    UPDATE: '/issuance/update',
    DELETE: '/issuance/delete',
    LIST: '/issuance/list'
  },
  ASSETS: {
    // 产品信息录入接口
    ISSUE_INSERT_V4: '/assetsApi/pr/issue/insert/v4',
    // 资产列表接口
    ASSETS_LIST_V4: '/assetsApi/pr/assets/list/v4',
    // 产品铸造详情接口
    ISSUE_DETAILS: '/assetsApi/pr/issue/details'
  }
};

/**
 * 创建发行铸造
 * POST /api/issuance/create
 */
router.post('/create', async (req, res) => {
  try {
    const authToken = req.headers.authorization;

    // 验证Authorization头部
    if (!authToken || typeof authToken !== 'string' || authToken.trim().length === 0) {
      return res.status(401).json({
        code: 401,
        status: false,
        message: 'Authorization头部不能为空',
        data: null
      });
    }

    // 调用外部API创建发行铸造
    const response = await axios.post(
      `${EXTERNAL_API_CONFIG.BASE_URL}${EXTERNAL_API_CONFIG.ISSUANCE.CREATE}`,
      req.body,
      {
        headers: {
          'Authorization': authToken.trim(),
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    // 返回外部API的响应
    res.json(response.data);

  } catch (error) {
    console.error('创建发行铸造失败:', error);

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
 * 更新发行铸造
 * PUT /api/issuance/update/:id
 */
router.put('/update/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const authToken = req.headers.authorization;

    // 参数验证
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'ID参数无效',
        data: null
      });
    }

    // 验证Authorization头部
    if (!authToken || typeof authToken !== 'string' || authToken.trim().length === 0) {
      return res.status(401).json({
        code: 401,
        status: false,
        message: 'Authorization头部不能为空',
        data: null
      });
    }

    // 调用外部API更新发行铸造
    const response = await axios.put(
      `${EXTERNAL_API_CONFIG.BASE_URL}${EXTERNAL_API_CONFIG.ISSUANCE.UPDATE}/${id}`,
      req.body,
      {
        headers: {
          'Authorization': authToken.trim(),
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    // 返回外部API的响应
    res.json(response.data);

  } catch (error) {
    console.error('更新发行铸造失败:', error);

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
 * 删除发行铸造
 * DELETE /api/issuance/delete/:id
 */
router.delete('/delete/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const authToken = req.headers.authorization;

    // 参数验证
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'ID参数无效',
        data: null
      });
    }

    // 验证Authorization头部
    if (!authToken || typeof authToken !== 'string' || authToken.trim().length === 0) {
      return res.status(401).json({
        code: 401,
        status: false,
        message: 'Authorization头部不能为空',
        data: null
      });
    }

    // 调用外部API删除发行铸造
    const response = await axios.delete(
      `${EXTERNAL_API_CONFIG.BASE_URL}${EXTERNAL_API_CONFIG.ISSUANCE.DELETE}/${id}`,
      {
        headers: {
          'Authorization': authToken.trim()
        },
        timeout: 10000
      }
    );

    // 返回外部API的响应
    res.json(response.data);

  } catch (error) {
    console.error('删除发行铸造失败:', error);

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
 * 获取发行铸造列表
 * GET /api/issuance/list
 */
router.get('/list', async (req, res) => {
  try {
    const { currentPage, pageSize, status, type } = req.query;
    const authToken = req.headers.authorization;

    // 参数验证
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

    // 验证Authorization头部
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
      currentPage: parseInt(currentPage),
      pageSize: parseInt(pageSize)
    };

    // 添加可选参数
    if (status !== undefined && status !== null && status !== '') {
      params.status = status;
    }

    if (type !== undefined && type !== null && type !== '') {
      params.type = type;
    }

    // 调用外部API获取发行铸造列表
    const response = await axios.get(
      `${EXTERNAL_API_CONFIG.BASE_URL}${EXTERNAL_API_CONFIG.ISSUANCE.LIST}`,
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
    console.error('获取发行铸造列表失败:', error);

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
 * 产品信息录入
 * POST /api/issuance/product/insert
 * 转发到外部接口：POST /assetsApi/pr/issue/insert/v4
 */
router.post('/product/insert', async (req, res) => {
  try {
    const {
      prBasicId,
      prIssueId,
      prIssueName,
      prIssueCover,
      prIssueContent,
      prIssueContentPic,
      prPrice,
      prNum,
      prEdition,
      prEditionId,
      prLockNum,
      prIssueFile,
      registerCerNo,
      issueRightsType,
      issueRightsDesc,
      holderRightsDesc,
      issueAssetsNum,
      IsAddIssue,
      callbackUrl,
      productFront,
      productBack
    } = req.body;

    // 必需参数验证
    const requiredFields = [
      'prBasicId', 'prIssueId', 'prIssueName', 'prIssueCover',
      'prPrice', 'prNum', 'prLockNum', 'prIssueFile',
      'registerCerNo', 'issueRightsType', 'issueRightsDesc',
      'holderRightsDesc', 'issueAssetsNum'
    ];

    for (const field of requiredFields) {
      if (!req.body[field] || (typeof req.body[field] === 'string' && req.body[field].trim().length === 0)) {
        return res.status(400).json({
          code: 400,
          status: false,
          message: `${field}参数不能为空`,
          data: null
        });
      }
    }

    // 特殊参数验证
    if (prPrice && (isNaN(parseInt(prPrice)) || parseInt(prPrice) < 0)) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'prPrice参数必须为非负整数',
        data: null
      });
    }

    if (prNum && (isNaN(parseInt(prNum)) || parseInt(prNum) <= 0)) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'prNum参数必须为正整数',
        data: null
      });
    }

    if (prLockNum && (isNaN(parseInt(prLockNum)) || parseInt(prLockNum) < 0)) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'prLockNum参数必须为非负整数',
        data: null
      });
    }

    if (issueAssetsNum && (isNaN(parseInt(issueAssetsNum)) || parseInt(issueAssetsNum) <= 0)) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'issueAssetsNum参数必须为正整数',
        data: null
      });
    }

    // 验证prIssueId长度（最多19位）
    if (prIssueId && prIssueId.toString().length > 19) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'prIssueId参数最多19位',
        data: null
      });
    }

    // 验证数组参数
    if (issueRightsDesc && (!Array.isArray(issueRightsDesc) || issueRightsDesc.length === 0)) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'issueRightsDesc参数必须为非空数组',
        data: null
      });
    }

    if (holderRightsDesc && (!Array.isArray(holderRightsDesc) || holderRightsDesc.length === 0)) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'holderRightsDesc参数必须为非空数组',
        data: null
      });
    }

    // 验证数组中的对象格式
    const validateRightsDesc = (desc, name) => {
      for (let i = 0; i < desc.length; i++) {
        const item = desc[i];
        if (!item.num || !item.value ||
          typeof item.num !== 'number' ||
          typeof item.value !== 'string' ||
          item.value.trim().length === 0) {
          return res.status(400).json({
            code: 400,
            status: false,
            message: `${name}参数第${i + 1}项格式不正确，需要包含num和value字段`,
            data: null
          });
        }
      }
    };

    if (issueRightsDesc) {
      validateRightsDesc(issueRightsDesc, 'issueRightsDesc');
    }

    if (holderRightsDesc) {
      validateRightsDesc(holderRightsDesc, 'holderRightsDesc');
    }

    // 构建请求数据
    const requestData = {
      prBasicId: prBasicId.trim(),
      prIssueId: prIssueId.toString(),
      prIssueName: prIssueName.trim(),
      prIssueCover: prIssueCover.trim(),
      prPrice: parseInt(prPrice),
      prNum: prNum.toString(),
      prLockNum: prLockNum.toString(),
      prIssueFile: prIssueFile.trim(),
      registerCerNo: registerCerNo.trim(),
      issueRightsType: issueRightsType.trim(),
      issueRightsDesc,
      holderRightsDesc,
      issueAssetsNum: issueAssetsNum.toString()
    };

    // 添加可选参数
    if (prIssueContent) {
      requestData.prIssueContent = prIssueContent.trim();
    }

    if (prIssueContentPic && Array.isArray(prIssueContentPic)) {
      requestData.prIssueContentPic = prIssueContentPic;
    }

    if (prEdition) {
      requestData.prEdition = prEdition.trim();
    }

    if (prEditionId) {
      requestData.prEditionId = prEditionId.trim();
    }

    if (IsAddIssue) {
      requestData.IsAddIssue = IsAddIssue.toString();
    }

    if (callbackUrl) {
      requestData.callbackUrl = callbackUrl.trim();
    }

    if (productFront) {
      requestData.productFront = productFront.trim();
    }

    if (productBack) {
      requestData.productBack = productBack.trim();
    }

    // 调用外部API
    const response = await axios.post(
      `${EXTERNAL_API_CONFIG.BASE_URL}${EXTERNAL_API_CONFIG.ASSETS.ISSUE_INSERT_V4}`,
      requestData,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30秒超时，因为这是复杂的产品录入操作
      }
    );

    // 返回外部API的响应
    res.json(response.data);

  } catch (error) {
    console.error('产品信息录入失败:', error);

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
 * 主动拉取已铸造资产列表
 * POST /api/issuance/assets/list
 * 转发到外部接口：POST /assetsApi/pr/assets/list/v4
 */
router.post('/assets/list', async (req, res) => {
  try {
    const { currentPage, pageSize, prIssueId } = req.body;

    // 必需参数验证
    if (!prIssueId || typeof prIssueId !== 'string' || prIssueId.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'prIssueId参数不能为空',
        data: null
      });
    }

    // 构建请求数据
    const requestData = {
      prIssueId: prIssueId.trim()
    };

    // 添加可选参数
    if (currentPage !== undefined && currentPage !== null) {
      if (isNaN(parseInt(currentPage)) || parseInt(currentPage) < 1) {
        return res.status(400).json({
          code: 400,
          status: false,
          message: 'currentPage参数必须为正整数',
          data: null
        });
      }
      requestData.currentPage = parseInt(currentPage);
    } else {
      requestData.currentPage = 1; // 默认值
    }

    if (pageSize !== undefined && pageSize !== null) {
      if (isNaN(parseInt(pageSize)) || parseInt(pageSize) < 1) {
        return res.status(400).json({
          code: 400,
          status: false,
          message: 'pageSize参数必须为正整数',
          data: null
        });
      }
      requestData.pageSize = parseInt(pageSize);
    } else {
      requestData.pageSize = 20; // 默认值
    }

    // 调用外部API获取资产列表
    const response = await axios.post(
      `${EXTERNAL_API_CONFIG.BASE_URL}${EXTERNAL_API_CONFIG.ASSETS.ASSETS_LIST_V4}`,
      requestData,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 15000 // 15秒超时
      }
    );

    // 返回外部API的响应
    res.json(response.data);

  } catch (error) {
    console.error('获取已铸造资产列表失败:', error);

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
 * 获取产品铸造详情
 * POST /api/issuance/product/details
 * 转发到外部接口：POST /assetsApi/pr/issue/details
 */
router.post('/product/details', async (req, res) => {
  try {
    const { prIssueId } = req.query;

    // 必需参数验证
    if (!prIssueId || typeof prIssueId !== 'string' || prIssueId.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'prIssueId参数不能为空',
        data: null
      });
    }

    // 调用外部API获取产品铸造详情
    const response = await axios.post(
      `${EXTERNAL_API_CONFIG.BASE_URL}${EXTERNAL_API_CONFIG.ASSETS.ISSUE_DETAILS}`,
      null, // 没有请求体
      {
        params: {
          prIssueId: prIssueId.trim()
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 15000 // 15秒超时
      }
    );

    // 返回外部API的响应
    res.json(response.data);

  } catch (error) {
    console.error('获取产品铸造详情失败:', error);

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
 * 获取发行铸造详情
 * GET /api/issuance/detail/:id
 */
router.get('/detail/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const authToken = req.headers.authorization;

    // 参数验证
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'ID参数无效',
        data: null
      });
    }

    // 验证Authorization头部
    if (!authToken || typeof authToken !== 'string' || authToken.trim().length === 0) {
      return res.status(401).json({
        code: 401,
        status: false,
        message: 'Authorization头部不能为空',
        data: null
      });
    }

    // 调用外部API获取发行铸造详情
    const response = await axios.get(
      `${EXTERNAL_API_CONFIG.BASE_URL}${EXTERNAL_API_CONFIG.ISSUANCE.LIST}/${id}`,
      {
        headers: {
          'Authorization': authToken.trim()
        },
        timeout: 10000
      }
    );

    // 返回外部API的响应
    res.json(response.data);

  } catch (error) {
    console.error('获取发行铸造详情失败:', error);

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

module.exports = router; 