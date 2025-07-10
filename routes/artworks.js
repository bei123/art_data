const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../auth');
const { processObjectImages } = require('../utils/image');
const redisClient = require('../utils/redisClient');
const REDIS_ARTWORKS_LIST_KEY = 'artworks:list';
const REDIS_ARTWORKS_LIST_KEY_PREFIX = 'artworks:list:artist:';
const REDIS_ARTWORK_DETAIL_KEY_PREFIX = 'artworks:detail:';

// 获取艺术品列表（公开接口）
router.get('/', async (req, res) => {
  try {
    const { artist_id, page = 1, pageSize = 20 } = req.query;
    const pageNum = parseInt(page) > 0 ? parseInt(page) : 1;
    const sizeNum = parseInt(pageSize) > 0 ? parseInt(pageSize) : 20;
    const offset = (pageNum - 1) * sizeNum;

    // 验证artist_id参数
    if (artist_id) {
      const artistId = parseInt(artist_id);
      if (isNaN(artistId) || artistId <= 0) {
        return res.status(400).json({ error: '无效的艺术家ID' });
      }
    }

    let sql = `
      SELECT 
        oa.id, oa.title, oa.year, oa.image, oa.price, oa.is_on_sale, oa.stock, oa.sales, oa.created_at,
        a.id as artist_id, a.name as artist_name, a.avatar as artist_avatar
      FROM original_artworks oa 
      LEFT JOIN artists a ON oa.artist_id = a.id
    `;
    const params = [];

    if (artist_id) {
      sql += ' WHERE oa.artist_id = ?';
      params.push(parseInt(artist_id));
    }

    sql += ' ORDER BY oa.created_at DESC LIMIT ? OFFSET ?';
    params.push(sizeNum, offset);

    let cacheKey = REDIS_ARTWORKS_LIST_KEY + `:page:${pageNum}:size:${sizeNum}`;
    if (artist_id) {
      cacheKey = REDIS_ARTWORKS_LIST_KEY_PREFIX + artist_id + `:page:${pageNum}:size:${sizeNum}`;
    }
    // 先查redis缓存
    const cache = await redisClient.get(cacheKey);
    if (cache) {
      return res.json(JSON.parse(cache));
    }

    const [rows] = await db.query(sql, params);
    if (!rows || !Array.isArray(rows)) {
      return res.json([]);
    }

    // 一次查出所有图片，避免N+1
    const artworkIds = rows.map(r => r.id);
    let imagesMap = {};
    if (artworkIds.length > 0) {
      const [allImages] = await db.query(
        'SELECT artwork_id, image_url FROM artwork_images WHERE artwork_id IN (?) ORDER BY sort_order, id',
        [artworkIds]
      );
      allImages.forEach(img => {
        if (!imagesMap[img.artwork_id]) imagesMap[img.artwork_id] = [];
        imagesMap[img.artwork_id].push(img.image_url);
      });
    }

    // 为每个图片URL添加完整URL并构建正确的数据结构
    const artworksWithFullUrls = rows.map(artwork => {
      const processedArtwork = processObjectImages(artwork, ['image', 'avatar']);
      return {
        ...processedArtwork,
        images: imagesMap[artwork.id] || [],
        artist: {
          id: artwork.artist_id,
          name: artwork.artist_name,
          avatar: processedArtwork.artist_avatar || ''
        },
        // collection 字段保留兼容
        collection: {
          location: artwork.collection_location,
          number: artwork.collection_number,
          size: artwork.collection_size,
          material: artwork.collection_material
        }
      };
    });

    res.json(artworksWithFullUrls);
    // 写入redis缓存，7天过期
    await redisClient.setEx(cacheKey, 604800, JSON.stringify(artworksWithFullUrls));
  } catch (error) {
    console.error('获取艺术品列表失败:', error);
    res.status(500).json({ error: '获取艺术品列表服务暂时不可用' });
  }
});

// 获取艺术品详情（公开接口）
router.get('/:id', async (req, res) => {
  try {
    // 验证ID参数
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: '无效的作品ID' });
    }
    
    // 先查redis缓存
    const cache = await redisClient.get(REDIS_ARTWORK_DETAIL_KEY_PREFIX + id);
    if (cache) {
      return res.json(JSON.parse(cache));
    }

    const [rows] = await db.query(`
      SELECT 
        oa.*,
        a.id as artist_id,
        a.name as artist_name,
        a.avatar as artist_avatar,
        a.description as artist_description
      FROM original_artworks oa
      LEFT JOIN artists a ON oa.artist_id = a.id
      WHERE oa.id = ?
    `, [id]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: '作品不存在' });
    }

    const artwork = processObjectImages(rows[0], ['image', 'avatar']);

    // 查询多图
    const [imageRows] = await db.query('SELECT image_url FROM artwork_images WHERE artwork_id = ? ORDER BY sort_order, id', [artwork.id]);
    const images = imageRows.map(row => row.image_url);

    const collection = {
      location: artwork.collection_location,
      number: artwork.collection_number,
      size: artwork.collection_size,
      material: artwork.collection_material
    };

    const artist = {
      id: artwork.artist_id,
      name: artwork.artist_name,
      avatar: artwork.artist_avatar,
      description: artwork.artist_description
    };

    const result = {
      title: artwork.title,
      year: artwork.year,
      image: artwork.image,
      images: images,
      description: artwork.description,
      long_description: artwork.long_description,
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
    };
    res.json(result);
    // 写入redis缓存，7天过期
    await redisClient.setEx(REDIS_ARTWORK_DETAIL_KEY_PREFIX + id, 604800, JSON.stringify(result));
  } catch (error) {
    console.error('获取作品详情失败:', error);
    res.status(500).json({ error: '获取作品详情服务暂时不可用' });
  }
});

