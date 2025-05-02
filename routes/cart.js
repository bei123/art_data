const express = require('express');
const router = express.Router();
const db = require('../db');
const jwt = require('jsonwebtoken');
const BASE_URL = 'https://api.wx.2000gallery.art:2000';

// 获取购物车列表
router.get('/', async (req, res) => {
  try {
    // 解析 token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: '未登录' });
    }
    const token = authHeader.replace('Bearer ', '');
    let payload;
    try {
      payload = jwt.verify(token, 'your_jwt_secret');
    } catch (err) {
      return res.status(401).json({ error: 'token无效' });
    }

    const userId = payload.userId;
    // 查询实物商品购物车项
    const [cartRights] = await db.query(`
      SELECT 
        ci.*, 'right' as type,
        r.title, r.price, r.original_price, r.status, r.remaining_count, c.title as category_title
      FROM cart_items ci
      JOIN rights r ON ci.right_id = r.id
      LEFT JOIN physical_categories c ON r.category_id = c.id
      WHERE ci.user_id = ? AND ci.type = 'right' AND r.status = 'onsale'
    `, [userId]);
    // 查询数字艺术品购物车项
    const [cartDigitals] = await db.query(`
      SELECT 
        ci.*, 'digital' as type,
        d.title, d.price, d.image_url, d.author, d.description
      FROM cart_items ci
      JOIN digital_artworks d ON ci.digital_artwork_id = d.id
      WHERE ci.user_id = ? AND ci.type = 'digital'
    `, [userId]);
    // 查询艺术品购物车项
    const [cartArtworks] = await db.query(`
      SELECT 
        ci.*, 'artwork' as type,
        oa.title, oa.image, oa.year, oa.description, oa.original_price, oa.discount_price,
        a.name as artist_name, a.avatar as artist_avatar
      FROM cart_items ci
      JOIN original_artworks oa ON ci.artwork_id = oa.id
      LEFT JOIN artists a ON oa.artist_id = a.id
      WHERE ci.user_id = ? AND ci.type = 'artwork'
    `, [userId]);

    // 获取每个实物商品的图片
    const processedCartRights = await Promise.all(cartRights.map(async (item) => {
      const [images] = await db.query(
        'SELECT image_url FROM right_images WHERE right_id = ?',
        [item.right_id]
      );
      return {
        ...item,
        images: images.map(img =>
          img.image_url.startsWith('http') ? img.image_url : `${BASE_URL}${img.image_url}`
        )
      };
    }));

    // 处理数字艺术品图片
    const processedCartDigitals = cartDigitals.map(item => ({
      ...item,
      image: item.image_url ? (item.image_url.startsWith('http') ? item.image_url : `${BASE_URL}${item.image_url}`) : ''
    }));

    // 处理艺术品图片和艺术家头像
    const processedCartArtworks = cartArtworks.map(item => ({
      ...item,
      image: item.image ? (item.image.startsWith('http') ? item.image : `${BASE_URL}${item.image}`) : '',
      artist_avatar: item.artist_avatar ? (item.artist_avatar.startsWith('http') ? item.artist_avatar : `${BASE_URL}${item.artist_avatar}`) : '',
      price: item.price || 0,
      original_price: item.original_price || 0,
      discount_price: item.discount_price || 0
    }));

    res.json([...processedCartRights, ...processedCartDigitals, ...processedCartArtworks]);
  } catch (error) {
    console.error('获取购物车失败:', error);
    res.status(500).json({ error: '获取购物车失败' });
  }
});

