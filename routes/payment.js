const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const db = require('../db');

// 微信支付V3配置
const WX_PAY_CONFIG = {
  appId: 'wx96a502c78c9156d0',
  mchId: '1600000000',
  key: 'your_key',
  privateKey: 'your_private_key',
  serialNo: 'your_serial_no',
  spbillCreateIp: '127.0.0.1',
  notifyUrl: 'https://api.wx.2000gallery.art:2000/api/wx/pay/notify'
};

// 生成随机字符串
function generateNonceStr() {
  return Math.random().toString(36).substr(2, 15);
}

// 生成签名
function generateSignV3(method, url, timestamp, nonceStr, body) {
  const sign = crypto.createSign('RSA-SHA256');
  const signStr = `${method}\n${url}\n${timestamp}\n${nonceStr}\n${body}\n`;
  sign.update(signStr);
  return sign.sign(WX_PAY_CONFIG.privateKey, 'base64');
}

// 验证签名
function verifySignV3(timestamp, nonceStr, body, signature) {
  const verify = crypto.createVerify('RSA-SHA256');
  const verifyStr = `${timestamp}\n${nonceStr}\n${body}\n`;
  verify.update(verifyStr);
  return verify.verify(WX_PAY_CONFIG.privateKey, signature, 'base64');
}

// 解密回调数据
function decryptCallbackData(associatedData, nonce, ciphertext) {
  const key = Buffer.from(WX_PAY_CONFIG.key, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(associatedData, 'base64'));
  const decrypted = decipher.update(Buffer.from(ciphertext, 'base64'));
  return decrypted.toString();
}

