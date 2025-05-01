const express = require('express');
const router = express.Router();
const PayController = require('../controllers/payController');
const { authenticateToken } = require('../middleware/auth');

// 统一下单
router.post('/unifiedorder', authenticateToken, PayController.unifiedOrder);

// 关闭订单
router.post('/close', authenticateToken, PayController.closeOrder);

// 支付回调
router.post('/notify', PayController.payNotify);

// 生成支付签名
router.post('/sign', authenticateToken, PayController.generatePaySign);

// 查询订单
router.get('/query', authenticateToken, PayController.queryOrder);

// 获取订单列表
router.get('/orders', authenticateToken, PayController.getOrders);

// 退款相关路由
router.post('/refund', PayController.createRefundRequest);
router.post('/refund/:refundId/approve', PayController.approveRefund);
router.get('/refund/requests', PayController.getRefundRequests);
router.get('/refund/requests/:id', PayController.getRefundRequestById);
router.post('/refund/notify', PayController.handleRefundNotify);

module.exports = router; 