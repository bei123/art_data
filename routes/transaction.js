const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const axios = require('axios');
const { requireAdmin } = require('../auth');
const { notImplementedBody } = require('../utils/publicApiSanitizer');

router.use(...requireAdmin);

/**
 * 外部API配置
 */
const EXTERNAL_API_CONFIG = {
  BASE_URL: 'https://yapi.licenseinfo.cn/mock/600',
  TRANSACTION: {
    // 交易记录接口路径配置
    TRANSACTION_RECORDS_V1: '/assetsApi/pr/assets/node/transaction_records/v1'
  }
};

/**
 * 获取交易记录
 * POST /api/transaction/records
 * 转发到外部接口：POST /assetsApi/pr/assets/node/transaction_records/v1
 */
router.post('/records', async (req, res) => {
  try {
    const { currentPage, pageSize, qrCodeId } = req.body;

    // 必需参数验证
    if (!qrCodeId || typeof qrCodeId !== 'string' || qrCodeId.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'qrCodeId参数不能为空',
        data: null
      });
    }

    // 构建请求数据
    const requestData = {
      qrCodeId: qrCodeId.trim()
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

    // 调用外部API获取交易记录
    const response = await axios.post(
      `${EXTERNAL_API_CONFIG.BASE_URL}${EXTERNAL_API_CONFIG.TRANSACTION.TRANSACTION_RECORDS_V1}`,
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
    logger.error('获取交易记录失败:', { err: error })

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
 * 获取交易记录详情
 * GET /api/transaction/detail/:id
 */
router.get('/detail/:id', async (req, res) => {
  return res.status(501).json(notImplementedBody('交易记录详情'));
});

/**
 * 获取交易统计信息
 * GET /api/transaction/statistics
 */
router.get('/statistics', async (req, res) => {
  return res.status(501).json(notImplementedBody('交易统计'));
});

/**
 * 导出交易记录
 * POST /api/transaction/export
 */
router.post('/export', async (req, res) => {
  return res.status(501).json(notImplementedBody('交易记录导出'));
});

/**
 * 获取交易类型列表
 * GET /api/transaction/types
 */
router.get('/types', async (req, res) => {
  try {
    const transactionTypes = [
      { code: 'transfer', name: '过户', description: '资产过户交易' },
      { code: 'purchase', name: '购买', description: '资产购买交易' },
      { code: 'sale', name: '销售', description: '资产销售交易' },
      { code: 'gift', name: '赠送', description: '资产赠送交易' },
      { code: 'pledge', name: '质押', description: '资产质押交易' },
      { code: 'borrow', name: '借阅', description: '资产借阅交易' },
      { code: 'return', name: '归还', description: '资产归还交易' }
    ];

    res.json({
      code: 200,
      status: true,
      message: '获取成功',
      data: transactionTypes
    });

  } catch (error) {
    logger.error('获取交易类型列表失败:', { err: error })

    res.status(500).json({
      code: 500,
      status: false,
      message: '获取失败',
      data: null
    });
  }
});

module.exports = router; 