// 统一下单接口
router.post('/unifiedorder', async (req, res) => {
  const { openid, order_id } = req.body;
  if (!openid || !order_id) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  try {
    // 获取订单信息
    const [orders] = await db.query('SELECT * FROM orders WHERE id = ?', [order_id]);
    if (!orders || orders.length === 0) {
      return res.status(404).json({ error: '订单不存在' });
    }
    const order = orders[0];

    // 获取订单项
    const [orderItems] = await db.query('SELECT * FROM order_items WHERE order_id = ?', [order_id]);

    // 构建支付参数
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = generateNonceStr();
    const params = {
      appid: WX_PAY_CONFIG.appId,
      mchid: WX_PAY_CONFIG.mchId,
      description: order.description || '商品支付',
      out_trade_no: order.order_no,
      notify_url: WX_PAY_CONFIG.notifyUrl,
      amount: {
        total: order.total_amount,
        currency: 'CNY'
      },
      scene_info: {
        payer_client_ip: WX_PAY_CONFIG.spbillCreateIp
      },
      payer: {
        openid: openid
      }
    };

    const url = '/v3/pay/transactions/jsapi';
    const body = JSON.stringify(params);
    const signature = generateSignV3('POST', url, timestamp, nonceStr, body);

    // 发送请求到微信支付
    const response = await axios.post('https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi', params, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('统一下单失败:', error);
    res.status(500).json({ error: '统一下单失败' });
  }
});

// 支付回调通知
router.post('/notify', async (req, res) => {
  try {
    const timestamp = req.headers['wechatpay-timestamp'];
    const nonce = req.headers['wechatpay-nonce'];
    const signature = req.headers['wechatpay-signature'];
    const serial = req.headers['wechatpay-serial'];

    // 验证签名
    if (!verifySignV3(timestamp, nonce, req.body, signature)) {
      return res.status(401).json({ error: '签名验证失败' });
    }

    // 解密数据
    const decryptedData = decryptCallbackData(
      req.body.associated_data,
      req.body.nonce,
      req.body.ciphertext
    );
    const data = JSON.parse(decryptedData);

    const {
      out_trade_no, // 商户订单号
      transaction_id, // 微信支付订单号
      trade_state, // 交易状态
      amount // 订单金额
    } = data;

    // 更新订单状态
    if (trade_state === 'SUCCESS') {
      await db.query(
        'UPDATE orders SET status = ?, payment_time = NOW(), transaction_id = ? WHERE order_no = ?',
        ['paid', transaction_id, out_trade_no]
      );

      // 获取订单项
      const [orderItems] = await db.query('SELECT * FROM order_items WHERE order_id = ?', [out_trade_no]);
      
      // 根据订单项类型更新库存或状态
      for (const item of orderItems) {
        if (item.type === 'right') {
          await db.query('UPDATE rights SET remaining_count = remaining_count - ? WHERE id = ?', 
            [item.quantity, item.right_id]);
        }
      }
    }

    res.json({ code: 'SUCCESS', message: '成功' });
  } catch (error) {
    console.error('处理支付回调失败:', error);
    res.status(500).json({ error: '处理支付回调失败' });
  }
});

// 关闭订单接口
router.post('/close', async (req, res) => {
  const { out_trade_no } = req.body;
  if (!out_trade_no) {
    return res.status(400).json({ error: '缺少商户订单号' });
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = generateNonceStr();
    const params = {
      mchid: WX_PAY_CONFIG.mchId
    };
    const body = JSON.stringify(params);
    const url = `/v3/pay/transactions/out-trade-no/${out_trade_no}/close`;
    const signature = generateSignV3('POST', url, timestamp, nonceStr, body);

    // 发送请求到微信支付
    const response = await axios.post(
      `https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/${out_trade_no}/close`,
      params,
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`
        }
      }
    );

    res.json({ message: '订单关闭成功' });
  } catch (error) {
    console.error('关闭订单失败:', error);
    if (error.response) {
      res.status(error.response.status).json({
        error: error.response.data.message || '关闭订单失败'
      });
    } else {
      res.status(500).json({ error: '关闭订单失败' });
    }
  }
});

// 申请退款接口
router.post('/refund', async (req, res) => {
  const {
    transaction_id, // 微信支付订单号
    out_trade_no,  // 商户订单号
    reason,        // 退款原因
    amount         // 退款金额
  } = req.body;

  if (!out_trade_no || !amount) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  try {
    // 创建退款申请记录
    const [result] = await db.query(
      'INSERT INTO refund_requests (order_no, amount, reason, status) VALUES (?, ?, ?, ?)',
      [out_trade_no, amount, reason, 'pending']
    );

    res.json({
      message: '退款申请已提交',
      refund_id: result.insertId
    });
  } catch (error) {
    console.error('申请退款失败:', error);
    res.status(500).json({ error: '申请退款失败' });
  }
});

// 审批退款申请
router.post('/refund/approve', async (req, res) => {
  const { refund_id, approve } = req.body;
  if (!refund_id) {
    return res.status(400).json({ error: '缺少退款申请ID' });
  }

  try {
    // 获取退款申请信息
    const [requests] = await db.query('SELECT * FROM refund_requests WHERE id = ?', [refund_id]);
    if (!requests || requests.length === 0) {
      return res.status(404).json({ error: '退款申请不存在' });
    }
    const refundRequest = requests[0];

    if (!approve) {
      // 拒绝退款
      await db.query('UPDATE refund_requests SET status = ? WHERE id = ?', ['rejected', refund_id]);
      return res.json({ message: '退款申请已拒绝' });
    }

    // 获取订单信息
    const [orders] = await db.query('SELECT * FROM orders WHERE order_no = ?', [refundRequest.order_no]);
    if (!orders || orders.length === 0) {
      return res.status(404).json({ error: '订单不存在' });
    }
    const order = orders[0];

    // 准备退款参数
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = generateNonceStr();
    const params = {
      out_trade_no: order.order_no,
      out_refund_no: `REF${Date.now()}`,
      reason: refundRequest.reason,
      notify_url: WX_PAY_CONFIG.notifyUrl + '/refund',
      amount: {
        refund: refundRequest.amount,
        total: order.total_amount,
        currency: 'CNY'
      }
    };

    // 添加微信支付订单号或商户订单号
    if (order.transaction_id) {
      params.transaction_id = order.transaction_id;
    }

    const body = JSON.stringify(params);
    const url = '/v3/refund/domestic/refunds';
    const signature = generateSignV3('POST', url, timestamp, nonceStr, body);

    // 发送请求到微信支付
    const response = await axios.post(
      'https://api.mch.weixin.qq.com/v3/refund/domestic/refunds',
      params,
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`
        }
      }
    );

    // 更新退款申请状态
    await db.query(
      'UPDATE refund_requests SET status = ?, refund_id = ?, approved_at = NOW() WHERE id = ?',
      ['approved', response.data.refund_id, refund_id]
    );

    res.json({ message: '退款申请已批准' });
  } catch (error) {
    console.error('处理退款申请失败:', error);
    res.status(500).json({ error: '处理退款申请失败' });
  }
});

