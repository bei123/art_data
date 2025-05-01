const PayService = require('../services/payService');
const db = require('../../db');

class PayController {
  static async unifiedOrder(req, res) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const { items, total_amount, description } = req.body;
      const userId = req.user.userId;

      // 创建订单
      const [orderResult] = await connection.query(
        'INSERT INTO orders (user_id, total_amount, description, status) VALUES (?, ?, ?, ?)',
        [userId, total_amount, description, 'PENDING']
      );

      const orderId = orderResult.insertId;
      const outTradeNo = `ORDER${orderId}${Date.now()}`;

      // 更新订单号
      await connection.query(
        'UPDATE orders SET out_trade_no = ? WHERE id = ?',
        [outTradeNo, orderId]
      );

      // 创建订单项
      for (const item of items) {
        await connection.query(
          'INSERT INTO order_items (order_id, image_id, quantity, price) VALUES (?, ?, ?, ?)',
          [orderId, item.image_id, item.quantity, item.price]
        );
      }

      // 调用微信支付统一下单
      const orderData = {
        appid: PayService.WX_PAY_CONFIG.appId,
        mchid: PayService.WX_PAY_CONFIG.mchId,
        description: description,
        out_trade_no: outTradeNo,
        notify_url: PayService.WX_PAY_CONFIG.notifyUrl,
        amount: {
          total: total_amount,
          currency: 'CNY'
        },
        scene_info: {
          payer_client_ip: PayService.WX_PAY_CONFIG.spbillCreateIp
        }
      };

      const result = await PayService.unifiedOrder(orderData);
      await connection.commit();

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      await connection.rollback();
      console.error('统一下单失败:', error);
      res.status(500).json({
        error: '统一下单失败',
        detail: error.message
      });
    } finally {
      connection.release();
    }
  }

  static async closeOrder(req, res) {
    try {
      const { out_trade_no } = req.body;
      if (!out_trade_no) {
        return res.status(400).json({ error: '缺少商户订单号' });
      }

      const success = await PayService.closeOrder(out_trade_no);
      if (success) {
        res.json({
          success: true,
          message: '订单关闭成功'
        });
      } else {
        res.status(400).json({
          success: false,
          error: '订单关闭失败'
        });
      }
    } catch (error) {
      console.error('关闭订单失败:', error);
      res.status(500).json({
        success: false,
        error: '关闭订单失败'
      });
    }
  }

  static async payNotify(req, res) {
    try {
      const {
        id,
        create_time,
        event_type,
        resource_type,
        resource,
        summary
      } = req.body;

      const timestamp = req.headers['wechatpay-timestamp'];
      const nonce = req.headers['wechatpay-nonce'];
      const signature = req.headers['wechatpay-signature'];
      const serial = req.headers['wechatpay-serial'];

      if (!PayService.verifySignV3(timestamp, nonce, JSON.stringify(req.body), signature)) {
        return res.status(401).json({
          code: 'FAIL',
          message: '签名验证失败'
        });
      }

      const decryptedData = PayService.decryptCallbackData(
        resource.associated_data,
        resource.nonce,
        resource.ciphertext
      );

      const callbackData = JSON.parse(decryptedData);
      
      // 处理支付结果
      if (callbackData.trade_state === 'SUCCESS') {
        const { out_trade_no, transaction_id, success_time } = callbackData;
        
        // 更新订单状态
        await db.query(
          'UPDATE orders SET status = ?, transaction_id = ?, paid_at = ? WHERE out_trade_no = ?',
          ['PAID', transaction_id, success_time, out_trade_no]
        );

        res.json({
          code: 'SUCCESS',
          message: 'OK'
        });
      } else {
        res.json({
          code: 'FAIL',
          message: callbackData.trade_state_desc || '支付失败'
        });
      }
    } catch (error) {
      console.error('支付回调处理失败:', error);
      res.status(500).json({
        code: 'FAIL',
        message: '处理失败'
      });
    }
  }

  static async generatePaySign(req, res) {
    try {
      const { prepay_id } = req.body;
      if (!prepay_id) {
        return res.status(400).json({ error: '缺少prepay_id' });
      }

      const paySign = PayService.generatePaySign(prepay_id);
      res.json(paySign);
    } catch (error) {
      console.error('生成支付签名失败:', error);
      res.status(500).json({ error: '生成支付签名失败' });
    }
  }

  static async queryOrder(req, res) {
    try {
      const { out_trade_no } = req.query;
      if (!out_trade_no) {
        return res.status(400).json({ error: '缺少商户订单号' });
      }

      const orderData = await PayService.queryOrder(out_trade_no);
      res.json(orderData);
    } catch (error) {
      console.error('查询订单失败:', error);
      res.status(500).json({ error: '查询订单失败' });
    }
  }

  static async getOrders(req, res) {
    try {
      const userId = req.user.userId;
      const orders = await PayService.getOrders(userId);
      res.json(orders);
    } catch (error) {
      console.error('获取订单列表失败:', error);
      res.status(500).json({ error: '获取订单列表失败' });
    }
  }

  static async createRefundRequest(req, res) {
    try {
      const result = await PayService.createRefundRequest(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }

  static async approveRefund(req, res) {
    try {
      const { refundId } = req.params;
      const { approve, rejectReason } = req.body;
      const result = await PayService.approveRefund(refundId, approve, rejectReason);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }

  static async getRefundRequests(req, res) {
    try {
      const { status, page, limit } = req.query;
      const result = await PayService.getRefundRequests(status, page, limit);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }

  static async getRefundRequestById(req, res) {
    try {
      const { id } = req.params;
      const result = await PayService.getRefundRequestById(id);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }

  static async handleRefundNotify(req, res) {
    try {
      const result = await PayService.handleRefundNotify(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
}

module.exports = PayController; 