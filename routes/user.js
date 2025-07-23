const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../auth');

// 获取当前用户已购买产品
router.get('/purchased', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    // 查询所有已支付订单（SUCCESS）
    const [orders] = await db.query(
      'SELECT id FROM orders WHERE user_id = ? AND trade_state = ? ORDER BY created_at DESC',
      [userId, 'SUCCESS']
    );
    if (!orders || orders.length === 0) {
      return res.json([]);
    }
    const orderIds = orders.map(o => o.id);
    // 查询所有订单项
    const [items] = await db.query(`
      SELECT 
        oi.id,
        oi.type,
        oi.right_id,
        oi.digital_artwork_id,
        oi.artwork_id,
        oi.quantity,
        oi.price,
        r.title as right_title,
        r.price as right_price,
        r.original_price as right_original_price,
        r.description as right_description,
        r.status as right_status,
        r.remaining_count as right_remaining_count,
        ri.image_url as right_image_url,
        da.title as digital_title,
        da.price as digital_price,
        da.description as digital_description,
        da.image_url as digital_image_url,
        oa.title as artwork_title,
        oa.original_price as artwork_original_price,
        oa.discount_price as artwork_discount_price,
        oa.description as artwork_description,
        oa.image as artwork_image
      FROM order_items oi
      LEFT JOIN rights r ON oi.type = 'right' AND oi.right_id = r.id
      LEFT JOIN right_images ri ON oi.type = 'right' AND oi.right_id = ri.right_id
      LEFT JOIN digital_artworks da ON oi.type = 'digital' AND oi.digital_artwork_id = da.id
      LEFT JOIN original_artworks oa ON oi.type = 'artwork' AND oi.artwork_id = oa.id
      WHERE oi.order_id IN (?)
    `, [orderIds]);
    // 整理返回
    const result = items.map(item => {
      let product = {
        id: item.id,
        type: item.type,
        quantity: item.quantity,
        price: item.price
      };
      if (item.type === 'right') {
        product = {
          ...product,
          right_id: item.right_id, // 返回权益原始id
          title: item.right_title,
          original_price: item.right_original_price,
          description: item.right_description,
          status: item.right_status,
          remaining_count: item.right_remaining_count,
          images: item.right_image_url ? [item.right_image_url] : []
        };
      } else if (item.type === 'digital') {
        product = {
          ...product,
          digital_id: item.digital_artwork_id, // 返回数字艺术品原始id
          title: item.digital_title,
          description: item.digital_description,
          images: item.digital_image_url ? [item.digital_image_url] : []
        };
      } else if (item.type === 'artwork') {
        product = {
          ...product,
          artwork_id: item.artwork_id, // 返回实物艺术品原始id
          title: item.artwork_title,
          original_price: item.artwork_original_price,
          discount_price: item.artwork_discount_price,
          description: item.artwork_description,
          images: item.artwork_image ? [item.artwork_image] : []
        };
      }
      return product;
    });
    res.json(result);
  } catch (error) {
    console.error('获取已购产品失败:', error);
    res.status(500).json({ error: '获取已购产品失败' });
  }
});

module.exports = router;