// 获取退款申请列表
router.get('/refund/requests', async (req, res) => {
  try {
    const [requests] = await db.query(`
      SELECT r.*, o.total_amount, o.status as order_status
      FROM refund_requests r
      JOIN orders o ON r.order_no = o.order_no
      ORDER BY r.created_at DESC
    `);
    res.json(requests);
  } catch (error) {
    console.error('获取退款申请列表失败:', error);
    res.status(500).json({ error: '获取退款申请列表失败' });
  }
});

// 获取退款申请详情
router.get('/refund/requests/:id', async (req, res) => {
  try {
    const [requests] = await db.query(`
      SELECT r.*, o.total_amount, o.status as order_status
      FROM refund_requests r
      JOIN orders o ON r.order_no = o.order_no
      WHERE r.id = ?
    `, [req.params.id]);

    if (!requests || requests.length === 0) {
      return res.status(404).json({ error: '退款申请不存在' });
    }

    res.json(requests[0]);
  } catch (error) {
    console.error('获取退款申请详情失败:', error);
    res.status(500).json({ error: '获取退款申请详情失败' });
  }
});

// 退款回调通知
router.post('/refund/notify', async (req, res) => {
  try {
    const timestamp = req.headers['wechatpay-timestamp'];
    const nonce = req.headers['wechatpay-nonce'];
    const signature = req.headers['wechatpay-signature'];
    const serial = req.headers['wechatpay-serial'];

    // 验证签名
    if (!verifySignV3(timestamp, nonce, req.body, signature)) {
      return res.status(401).json({ error: '签名验证失败' });
    }

    // 解密数据
    const decryptedData = decryptCallbackData(
      req.body.associated_data,
      req.body.nonce,
      req.body.ciphertext
    );
    const data = JSON.parse(decryptedData);

    const {
      out_trade_no, // 商户订单号
      refund_status // 退款状态
    } = data;

    // 更新订单状态
    if (refund_status === 'SUCCESS') {
      // TODO: 更新订单状态
      // 例如：更新数据库中的订单状态为已退款
    }

    res.json({ code: 'SUCCESS', message: '成功' });
  } catch (error) {
    console.error('处理退款回调失败:', error);
    res.status(500).json({ error: '处理退款回调失败' });
  }
});

// 生成支付签名
router.post('/sign', async (req, res) => {
  const { prepay_id } = req.body;
  if (!prepay_id) {
    return res.status(400).json({ error: '缺少prepay_id' });
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = generateNonceStr();
    const package = `prepay_id=${prepay_id}`;
    const signStr = `${WX_PAY_CONFIG.appId}\n${timestamp}\n${nonceStr}\n${package}\n`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signStr);
    const signature = sign.sign(WX_PAY_CONFIG.privateKey, 'base64');

    res.json({
      timeStamp: timestamp,
      nonceStr,
      package,
      signType: 'RSA',
      paySign: signature
    });
  } catch (error) {
    console.error('生成签名失败:', error);
    res.status(500).json({ error: '生成签名失败' });
  }
});

// 查询订单详情接口
router.get('/query', async (req, res) => {
  const { out_trade_no } = req.query;
  if (!out_trade_no) {
    return res.status(400).json({ error: '缺少商户订单号' });
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = generateNonceStr();
    const url = `/v3/pay/transactions/out-trade-no/${out_trade_no}`;
    const signature = generateSignV3('GET', url, timestamp, nonceStr, '');

    // 发送请求到微信支付
    const response = await axios.get(
      `https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/${out_trade_no}`,
      {
        headers: {
          'Accept': 'application/json',
          'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('查询订单失败:', error);
    res.status(500).json({ error: '查询订单失败' });
  }
});

module.exports = router; 