// 创建艺术品（需要认证）
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      title,
      image,
      images,
      artist_id,
      artist_name,
      year,
      description,
      long_description,
      background,
      features,
      collection_location,
      collection_number,
      collection_size,
      collection_material
    } = req.body;

    let finalArtistId = artist_id;
    // 如果没有artist_id，兼容老前端用artist_name查找或新建
    if (!finalArtistId && artist_name) {
      const [existingArtists] = await db.query('SELECT id FROM artists WHERE name = ?', [artist_name]);
      if (existingArtists.length > 0) {
        finalArtistId = existingArtists[0].id;
      } else {
        const [artistResult] = await db.query(
          'INSERT INTO artists (name) VALUES (?)',
          [artist_name]
        );
        finalArtistId = artistResult.insertId;
      }
    }
    if (!finalArtistId) {
      return res.status(400).json({ error: '缺少有效的艺术家ID' });
    }
    // 验证图片URL
    if (!validateImageUrl(image)) {
      return res.status(400).json({ error: '无效的图片URL' });
    }
    // 创建艺术品
    const [result] = await db.query(
      `INSERT INTO original_artworks (
        title, image, artist_id, year, description, long_description,
        background, features, collection_location, 
        collection_number, collection_size, collection_material
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title, image, finalArtistId, year, description, long_description,
        background, features, collection_location,
        collection_number, collection_size, collection_material
      ]
    );
    // 批量插入多图
    if (Array.isArray(images) && images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        await db.query('INSERT INTO artwork_images (artwork_id, image_url, sort_order) VALUES (?, ?, ?)', [result.insertId, images[i], i]);
      }
    }
    // 查询艺术家信息
    const [artistRows] = await db.query('SELECT id, name FROM artists WHERE id = ?', [finalArtistId]);
    const artist = artistRows[0] || {};
    // 清理缓存
    await redisClient.del(REDIS_ARTWORKS_LIST_KEY);
    if (finalArtistId) {
      await redisClient.del(REDIS_ARTWORKS_LIST_KEY_PREFIX + finalArtistId);
    }
    res.json({
      id: result.insertId,
      title,
      image,
      images: images || [],
      year,
      description,
      long_description,
      background,
      features,
      collection: {
        location: collection_location,
        number: collection_number,
        size: collection_size,
        material: collection_material
      },
      artist: {
        id: artist.id,
        name: artist.name
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
      images,
      artist_id,
      artist_name,
      year,
      description,
      long_description,
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
    let finalArtistId = artist_id;
    // 如果没有artist_id，兼容老前端用artist_name查找或新建
    if (!finalArtistId && artist_name) {
      const [existingArtists] = await db.query('SELECT id FROM artists WHERE name = ?', [artist_name]);
      if (existingArtists.length > 0) {
        finalArtistId = existingArtists[0].id;
      } else {
        const [artistResult] = await db.query(
          'INSERT INTO artists (name) VALUES (?)',
          [artist_name]
        );
        finalArtistId = artistResult.insertId;
      }
    }
    if (!finalArtistId) {
      return res.status(400).json({ error: '缺少有效的艺术家ID' });
    }
    // 更新艺术品
    await db.query(
      `UPDATE original_artworks SET 
        title = ?, 
        image = ?, 
        artist_id = ?,
        year = ?,
        description = ?,
        long_description = ?,
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
        title, image, finalArtistId, year, description, long_description,
        background, features, collection_location,
        collection_number, collection_size, collection_material,
        original_price, discount_price, stock, sales, is_on_sale,
        req.params.id
      ]
    );
    // 先删除原有多图，再插入新多图
    await db.query('DELETE FROM artwork_images WHERE artwork_id = ?', [req.params.id]);
    if (Array.isArray(images) && images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        await db.query('INSERT INTO artwork_images (artwork_id, image_url, sort_order) VALUES (?, ?, ?)', [req.params.id, images[i], i]);
      }
    }
    // 查询艺术家信息
    const [artistRows] = await db.query('SELECT id, name FROM artists WHERE id = ?', [finalArtistId]);
    const artist = artistRows[0] || {};
    // 清理缓存
    await redisClient.del(REDIS_ARTWORKS_LIST_KEY);
    if (finalArtistId) {
      await redisClient.del(REDIS_ARTWORKS_LIST_KEY_PREFIX + finalArtistId);
    }
    await redisClient.del(REDIS_ARTWORK_DETAIL_KEY_PREFIX + req.params.id);
    res.json({
      id: parseInt(req.params.id),
      title,
      image,
      images: images || [],
      year,
      description,
      long_description,
      background,
      features,
      collection: {
        location: collection_location,
        number: collection_number,
        size: collection_size,
        material: collection_material
      },
      artist: {
        id: artist.id,
        name: artist.name
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
    // 清理缓存
    await redisClient.del(REDIS_ARTWORKS_LIST_KEY);
    // 精准清理对应artist_id的缓存
    // 先查出该作品的artist_id
    const [rows] = await db.query('SELECT artist_id FROM original_artworks WHERE id = ?', [req.params.id]);
    if (rows && rows.length > 0 && rows[0].artist_id) {
      await redisClient.del(REDIS_ARTWORKS_LIST_KEY_PREFIX + rows[0].artist_id);
    }
    await redisClient.del(REDIS_ARTWORK_DETAIL_KEY_PREFIX + req.params.id);
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