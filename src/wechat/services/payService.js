const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../../db');

// 微信支付V3配置
const WX_PAY_CONFIG = {
  appId: 'wx96a502c78c9156d0', // 小程序appid
  mchId: '1360639602', // 商户号
  key: 'e0v3TF5sgZS82fk1ylb4oNqczZbKqeYk', // API密钥
  serialNo: '34DF8EA1B52AD35997FF23DFAD7940574A1D6857', // 商户证书序列号
  privateKey: fs.readFileSync(path.join(__dirname, '../../../apiclient_key.pem')), // 商户私钥
  notifyUrl: 'https://api.wx.2000gallery.art:2000/api/wx/pay/notify', // 支付回调地址
  spbillCreateIp: '127.0.0.1' // 终端IP
};

class PayService {
  static generateNonceStr() {
    return Math.random().toString(36).substr(2, 15);
  }

  static generateSignV3(method, url, timestamp, nonceStr, body) {
    const message = `${method}\n${url}\n${timestamp}\n${nonceStr}\n${body}\n`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(message);
    return sign.sign(WX_PAY_CONFIG.privateKey, 'base64');
  }

  static verifySignV3(timestamp, nonceStr, body, signature) {
    const message = `${timestamp}\n${nonceStr}\n${body}\n`;
    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(message);
    return verify.verify(WX_PAY_CONFIG.privateKey, signature, 'base64');
  }

