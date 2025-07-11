const express = require('express');
const router = express.Router();
const db = require('../db');
const jwt = require('jsonwebtoken');

// Token验证中间件
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: '未提供token' });
  }
  const token = authHeader.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'token无效' });
  }
};

// 获取购物车列表
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // 1. 查询所有购物车项
    const [cartItems] = await db.query(
      'SELECT id, type, right_id, digital_artwork_id, artwork_id, quantity, price FROM cart_items WHERE user_id = ?',
      [userId]
    );

    if (!cartItems || cartItems.length === 0) {
      return res.json([]);
    }

    // 2. 分类收集ID
    const rightIds = [];
    const digitalIds = [];
    const artworkIds = [];
    cartItems.forEach(item => {
      if (item.type === 'right' && item.right_id) rightIds.push(item.right_id);
      if (item.type === 'digital' && item.digital_artwork_id) digitalIds.push(item.digital_artwork_id);
      if (item.type === 'artwork' && item.artwork_id) artworkIds.push(item.artwork_id);
    });

    // 3. 批量查询实物商品信息
    let rightsMap = {};
    if (rightIds.length > 0) {
      const [rights] = await db.query(
        `SELECT r.id, r.title, r.price, r.original_price, r.status, r.remaining_count, r.category_id, c.title as category_title
         FROM rights r
         LEFT JOIN physical_categories c ON r.category_id = c.id
         WHERE r.id IN (?) AND r.status = 'onsale'`,
        [rightIds]
      );
      rights.forEach(r => { rightsMap[r.id] = r; });
      
      // 批量查询图片
      const [rightImages] = await db.query(
        'SELECT right_id, image_url FROM right_images WHERE right_id IN (?)',
        [rightIds]
      );
      const rightImagesMap = {};
      rightImages.forEach(img => {
        if (!rightImagesMap[img.right_id]) rightImagesMap[img.right_id] = [];
        rightImagesMap[img.right_id].push(img.image_url || '');
      });
      // 合并图片到商品信息
      Object.keys(rightsMap).forEach(id => {
        rightsMap[id].images = rightImagesMap[id] || [];
      });
    }

    // 4. 批量查询数字艺术品信息
    let digitalsMap = {};
    if (digitalIds.length > 0) {
      const [digitals] = await db.query(
        'SELECT id, title, price, image_url, description FROM digital_artworks WHERE id IN (?)',
        [digitalIds]
      );
      digitals.forEach(d => { digitalsMap[d.id] = d; });
    }

    // 5. 批量查询艺术品信息
    let artworksMap = {};
    let artistIds = [];
    if (artworkIds.length > 0) {
      const [artworks] = await db.query(
        'SELECT id, title, image, year, description, original_price, discount_price, artist_id FROM original_artworks WHERE id IN (?)',
        [artworkIds]
      );
      artworks.forEach(a => {
        artworksMap[a.id] = a;
        if (a.artist_id) artistIds.push(a.artist_id);
      });
    }

    // 6. 批量查询艺术家信息
    let artistsMap = {};
    if (artistIds.length > 0) {
      const [artists] = await db.query(
        'SELECT id, name, avatar FROM artists WHERE id IN (?)',
        [artistIds]
      );
      artists.forEach(a => { artistsMap[a.id] = a; });
    }

    // 7. 组装返回数据
    const result = cartItems.map(item => {
      if (item.type === 'right' && rightsMap[item.right_id]) {
        return {
          cart_item_id: item.id, // 购物车主键
          ...item,
          type: 'right',
          ...rightsMap[item.right_id]
        };
      }
      if (item.type === 'digital' && digitalsMap[item.digital_artwork_id]) {
        return {
          cart_item_id: item.id,
          ...item,
          type: 'digital',
          ...digitalsMap[item.digital_artwork_id],
          image: digitalsMap[item.digital_artwork_id].image_url || ''
        };
      }
      if (item.type === 'artwork' && artworksMap[item.artwork_id]) {
        const artwork = artworksMap[item.artwork_id];
        const artist = artistsMap[artwork.artist_id] || {};
        return {
          cart_item_id: item.id,
          ...item,
          type: 'artwork',
          ...artwork,
          image: artwork.image || '',
          artist_name: artist.name || '',
          artist_avatar: artist.avatar || '',
          price: item.price || 0,
          original_price: artwork.original_price || 0,
          discount_price: artwork.discount_price || 0
        };
      }
      return {
        cart_item_id: item.id,
        ...item
      };
    });

    res.json(result);
  } catch (error) {
    console.error('获取购物车失败:', error);
    res.status(500).json({ error: '获取购物车服务暂时不可用' });
  }
});

