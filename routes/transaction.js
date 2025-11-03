const express = require('express');
const router = express.Router();
const axios = require('axios');

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
    console.error('获取交易记录失败:', error);

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
  try {
    const { id } = req.params;

    // 参数验证
    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'ID参数不能为空',
        data: null
      });
    }

    // 这里可以添加查询交易记录详情的逻辑
    // 比如从数据库查询具体的交易记录

    // 示例响应
    res.json({
      code: 200,
      status: true,
      message: '查询成功',
      data: {
        id: id,
        qrCodeId: 'WSAbBZmQpgt',
        transactionType: 'transfer',
        fromUsn: 'SELLER001',
        toUsn: 'BUYER002',
        price: 10000,
        currency: 'CNY',
        status: 'success',
        createTime: new Date().toISOString(),
        completeTime: new Date().toISOString(),
        remark: '资产过户交易'
      }
    });

  } catch (error) {
    console.error('获取交易记录详情失败:', error);

    res.status(500).json({
      code: 500,
      status: false,
      message: '查询失败',
      data: null
    });
  }
});

/**
 * 获取交易统计信息
 * GET /api/transaction/statistics
 */
router.get('/statistics', async (req, res) => {
  try {
    const { qrCodeId, startDate, endDate } = req.query;

    // 参数验证
    if (!qrCodeId || typeof qrCodeId !== 'string' || qrCodeId.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'qrCodeId参数不能为空',
        data: null
      });
    }

    // 这里可以添加查询交易统计信息的逻辑
    // 比如统计交易次数、总金额、成功率等

    // 示例响应
    res.json({
      code: 200,
      status: true,
      message: '查询成功',
      data: {
        qrCodeId: qrCodeId,
        totalTransactions: 10,
        totalAmount: 100000,
        successCount: 9,
        failedCount: 1,
        successRate: 90,
        averagePrice: 10000,
        firstTransactionTime: '2024-01-01 00:00:00',
        lastTransactionTime: '2024-06-19 14:38:40'
      }
    });

  } catch (error) {
    console.error('获取交易统计信息失败:', error);

    res.status(500).json({
      code: 500,
      status: false,
      message: '查询失败',
      data: null
    });
  }
});

/**
 * 导出交易记录
 * POST /api/transaction/export
 */
router.post('/export', async (req, res) => {
  try {
    const { qrCodeId, startDate, endDate, format } = req.body;

    // 参数验证
    if (!qrCodeId || typeof qrCodeId !== 'string' || qrCodeId.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'qrCodeId参数不能为空',
        data: null
      });
    }

    // 验证导出格式
    const validFormats = ['excel', 'csv', 'pdf'];
    if (format && !validFormats.includes(format)) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'format参数必须是excel、csv或pdf',
        data: null
      });
    }

    // 这里可以添加导出交易记录的逻辑
    // 比如生成Excel文件、CSV文件或PDF文件

    // 示例响应
    res.json({
      code: 200,
      status: true,
      message: '导出成功',
      data: {
        downloadUrl: `https://your-domain.com/downloads/transaction_${qrCodeId}_${Date.now()}.${format || 'excel'}`,
        fileName: `transaction_${qrCodeId}_${new Date().toISOString().split('T')[0]}.${format || 'excel'}`,
        fileSize: '1.2MB',
        expireTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24小时后过期
      }
    });

  } catch (error) {
    console.error('导出交易记录失败:', error);

    res.status(500).json({
      code: 500,
      status: false,
      message: '导出失败',
      data: null
    });
  }
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
    console.error('获取交易类型列表失败:', error);

    res.status(500).json({
      code: 500,
      status: false,
      message: '获取失败',
      data: null
    });
  }
});

module.exports = router; 