// 添加商品到购物车
router.post('/', async (req, res) => {
  try {
    // 解析 token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: '未登录' });
    }
    const token = authHeader.replace('Bearer ', '');
    let payload;
    try {
      payload = jwt.verify(token, 'your_jwt_secret');
    } catch (err) {
      return res.status(401).json({ error: 'token无效' });
    }

    const userId = payload.userId;
    const { type = 'right', right_id, digital_artwork_id, artwork_id, quantity = 1 } = req.body;

    if (type === 'right') {
      if (!right_id) {
        return res.status(400).json({ error: '缺少商品ID' });
      }
      // 检查商品是否存在且状态正常
      const [right] = await db.query('SELECT * FROM rights WHERE id = ? AND status = "onsale"', [right_id]);
      if (!right || right.length === 0) {
        return res.status(404).json({ error: '商品不存在或已下架' });
      }
      // 检查库存
      if (right[0].remaining_count < quantity) {
        return res.status(400).json({ error: '库存不足' });
      }
      // 检查购物车中是否已存在该商品
      const [existingItem] = await db.query(
        'SELECT * FROM cart_items WHERE user_id = ? AND right_id = ? AND type = "right"',
        [userId, right_id]
      );
      if (existingItem && existingItem.length > 0) {
        // 更新数量
        await db.query(
          'UPDATE cart_items SET quantity = quantity + ? WHERE user_id = ? AND right_id = ? AND type = "right"',
          [quantity, userId, right_id]
        );
      } else {
        // 新增商品
        await db.query(
          'INSERT INTO cart_items (user_id, type, right_id, quantity) VALUES (?, "right", ?, ?)',
          [userId, right_id, quantity]
        );
      }
      res.json({ message: '添加成功' });
    } else if (type === 'digital') {
      if (!digital_artwork_id) {
        return res.status(400).json({ error: '缺少数字艺术品ID' });
      }
      // 检查数字艺术品是否存在
      const [digital] = await db.query('SELECT * FROM digital_artworks WHERE id = ?', [digital_artwork_id]);
      if (!digital || digital.length === 0) {
        return res.status(404).json({ error: '数字艺术品不存在' });
      }
      // 检查购物车中是否已存在该数字艺术品
      const [existingItem] = await db.query(
        'SELECT * FROM cart_items WHERE user_id = ? AND digital_artwork_id = ? AND type = "digital"',
        [userId, digital_artwork_id]
      );
      if (existingItem && existingItem.length > 0) {
        // 更新数量
        await db.query(
          'UPDATE cart_items SET quantity = quantity + ? WHERE user_id = ? AND digital_artwork_id = ? AND type = "digital"',
          [quantity, userId, digital_artwork_id]
        );
      } else {
        // 新增数字艺术品
        await db.query(
          'INSERT INTO cart_items (user_id, type, digital_artwork_id, quantity) VALUES (?, "digital", ?, ?)',
          [userId, digital_artwork_id, quantity]
        );
      }
      res.json({ message: '添加成功' });
    } else if (type === 'artwork') {
      if (!artwork_id) {
        return res.status(400).json({ error: '缺少艺术品ID' });
      }
      // 检查艺术品是否存在
      const [artwork] = await db.query('SELECT * FROM original_artworks WHERE id = ?', [artwork_id]);
      if (!artwork || artwork.length === 0) {
        return res.status(404).json({ error: '艺术品不存在' });
      }
      // 验证价格
      if (!artwork[0].original_price || artwork[0].original_price <= 0) {
        return res.status(400).json({ error: '艺术品价格无效' });
      }
      // 确定实际价格（如果有优惠价且优惠价小于原价，则使用优惠价）
      const actualPrice = (artwork[0].discount_price && artwork[0].discount_price > 0 && artwork[0].discount_price < artwork[0].original_price) 
        ? artwork[0].discount_price 
        : artwork[0].original_price;
      // 检查购物车中是否已存在该艺术品
      const [existingItem] = await db.query(
        'SELECT * FROM cart_items WHERE user_id = ? AND artwork_id = ? AND type = "artwork"',
        [userId, artwork_id]
      );
      if (existingItem && existingItem.length > 0) {
        // 更新数量
        await db.query(
          'UPDATE cart_items SET quantity = quantity + ? WHERE user_id = ? AND artwork_id = ? AND type = "artwork"',
          [quantity, userId, artwork_id]
        );
      } else {
        // 新增艺术品
        await db.query(
          'INSERT INTO cart_items (user_id, type, artwork_id, quantity, price) VALUES (?, "artwork", ?, ?, ?)',
          [userId, artwork_id, quantity, actualPrice]
        );
      }
      res.json({ message: '添加成功' });
    } else {
      res.status(400).json({ error: '不支持的商品类型' });
    }
  } catch (error) {
    console.error('添加商品到购物车失败:', error);
    res.status(500).json({ error: '添加商品到购物车失败' });
  }
});