// 添加商品到购物车
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { type = 'right', right_id, digital_artwork_id, artwork_id, quantity = 1 } = req.body;
    
    // 输入验证
    if (!['right', 'digital', 'artwork'].includes(type)) {
      return res.status(400).json({ error: '无效的商品类型' });
    }
    
    const cleanQuantity = parseInt(quantity);
    if (isNaN(cleanQuantity) || cleanQuantity <= 0 || cleanQuantity > 99) {
      return res.status(400).json({ error: '商品数量必须在1-99之间' });
    }

    if (type === 'right') {
      if (!right_id) {
        return res.status(400).json({ error: '缺少商品ID' });
      }
      // 检查商品是否存在且状态正常
      const [right] = await db.query('SELECT remaining_count FROM rights WHERE id = ? AND status = "onsale"', [right_id]);
      if (!right || right.length === 0) {
        return res.status(404).json({ error: '商品不存在或已下架' });
      }
      // 检查库存
      if (right[0].remaining_count < cleanQuantity) {
        return res.status(400).json({ error: '库存不足' });
      }
      // 检查购物车中是否已存在该商品
      const [existingItem] = await db.query(
        'SELECT id FROM cart_items WHERE user_id = ? AND right_id = ? AND type = "right"',
        [userId, right_id]
      );
      if (existingItem && existingItem.length > 0) {
        // 更新数量
        await db.query(
          'UPDATE cart_items SET quantity = quantity + ? WHERE user_id = ? AND right_id = ? AND type = "right"',
          [cleanQuantity, userId, right_id]
        );
      } else {
        // 新增商品
        await db.query(
          'INSERT INTO cart_items (user_id, type, right_id, quantity) VALUES (?, "right", ?, ?)',
          [userId, right_id, cleanQuantity]
        );
      }
      res.json({ message: '添加成功' });
    } else if (type === 'digital') {
      if (!digital_artwork_id) {
        return res.status(400).json({ error: '缺少数字艺术品ID' });
      }
      // 检查数字艺术品是否存在
      const [digital] = await db.query('SELECT id FROM digital_artworks WHERE id = ?', [digital_artwork_id]);
      if (!digital || digital.length === 0) {
        return res.status(404).json({ error: '数字艺术品不存在' });
      }
      // 检查购物车中是否已存在该数字艺术品
      const [existingItem] = await db.query(
        'SELECT id FROM cart_items WHERE user_id = ? AND digital_artwork_id = ? AND type = "digital"',
        [userId, digital_artwork_id]
      );
      if (existingItem && existingItem.length > 0) {
        // 更新数量
        await db.query(
          'UPDATE cart_items SET quantity = quantity + ? WHERE user_id = ? AND digital_artwork_id = ? AND type = "digital"',
          [cleanQuantity, userId, digital_artwork_id]
        );
      } else {
        // 新增数字艺术品
        await db.query(
          'INSERT INTO cart_items (user_id, type, digital_artwork_id, quantity) VALUES (?, "digital", ?, ?)',
          [userId, digital_artwork_id, cleanQuantity]
        );
      }
      res.json({ message: '添加成功' });
    } else if (type === 'artwork') {
      if (!artwork_id) {
        return res.status(400).json({ error: '缺少艺术品ID' });
      }
      // 检查艺术品是否存在
      const [artwork] = await db.query('SELECT original_price, discount_price FROM original_artworks WHERE id = ?', [artwork_id]);
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
        'SELECT id FROM cart_items WHERE user_id = ? AND artwork_id = ? AND type = "artwork"',
        [userId, artwork_id]
      );
      if (existingItem && existingItem.length > 0) {
        // 更新数量
        await db.query(
          'UPDATE cart_items SET quantity = quantity + ? WHERE user_id = ? AND artwork_id = ? AND type = "artwork"',
          [cleanQuantity, userId, artwork_id]
        );
      } else {
        // 新增艺术品
        await db.query(
          'INSERT INTO cart_items (user_id, type, artwork_id, quantity, price) VALUES (?, "artwork", ?, ?, ?)',
          [userId, artwork_id, cleanQuantity, actualPrice]
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
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { quantity } = req.body;

    if (!quantity || quantity < 1) {
      return res.status(400).json({ error: '数量必须大于0' });
    }

    // 查询购物车项，判断类型
    const [cartItemRows] = await db.query(
      'SELECT type, right_id, digital_artwork_id, artwork_id FROM cart_items WHERE id = ? AND user_id = ?',
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
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

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
router.delete('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    await db.query('DELETE FROM cart_items WHERE user_id = ?', [userId]);

    res.json({ message: '清空购物车成功' });
  } catch (error) {
    console.error('清空购物车失败:', error);
    res.status(500).json({ error: '清空购物车失败' });
  }
});

module.exports = router; 