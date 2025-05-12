const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../auth');
const { processObjectImages } = require('../utils/image');

// 获取艺术品列表（公开接口）
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        oa.*,
        a.id as artist_id,
        a.name as artist_name,
        a.avatar as artist_avatar
      FROM original_artworks oa 
      LEFT JOIN artists a ON oa.artist_id = a.id
      ORDER BY oa.created_at DESC
    `);
    console.log('Original artworks query result:', rows);
    
    if (!rows || !Array.isArray(rows)) {
      console.log('Invalid original artworks data:', rows);
      return res.json([]);
    }
    
    // 为每个图片URL添加完整URL并构建正确的数据结构
    const artworksWithFullUrls = rows.map(artwork => {
      const processedArtwork = processObjectImages(artwork, ['image', 'avatar']);
      return {
        ...processedArtwork,
        artist: {
          id: artwork.artist_id,
          name: artwork.artist_name,
          avatar: processedArtwork.artist_avatar || ''
        },
        collection: {
          location: artwork.collection_location,
          number: artwork.collection_number,
          size: artwork.collection_size,
          material: artwork.collection_material
        }
      };
    });
    
    res.json(artworksWithFullUrls);
  } catch (error) {
    console.error('获取艺术品列表失败:', error);
    res.status(500).json({ error: '获取艺术品列表失败' });
  }
});

// 获取艺术品详情（公开接口）
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        oa.*,
        a.name as artist_name,
        a.avatar as artist_avatar,
        a.description as artist_description
      FROM original_artworks oa
      LEFT JOIN artists a ON oa.artist_id = a.id
      WHERE oa.id = ?
    `, [req.params.id]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: '作品不存在' });
    }

    const artwork = processObjectImages(rows[0], ['image', 'avatar']);

    const collection = {
      location: artwork.collection_location,
      number: artwork.collection_number,
      size: artwork.collection_size,
      material: artwork.collection_material
    };

    const artist = {
      name: artwork.artist_name,
      avatar: artwork.artist_avatar,
      description: artwork.artist_description
    };

    res.json({
      title: artwork.title,
      year: artwork.year,
      image: artwork.image,
      description: artwork.description,
      background: artwork.background,
      features: artwork.features,
      collection: collection,
      artist: artist,
      price: artwork.price,
      stock: artwork.stock,
      discount_price: artwork.discount_price,
      original_price: artwork.original_price,
      sales: artwork.sales,
      is_on_sale: artwork.is_on_sale
    });
  } catch (error) {
    console.error('获取作品详情失败:', error);
    res.status(500).json({ error: '获取作品详情失败' });
  }
});

// 创建艺术品（需要认证）
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { 
      title, 
      image, 
      artist_name,
      year,
      description,
      background,
      features,
      collection_location,
      collection_number,
      collection_size,
      collection_material
    } = req.body;
    
    // 验证图片URL
    if (!validateImageUrl(image)) {
      return res.status(400).json({ error: '无效的图片URL' });
    }
    
    // 先创建或查找艺术家
    const [existingArtists] = await db.query('SELECT id FROM artists WHERE name = ?', [artist_name]);
    let artist_id;
    
    if (existingArtists.length > 0) {
      artist_id = existingArtists[0].id;
    } else {
      const [artistResult] = await db.query(
        'INSERT INTO artists (name) VALUES (?)',
        [artist_name]
      );
      artist_id = artistResult.insertId;
    }
    
    // 创建艺术品
    const [result] = await db.query(
      `INSERT INTO original_artworks (
        title, image, artist_id, year, description, 
        background, features, collection_location, 
        collection_number, collection_size, collection_material
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title, image, artist_id, year, description,
        background, features, collection_location,
        collection_number, collection_size, collection_material
      ]
    );
    
    res.json({ 
      id: result.insertId,
      title,
      image,
      year,
      description,
      background,
      features,
      collection: {
        location: collection_location,
        number: collection_number,
        size: collection_size,
        material: collection_material
      },
      artist: {
        id: artist_id,
        name: artist_name
      }
    });
  } catch (error) {
    console.error('Error creating original artwork:', error);
    res.status(500).json({ error: '创建失败' });
  }
});

// 更新艺术品（需要认证）
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { 
      title, 
      image, 
      artist_name,
      year,
      description,
      background,
      features,
      collection_location,
      collection_number,
      collection_size,
      collection_material,
      original_price,
      discount_price,
      stock,
      sales,
      is_on_sale
    } = req.body;
    
    // 先创建或查找艺术家
    const [existingArtists] = await db.query('SELECT id FROM artists WHERE name = ?', [artist_name]);
    let artist_id;
    
    if (existingArtists.length > 0) {
      artist_id = existingArtists[0].id;
    } else {
      const [artistResult] = await db.query(
        'INSERT INTO artists (name) VALUES (?)',
        [artist_name]
      );
      artist_id = artistResult.insertId;
    }
    
    // 更新艺术品
    await db.query(
      `UPDATE original_artworks SET 
        title = ?, 
        image = ?, 
        artist_id = ?,
        year = ?,
        description = ?,
        background = ?,
        features = ?,
        collection_location = ?,
        collection_number = ?,
        collection_size = ?,
        collection_material = ?,
        original_price = ?,
        discount_price = ?,
        stock = ?,
        sales = ?,
        is_on_sale = ?
      WHERE id = ?`,
      [
        title, image, artist_id, year, description,
        background, features, collection_location,
        collection_number, collection_size, collection_material,
        original_price, discount_price, stock, sales, is_on_sale,
        req.params.id
      ]
    );
    
    res.json({ 
      id: parseInt(req.params.id),
      title,
      image,
      year,
      description,
      background,
      features,
      collection: {
        location: collection_location,
        number: collection_number,
        size: collection_size,
        material: collection_material
      },
      artist: {
        id: artist_id,
        name: artist_name
      },
      original_price,
      discount_price,
      stock,
      sales,
      is_on_sale
    });
  } catch (error) {
    console.error('Error updating original artwork:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

// 删除艺术品（需要认证）
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await db.query('DELETE FROM original_artworks WHERE id = ?', [req.params.id]);
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('Error deleting original artwork:', error);
    res.status(500).json({ error: '删除失败' });
  }
});

// 验证图片URL的函数
function validateImageUrl(url) {
  if (!url) return false;

  // 允许以 /uploads/ 开头，或以 OSS 域名开头
  if (url.startsWith('/uploads/') || url.startsWith('https://wx.oss.2000gallery.art/')) {
    return true;
  }

  // 允许完整 URL，主机名为 OSS 域名
  try {
    const urlObj = new URL(url);
    return urlObj.hostname === 'wx.oss.2000gallery.art';
  } catch (e) {
    return false;
  }
}

module.exports = router; 