// 更新购物车商品数量
router.put('/:id', async (req, res) => {
  try {
    // 解析 token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: '未登录' });
    }
    const token = authHeader.replace('Bearer ', '');
    let payload;
    try {
      payload = jwt.verify(token, 'your_jwt_secret');
    } catch (err) {
      return res.status(401).json({ error: 'token无效' });
    }

    const userId = payload.userId;
    const { quantity } = req.body;

    if (!quantity || quantity < 1) {
      return res.status(400).json({ error: '数量必须大于0' });
    }

    // 查询购物车项，判断类型
    const [cartItemRows] = await db.query(
      'SELECT * FROM cart_items WHERE id = ? AND user_id = ?',
      [req.params.id, userId]
    );
    if (!cartItemRows || cartItemRows.length === 0) {
      return res.status(404).json({ error: '购物车商品不存在' });
    }
    const cartItem = cartItemRows[0];

    if (cartItem.type === 'right') {
      // 检查库存
      const [rightRows] = await db.query(
        'SELECT remaining_count FROM rights WHERE id = ? AND status = "onsale"',
        [cartItem.right_id]
      );
      if (!rightRows || rightRows.length === 0) {
        return res.status(404).json({ error: '商品不存在或已下架' });
      }
      if (rightRows[0].remaining_count < quantity) {
        return res.status(400).json({ error: '库存不足' });
      }
    } else if (cartItem.type === 'artwork') {
      // 检查艺术品是否存在且在售
      const [artworkRows] = await db.query(
        'SELECT stock FROM original_artworks WHERE id = ? AND is_on_sale = 1',
        [cartItem.artwork_id]
      );
      if (!artworkRows || artworkRows.length === 0) {
        return res.status(404).json({ error: '艺术品不存在或已下架' });
      }
      if (artworkRows[0].stock < quantity) {
        return res.status(400).json({ error: '库存不足' });
      }
    } else if (cartItem.type === 'digital') {
      // 检查数字艺术品是否存在
      const [digitalRows] = await db.query(
        'SELECT id FROM digital_artworks WHERE id = ?',
        [cartItem.digital_artwork_id]
      );
      if (!digitalRows || digitalRows.length === 0) {
        return res.status(404).json({ error: '数字艺术品不存在' });
      }
    } else {
      return res.status(400).json({ error: '不支持的商品类型' });
    }

    // 更新数量
    await db.query(
      'UPDATE cart_items SET quantity = ? WHERE id = ? AND user_id = ?',
      [quantity, req.params.id, userId]
    );

    res.json({ message: '更新成功' });
  } catch (error) {
    console.error('更新购物车商品数量失败:', error);
    res.status(500).json({ error: '更新购物车商品数量失败' });
  }
});

// 从购物车中删除商品
router.delete('/:id', async (req, res) => {
  try {
    // 解析 token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: '未登录' });
    }
    const token = authHeader.replace('Bearer ', '');
    let payload;
    try {
      payload = jwt.verify(token, 'your_jwt_secret');
    } catch (err) {
      return res.status(401).json({ error: 'token无效' });
    }

    const userId = payload.userId;

    const [result] = await db.query(
      'DELETE FROM cart_items WHERE id = ? AND user_id = ?',
      [req.params.id, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '购物车商品不存在' });
    }

    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('从购物车中删除商品失败:', error);
    res.status(500).json({ error: '从购物车中删除商品失败' });
  }
});

// 清空购物车
router.delete('/', async (req, res) => {
  try {
    // 解析 token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: '未登录' });
    }
    const token = authHeader.replace('Bearer ', '');
    let payload;
    try {
      payload = jwt.verify(token, 'your_jwt_secret');
    } catch (err) {
      return res.status(401).json({ error: 'token无效' });
    }

    const userId = payload.userId;

    await db.query('DELETE FROM cart_items WHERE user_id = ?', [userId]);

    res.json({ message: '清空购物车成功' });
  } catch (error) {
    console.error('清空购物车失败:', error);
    res.status(500).json({ error: '清空购物车失败' });
  }
});

module.exports = router; 