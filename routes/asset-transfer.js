const express = require('express');
const router = express.Router();
const axios = require('axios');

/**
 * 外部API配置
 */
const EXTERNAL_API_CONFIG = {
  BASE_URL: 'https://yapi.licenseinfo.cn/mock/600',
  ASSET_TRANSFER: {
    // 资产过户接口路径配置
    TRANSFER_V2: '/assetsApi/foreign/asset/v2/transfer/supper/node/v2',
    // 资产过户详情接口
    TRANSFER_DETAILS_V1: '/assetsApi/foreign/asset/v2/transfer/details/v1'
  }
};

/**
 * 资产过户
 * POST /api/asset-transfer/transfer
 * 转发到外部接口：POST /assetsApi/foreign/asset/v2/transfer/supper/node/v2
 */
router.post('/transfer', async (req, res) => {
  try {
    const {
      assetsId,
      sellUsn,
      buyUsn,
      price,
      notifyUrl,
      buyMobile,
      id,
      type,
      currency
    } = req.body;

    // 必需参数验证
    const requiredFields = [
      'assetsId', 'sellUsn', 'buyUsn', 'price', 
      'notifyUrl', 'buyMobile', 'id', 'type', 'currency'
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
    if (type !== '1') {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'type参数必须为1（过户）',
        data: null
      });
    }

    // 验证价格格式（必须为正整数）
    if (isNaN(parseInt(price)) || parseInt(price) <= 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'price参数必须为正整数（单位：分）',
        data: null
      });
    }

    // 验证手机号格式（简单验证）
    const mobileRegex = /^1[3-9]\d{9}$/;
    if (!mobileRegex.test(buyMobile)) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'buyMobile参数格式不正确',
        data: null
      });
    }

    // 验证币种
    const validCurrencies = [
      'CNY', 'GBP', 'USD', 'CAD', 'EUR', 'KRW', 'HKD', 'JPY', 'AUD', 'RUB',
      'AED', 'MYR', 'SGD', 'THB', 'INR', 'IDR', 'XOF', 'ZAR', 'SAR', 'GHS',
      'ZMW', 'KES', 'NGN'
    ];
    
    if (!validCurrencies.includes(currency)) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'currency参数不是有效的币种',
        data: null
      });
    }

    // 验证回调URL格式
    try {
      new URL(notifyUrl);
    } catch (error) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'notifyUrl参数格式不正确',
        data: null
      });
    }

    // 构建请求数据
    const requestData = {
      assetsId: assetsId.trim(),
      sellUsn: sellUsn.trim(),
      buyUsn: buyUsn.trim(),
      price: price.toString(),
      notifyUrl: notifyUrl.trim(),
      buyMobile: buyMobile.trim(),
      id: id.trim(),
      type: type,
      currency: currency
    };

    // 调用外部API进行资产过户
    const response = await axios.post(
      `${EXTERNAL_API_CONFIG.BASE_URL}${EXTERNAL_API_CONFIG.ASSET_TRANSFER.TRANSFER_V2}`,
      requestData,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30秒超时，因为过户操作可能需要较长时间
      }
    );

    // 返回外部API的响应
    res.json(response.data);

  } catch (error) {
    console.error('资产过户失败:', error);
    
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
 * 资产过户回调处理
 * POST /api/asset-transfer/callback
 * 处理外部API的回调通知
 */
router.post('/callback', async (req, res) => {
  try {
    const { id, status, msg, time } = req.body;
    
    console.log('收到资产过户回调:', {
      id,
      status,
      msg,
      time
    });

    // 验证回调参数
    if (!id || !status || !time) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: '回调参数不完整',
        data: null
      });
    }

    // 处理过户结果
    if (status === '1') {
      // 过户成功
      console.log(`资产过户成功 - ID: ${id}, 时间: ${time}`);
      
      // 这里可以添加你的业务逻辑
      // 比如更新数据库状态、发送通知等
      
    } else if (status === '2') {
      // 过户失败
      console.log(`资产过户失败 - ID: ${id}, 原因: ${msg}, 时间: ${time}`);
      
      // 这里可以添加失败处理逻辑
      // 比如记录失败日志、发送失败通知等
      
    } else {
      console.log(`未知的过户状态 - ID: ${id}, 状态: ${status}`);
    }

    // 返回成功响应给外部API
    res.json({
      code: 200,
      status: true,
      message: '回调处理成功',
      data: null
    });

  } catch (error) {
    console.error('处理资产过户回调失败:', error);
    
    res.status(500).json({
      code: 500,
      status: false,
      message: '回调处理失败',
      data: null
    });
  }
});

/**
 * 获取资产过户状态
 * GET /api/asset-transfer/status/:id
 */
router.get('/status/:id', async (req, res) => {
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

    // 这里可以添加查询过户状态的逻辑
    // 比如从数据库查询过户记录的状态
    
    // 示例响应
    res.json({
      code: 200,
      status: true,
      message: '查询成功',
      data: {
        id: id,
        status: 'pending', // pending, success, failed
        message: '过户处理中',
        createTime: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('查询资产过户状态失败:', error);
    
    res.status(500).json({
      code: 500,
      status: false,
      message: '查询失败',
      data: null
    });
  }
});

/**
 * 资产过户详情--主动获取过户结果
 * POST /api/asset-transfer/details
 * 转发到外部接口：POST /assetsApi/foreign/asset/v2/transfer/details/v1
 */
router.post('/details', async (req, res) => {
  try {
    const { id } = req.body;
    
    // 必需参数验证
    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'id参数不能为空',
        data: null
      });
    }

    // 构建请求数据
    const requestData = {
      id: id.trim()
    };

    // 调用外部API获取资产过户详情
    const response = await axios.post(
      `${EXTERNAL_API_CONFIG.BASE_URL}${EXTERNAL_API_CONFIG.ASSET_TRANSFER.TRANSFER_DETAILS_V1}`,
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
    console.error('获取资产过户详情失败:', error);
    
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
 * 获取支持的币种列表
 * GET /api/asset-transfer/currencies
 */
router.get('/currencies', async (req, res) => {
  try {
    const currencies = [
      { code: 'CNY', name: '人民币' },
      { code: 'GBP', name: '英镑' },
      { code: 'USD', name: '美元' },
      { code: 'CAD', name: '加元' },
      { code: 'EUR', name: '欧元' },
      { code: 'KRW', name: '韩元' },
      { code: 'HKD', name: '港币' },
      { code: 'JPY', name: '日元' },
      { code: 'AUD', name: '澳元' },
      { code: 'RUB', name: '卢布' },
      { code: 'AED', name: '阿联酋迪拉姆' },
      { code: 'MYR', name: '马来西亚林吉特' },
      { code: 'SGD', name: '新加坡元' },
      { code: 'THB', name: '泰国铢' },
      { code: 'INR', name: '印度卢比' },
      { code: 'IDR', name: '印尼卢比' },
      { code: 'XOF', name: '西非法郎' },
      { code: 'ZAR', name: '南非兰特' },
      { code: 'SAR', name: '沙特里亚尔' },
      { code: 'GHS', name: '加纳赛地' },
      { code: 'ZMW', name: '赞比亚克瓦查' },
      { code: 'KES', name: '肯尼亚先令' },
      { code: 'NGN', name: '尼日利亚奈拉' }
    ];

    res.json({
      code: 200,
      status: true,
      message: '获取成功',
      data: currencies
    });

  } catch (error) {
    console.error('获取币种列表失败:', error);
    
    res.status(500).json({
      code: 500,
      status: false,
      message: '获取失败',
      data: null
    });
  }
});

module.exports = router;