  static decryptCallbackData(associatedData, nonce, ciphertext) {
    const key = Buffer.from(WX_PAY_CONFIG.key, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'));
    decipher.setAuthTag(Buffer.from(associatedData, 'base64'));
    let decrypted = decipher.update(Buffer.from(ciphertext, 'base64'));
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  }

  static async unifiedOrder(orderData) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = this.generateNonceStr();
    const method = 'POST';
    const url = '/v3/pay/transactions/jsapi';
    const body = JSON.stringify(orderData);

    const signature = this.generateSignV3(method, url, timestamp, nonceStr, body);

    const response = await axios.post('https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi', orderData, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
        'User-Agent': 'axios/1.9.0'
      }
    });

    return response.data;
  }

  static async closeOrder(outTradeNo) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = this.generateNonceStr();
    const method = 'POST';
    const url = `/v3/pay/transactions/out-trade-no/${outTradeNo}/close`;
    const params = { mchid: WX_PAY_CONFIG.mchId };
    const bodyStr = JSON.stringify(params);

    const signature = this.generateSignV3(method, url, timestamp, nonceStr, bodyStr);

    const response = await axios.post(
      `https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/${outTradeNo}/close`,
      params,
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
          'User-Agent': 'axios/1.9.0'
        }
      }
    );

    return response.status === 204;
  }

  static async queryOrder(outTradeNo) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = this.generateNonceStr();
    const method = 'GET';
    const url = `/v3/pay/transactions/out-trade-no/${outTradeNo}?mchid=${WX_PAY_CONFIG.mchId}`;

    const signature = this.generateSignV3(method, url, timestamp, nonceStr, '');

    const response = await axios.get(
      `https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/${outTradeNo}?mchid=${WX_PAY_CONFIG.mchId}`,
      {
        headers: {
          'Accept': 'application/json',
          'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
          'User-Agent': 'axios/1.9.0'
        }
      }
    );

    return response.data;
  }

  static generatePaySign(prepayId) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = this.generateNonceStr();
    const package = `prepay_id=${prepayId}`;
    
    const signStr = `${WX_PAY_CONFIG.appId}\n${timestamp}\n${nonceStr}\n${package}\n`;
    
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signStr);
    const signature = sign.sign(WX_PAY_CONFIG.privateKey, 'base64');

    return {
      timeStamp: timestamp,
      nonceStr: nonceStr,
      package: package,
      signType: 'RSA',
      paySign: signature
    };
  }

  static async getOrders(userId) {
    const [orders] = await db.query(
      'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );

    const ordersWithItems = await Promise.all(orders.map(async (order) => {
      const [orderItems] = await db.query(
        'SELECT * FROM order_items WHERE order_id = ?',
        [order.id]
      );

      const orderItemsWithImages = await Promise.all(orderItems.map(async (item) => {
        const [images] = await db.query(
          'SELECT * FROM images WHERE id = ?',
          [item.image_id]
        );
        return {
          ...item,
          image: images[0]
        };
      }));

      const wxPayData = await this.queryOrder(order.out_trade_no);

      return {
        ...order,
        items: orderItemsWithImages,
        pay_status: {
          trade_state: wxPayData.trade_state || 'UNKNOWN',
          trade_state_desc: wxPayData.trade_state_desc || '未知状态',
          success_time: wxPayData.success_time || null,
          amount: wxPayData.amount ? {
            total: wxPayData.amount.total,
            currency: wxPayData.amount.currency
          } : null,
          transaction_id: wxPayData.transaction_id || null
        }
      };
    }));

    return ordersWithItems;
  }

  static async createRefundRequest(refundData) {
    const {
      out_trade_no,
      out_refund_no,
      transaction_id,
      reason,
      amount
    } = refundData;

    const [refundResult] = await db.query(
      `INSERT INTO refund_requests (
        out_trade_no,
        out_refund_no,
        transaction_id,
        reason,
        amount,
        status,
        created_at
      ) VALUES (?, ?, ?, ?, ?, 'PENDING', NOW())`,
      [
        out_trade_no,
        out_refund_no,
        transaction_id,
        reason,
        JSON.stringify(amount)
      ]
    );

    return {
      refund_id: refundResult.insertId,
      status: 'PENDING',
      message: '退款申请已提交，等待审批'
    };
  }

  static async approveRefund(refundId, approve, rejectReason) {
    const [refunds] = await db.query(
      'SELECT * FROM refund_requests WHERE id = ? AND status = "PENDING"',
      [refundId]
    );

    if (!refunds || refunds.length === 0) {
      throw new Error('退款申请不存在或已处理');
    }

    const refund = refunds[0];

    if (!approve) {
      await db.query(
        'UPDATE refund_requests SET status = "REJECTED", reject_reason = ?, rejected_at = NOW() WHERE id = ?',
        [rejectReason, refundId]
      );
      return {
        status: 'REJECTED',
        message: '退款申请已拒绝'
      };
    }

    // 更新退款申请状态为已批准
    await db.query(
      'UPDATE refund_requests SET status = "APPROVED", approved_at = NOW() WHERE id = ?',
      [refundId]
    );

    // 确保amount是有效的JSON字符串
    let amountData;
    try {
      amountData = typeof refund.amount === 'string' ? JSON.parse(refund.amount) : refund.amount;
    } catch (error) {
      throw new Error('退款金额数据格式错误');
    }

    // 构建请求参数
    const params = {
      out_refund_no: refund.out_refund_no,
      reason: refund.reason,
      notify_url: WX_PAY_CONFIG.notifyUrl + '/refund',
      funds_account: 'AVAILABLE',
      amount: amountData
    };

    // 添加微信支付订单号或商户订单号
    if (refund.transaction_id) {
      params.transaction_id = refund.transaction_id;
    } else if (refund.out_trade_no) {
      params.out_trade_no = refund.out_trade_no;
    }

    // 生成签名
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = this.generateNonceStr();
    const signature = this.generateSignV3(
      'POST',
      '/v3/refund/domestic/refunds',
      timestamp,
      nonceStr,
      JSON.stringify(params)
    );

    // 发送请求到微信支付
    const response = await axios.post(
      'https://api.mch.weixin.qq.com/v3/refund/domestic/refunds',
      params,
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
          'User-Agent': 'axios/1.9.0'
        }
      }
    );

    if (response.status === 200) {
      // 更新退款申请状态为处理中
      await db.query(
        'UPDATE refund_requests SET status = "PROCESSING", wx_refund_id = ? WHERE id = ?',
        [response.data.refund_id, refundId]
      );

      return {
        status: 'PROCESSING',
        message: '退款申请已批准，正在处理中'
      };
    } else {
      throw new Error('退款申请处理失败');
    }
  }

  static async getRefundRequests(status, page = 1, limit = 10) {
    const offset = (page - 1) * limit;
    
    // 构建查询条件
    let query = 'SELECT * FROM refund_requests';
    let countQuery = 'SELECT COUNT(*) as total FROM refund_requests';
    let params = [];
    
    if (status) {
      query += ' WHERE status = ?';
      countQuery += ' WHERE status = ?';
      params.push(status);
    }
    
    // 添加排序和分页
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);
    
    // 执行查询
    const [refunds] = await db.query(query, params);
    const [[{ total }]] = await db.query(countQuery, status ? [status] : []);
    
    // 确保amount字段是有效的JSON字符串
    const formattedRefunds = refunds.map(refund => ({
      ...refund,
      amount: typeof refund.amount === 'string' ? refund.amount : JSON.stringify(refund.amount)
    }));
    
    return {
      refunds: formattedRefunds,
      total: parseInt(total),
      page: parseInt(page),
      limit: parseInt(limit)
    };
  }

  static async getRefundRequestById(id) {
    const [refunds] = await db.query(
      'SELECT * FROM refund_requests WHERE id = ?',
      [id]
    );
    
    if (!refunds || refunds.length === 0) {
      throw new Error('退款申请不存在');
    }
    
    return refunds[0];
  }

  static async handleRefundNotify(callbackData) {
    if (callbackData.refund_status === 'SUCCESS') {
      const { 
        out_refund_no,
        out_trade_no,
        refund_id,
        refund_status,
        success_time,
        amount
      } = callbackData;

      // 更新退款申请状态
      await db.query(
        `UPDATE refund_requests SET 
          status = ?,
          success_time = ?,
          updated_at = NOW()
        WHERE out_refund_no = ?`,
        [refund_status, success_time, out_refund_no]
      );

      // 更新订单状态
      await db.query(
        `UPDATE orders SET 
          refund_status = ?,
          refund_time = ?,
          updated_at = NOW()
        WHERE out_trade_no = ?`,
        [refund_status, success_time, out_trade_no]
      );

      return {
        code: 'SUCCESS',
        message: 'OK'
      };
    } else {
      return {
        code: 'FAIL',
        message: callbackData.refund_status || '退款失败'
      };
    }
  }
}

module.exports = PayService; 