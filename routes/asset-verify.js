const express = require('express');
const router = express.Router();
const axios = require('axios');

/**
 * 外部API配置
 */
const EXTERNAL_API_CONFIG = {
  BASE_URL: 'https://yapi.licenseinfo.cn/mock/600',
  ASSET_VERIFY: {
    // 查证接口路径配置
    SCAN_CODE_VERIFY: '/assetsApi/scan/code/verify'
  }
};

/**
 * 资产查证
 * GET /api/asset-verify/scan
 * 转发到外部接口：GET /assetsApi/scan/code/verify
 */
router.get('/scan', async (req, res) => {
  try {
    const { qrCodeId, info } = req.query;
    
    // 必需参数验证
    if (!qrCodeId || typeof qrCodeId !== 'string' || qrCodeId.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'qrCodeId参数不能为空',
        data: null
      });
    }

    if (!info || typeof info !== 'string' || info.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'info参数不能为空',
        data: null
      });
    }

    // 验证info参数是否为有效的JSON格式
    let infoObj;
    try {
      infoObj = JSON.parse(info);
    } catch (error) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'info参数必须是有效的JSON格式',
        data: null
      });
    }

    // 验证info对象中是否包含usn字段
    if (!infoObj.usn || typeof infoObj.usn !== 'string' || infoObj.usn.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'info.usn参数不能为空',
        data: null
      });
    }

    // 构建请求参数
    const params = {
      qrCodeId: qrCodeId.trim(),
      info: info.trim()
    };

    // 调用外部API进行资产查证
    const response = await axios.get(
      `${EXTERNAL_API_CONFIG.BASE_URL}${EXTERNAL_API_CONFIG.ASSET_VERIFY.SCAN_CODE_VERIFY}`,
      {
        params,
        timeout: 15000 // 15秒超时
      }
    );

    // 返回外部API的响应
    res.json(response.data);

  } catch (error) {
    console.error('资产查证失败:', error);
    
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
 * 生成查证信息JSON
 * POST /api/asset-verify/generate-info
 * 辅助接口，用于生成info参数的JSON字符串
 */
router.post('/generate-info', async (req, res) => {
  try {
    const { usn } = req.body;
    
    // 参数验证
    if (!usn || typeof usn !== 'string' || usn.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'usn参数不能为空',
        data: null
      });
    }

    // 生成info JSON
    const infoObj = {
      usn: usn.trim()
    };

    const infoJson = JSON.stringify(infoObj);

    res.json({
      code: 200,
      status: true,
      message: '生成成功',
      data: {
        info: infoJson,
        infoObj: infoObj
      }
    });

  } catch (error) {
    console.error('生成查证信息失败:', error);
    
    res.status(500).json({
      code: 500,
      status: false,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * 批量资产查证
 * POST /api/asset-verify/batch-scan
 * 批量查询多个资产的查证信息
 */
router.post('/batch-scan', async (req, res) => {
  try {
    const { qrCodeIds, usn } = req.body;
    
    // 参数验证
    if (!qrCodeIds || !Array.isArray(qrCodeIds) || qrCodeIds.length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'qrCodeIds参数必须为非空数组',
        data: null
      });
    }

    if (!usn || typeof usn !== 'string' || usn.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'usn参数不能为空',
        data: null
      });
    }

    // 生成info JSON
    const infoObj = { usn: usn.trim() };
    const infoJson = JSON.stringify(infoObj);

    // 批量查询
    const results = [];
    const errors = [];

    for (let i = 0; i < qrCodeIds.length; i++) {
      const qrCodeId = qrCodeIds[i];
      
      try {
        const response = await axios.get(
          `${EXTERNAL_API_CONFIG.BASE_URL}${EXTERNAL_API_CONFIG.ASSET_VERIFY.SCAN_CODE_VERIFY}`,
          {
            params: {
              qrCodeId: qrCodeId,
              info: infoJson
            },
            timeout: 10000
          }
        );

        results.push({
          qrCodeId: qrCodeId,
          success: true,
          data: response.data
        });

      } catch (error) {
        errors.push({
          qrCodeId: qrCodeId,
          success: false,
          error: error.response?.data?.message || '查询失败'
        });
      }
    }

    res.json({
      code: 200,
      status: true,
      message: '批量查证完成',
      data: {
        total: qrCodeIds.length,
        success: results.length,
        failed: errors.length,
        results: results,
        errors: errors
      }
    });

  } catch (error) {
    console.error('批量资产查证失败:', error);
    
    res.status(500).json({
      code: 500,
      status: false,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * 获取查证历史记录
 * GET /api/asset-verify/history
 */
router.get('/history', async (req, res) => {
  try {
    const { usn, currentPage, pageSize } = req.query;
    
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

    // 这里可以添加查询查证历史记录的逻辑
    // 比如从数据库查询该用户的查证记录
    
    // 示例响应
    res.json({
      code: 200,
      status: true,
      message: '查询成功',
      data: {
        list: [
          {
            id: 1,
            qrCodeId: 'WSAbBZmQpgt',
            usn: usn,
            verifyTime: new Date().toISOString(),
            assetName: '测试资产',
            status: 'success'
          }
        ],
        page: {
          totalRows: 1,
          currentPage: parseInt(currentPage),
          pageSize: parseInt(pageSize),
          totalPage: 1
        }
      }
    });

  } catch (error) {
    console.error('获取查证历史记录失败:', error);
    
    res.status(500).json({
      code: 500,
      status: false,
      message: '查询失败',
      data: null
    });
  }
});

module.exports = router; 