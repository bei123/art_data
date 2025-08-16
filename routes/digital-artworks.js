const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../auth');
const { processObjectImages } = require('../utils/image');
const redisClient = require('../utils/redisClient');
const REDIS_DIGITAL_ARTWORKS_LIST_KEY = 'digital_artworks:list';
const REDIS_DIGITAL_ARTWORKS_LIST_KEY_PREFIX = 'digital_artworks:list:artist:';
const REDIS_DIGITAL_ARTWORK_DETAIL_KEY_PREFIX = 'digital_artworks:detail:';

// 数据库健康检查端点
router.get('/health', async (req, res) => {
  try {
    const poolStatus = db.getPoolStatus();
    const healthCheck = await db.checkPoolHealth();
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: {
        poolStatus,
        healthCheck
      }
    });
  } catch (error) {
    console.error('健康检查失败:', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// 验证图片URL的函数
function validateImageUrl(url) {
  if (!url) return false;
  if (url.startsWith('/uploads/') || url.startsWith('https://wx.oss.2000gallery.art/')) {
    return true;
  }
  try {
    const urlObj = new URL(url);
    return urlObj.hostname === 'wx.oss.2000gallery.art';
  } catch (e) {
    return false;
  }
}

// 获取数字艺术品列表（公开接口）
router.get('/', async (req, res) => {
  try {
    const { artist_id, page = 1, pageSize = 20 } = req.query;
    const pageNum = parseInt(page) > 0 ? parseInt(page) : 1;
    const sizeNum = parseInt(pageSize) > 0 ? parseInt(pageSize) : 20;
    const offset = (pageNum - 1) * sizeNum;
    
    let query = `
      SELECT 
        da.id, da.title, da.image_url, da.description, da.price, da.created_at,
        a.id as artist_id, a.name as artist_name, a.avatar as artist_avatar
      FROM digital_artworks da FORCE INDEX (idx_digital_artworks_created_at)
      LEFT JOIN artists a ON da.artist_id = a.id
    `;
    
    const queryParams = [];
    
    // 如果提供了 artist_id 参数，添加筛选条件
    if (artist_id) {
      query = query.replace('FORCE INDEX (idx_digital_artworks_created_at)', 'FORCE INDEX (idx_digital_artworks_artist_created)');
      query += ` WHERE da.artist_id = ?`;
      queryParams.push(artist_id);
    }
    
    query += ` ORDER BY da.created_at DESC LIMIT ? OFFSET ?`;
    queryParams.push(sizeNum, offset);
    
    const [rows] = await db.query(query, queryParams);
    
    if (!rows || !Array.isArray(rows)) {
      return res.json([]);
    }
    
    const artworksWithProcessedImages = rows.map(artwork => {
      const processedArtwork = processObjectImages(artwork, ['image_url', 'avatar']);
      return {
        ...processedArtwork,
        artist: {
          id: artwork.artist_id,
          name: artwork.artist_name,
          avatar: processedArtwork.artist_avatar || ''
        }
      };
    });
    
    res.json(artworksWithProcessedImages);
    // 写入redis缓存，7天过期
    let cacheKey = REDIS_DIGITAL_ARTWORKS_LIST_KEY + `:page:${pageNum}:size:${sizeNum}`;
    if (artist_id) {
      cacheKey = REDIS_DIGITAL_ARTWORKS_LIST_KEY_PREFIX + artist_id + `:page:${pageNum}:size:${sizeNum}`;
    }
    await redisClient.setEx(cacheKey, 604800, JSON.stringify(artworksWithProcessedImages));
  } catch (error) {
    console.error('获取数字艺术品列表失败:', error);
    
    // 检查是否是连接池问题
    if (error.message === 'Pool is closed.' || error.message.includes('Pool is closed')) {
      return res.status(503).json({ 
        error: '数据库连接暂时不可用，请稍后重试',
        code: 'DB_POOL_CLOSED'
      });
    }
    
    res.status(500).json({ error: '获取数字艺术品列表失败' });
  }
});

// 获取数字艺术品详情（公开接口）
router.get('/:id', async (req, res) => {
  try {
    // 验证ID参数
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: '无效的作品ID' });
    }
    // 先查redis缓存
    const cache = await redisClient.get(REDIS_DIGITAL_ARTWORK_DETAIL_KEY_PREFIX + id);
    if (cache) {
      return res.json(JSON.parse(cache));
    }
    
    const [rows] = await db.query(`
      SELECT 
        da.id, da.title, da.image_url, da.description, da.registration_certificate,
        da.license_rights, da.license_period, da.owner_rights, da.license_items,
        da.project_name, da.product_name, da.project_owner, da.issuer, da.issue_batch,
        da.issue_year, da.batch_quantity, da.price, da.created_at, da.updated_at,
        a.id as artist_id, a.name as artist_name, a.avatar as artist_avatar,
        a.description as artist_description
      FROM digital_artworks da
      LEFT JOIN artists a ON da.artist_id = a.id
      WHERE da.id = ?
    `, [id]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: '作品不存在' });
    }

    const artwork = processObjectImages(rows[0], ['image_url', 'artist_avatar']);

    const artist = {
      id: artwork.artist_id,
      name: artwork.artist_name,
      avatar: artwork.artist_avatar,
      description: artwork.artist_description
    };
    
    // 移除 artist 相关字段，避免在顶层重复
    const { artist_id, artist_name, artist_avatar, artist_description, ...artworkData } = artwork;

    const result = {
      ...artworkData,
      artist: artist
    };
    res.json(result);
    // 写入redis缓存，7天过期
    await redisClient.setEx(REDIS_DIGITAL_ARTWORK_DETAIL_KEY_PREFIX + id, 604800, JSON.stringify(result));
  } catch (error) {
    console.error('获取数字艺术品详情失败:', error);
    
    // 检查是否是连接池问题
    if (error.message === 'Pool is closed.' || error.message.includes('Pool is closed')) {
      return res.status(503).json({ 
        error: '数据库连接暂时不可用，请稍后重试',
        code: 'DB_POOL_CLOSED'
      });
    }
    
    res.status(500).json({ error: '获取数字艺术品详情服务暂时不可用' });
  }
});



// 公共数字艺术品列表接口（无需认证）
router.get('/public', async (req, res) => {
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
    
    let query = 'SELECT id, title, image_url, description, price, created_at FROM digital_artworks';
    const queryParams = [];
    
    // 如果提供了 artist_id 参数，添加筛选条件
    if (artist_id) {
      query += ' WHERE artist_id = ?';
      queryParams.push(parseInt(artist_id));
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    queryParams.push(sizeNum, offset);
    
    const [rows] = await db.query(query, queryParams);
    const artworksWithFullUrls = rows.map(artwork => ({
      ...artwork,
      image: artwork.image_url || '',
      price: artwork.price || 0
    }));
    res.json(artworksWithFullUrls);
  } catch (error) {
    console.error('Error fetching digital artworks (public):', error);
    res.status(500).json({ error: '获取数字艺术品数据服务暂时不可用' });
  }
});

// 创建数字艺术品（需要认证）
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      title,
      image_url,
      artist_id,
      description,
      registration_certificate,
      license_rights,
      license_period,
      owner_rights,
      license_items,
      project_name,
      product_name,
      project_owner,
      issuer,
      issue_batch,
      issue_year,
      batch_quantity,
      price
    } = req.body;

    if (!artist_id) {
      return res.status(400).json({ error: '缺少有效的艺术家ID' });
    }
    if (!validateImageUrl(image_url)) {
      return res.status(400).json({ error: '无效的图片URL' });
    }
    const [result] = await db.query(
      `INSERT INTO digital_artworks (
        title, image_url, artist_id, description, registration_certificate,
        license_rights, license_period, owner_rights, license_items,
        project_name, product_name, project_owner, issuer, issue_batch,
        issue_year, batch_quantity, price
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title, image_url, artist_id, description, registration_certificate,
        license_rights, license_period, owner_rights, license_items,
        project_name, product_name, project_owner, issuer, issue_batch,
        issue_year, batch_quantity, price
      ]
    );
    const [artistRows] = await db.query('SELECT id, name FROM artists WHERE id = ?', [artist_id]);
    const artist = artistRows[0] || {};
    // 清理缓存
    await redisClient.del(REDIS_DIGITAL_ARTWORKS_LIST_KEY);
    if (artist_id) {
      await redisClient.del(REDIS_DIGITAL_ARTWORKS_LIST_KEY_PREFIX + artist_id);
    }
    res.json({
      id: result.insertId,
      title,
      image_url,
      artist: {
        id: artist.id,
        name: artist.name
      },
      description,
      registration_certificate,
      license_rights,
      license_period,
      owner_rights,
      license_items,
      project_name,
      product_name,
      project_owner,
      issuer,
      issue_batch,
      issue_year,
      batch_quantity,
      price,
      created_at: new Date()
    });
  } catch (error) {
    console.error('Error creating digital artwork:', error);
    res.status(500).json({ error: '创建失败' });
  }
});

// 更新数字艺术品（需要认证）
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const {
      title,
      image_url,
      artist_id,
      description,
      registration_certificate,
      license_rights,
      license_period,
      owner_rights,
      license_items,
      project_name,
      product_name,
      project_owner,
      issuer,
      issue_batch,
      issue_year,
      batch_quantity,
      price
    } = req.body;
    if (!artist_id) {
      return res.status(400).json({ error: '缺少有效的艺术家ID' });
    }
    if (!validateImageUrl(image_url)) {
      return res.status(400).json({ error: '无效的图片URL' });
    }
    await db.query(
      `UPDATE digital_artworks SET 
        title = ?, image_url = ?, artist_id = ?, description = ?, 
        registration_certificate = ?, license_rights = ?, license_period = ?,
        owner_rights = ?, license_items = ?, project_name = ?, product_name = ?,
        project_owner = ?, issuer = ?, issue_batch = ?, issue_year = ?,
        batch_quantity = ?, price = ?
      WHERE id = ?`,
      [
        title, image_url, artist_id, description, registration_certificate,
        license_rights, license_period, owner_rights, license_items,
        project_name, product_name, project_owner, issuer, issue_batch,
        issue_year, batch_quantity, price, req.params.id
      ]
    );
    const [artistRows] = await db.query('SELECT id, name FROM artists WHERE id = ?', [artist_id]);
    const artist = artistRows[0] || {};
    // 清理缓存
    await redisClient.del(REDIS_DIGITAL_ARTWORKS_LIST_KEY);
    if (artist_id) {
      await redisClient.del(REDIS_DIGITAL_ARTWORKS_LIST_KEY_PREFIX + artist_id);
    }
    await redisClient.del(REDIS_DIGITAL_ARTWORK_DETAIL_KEY_PREFIX + req.params.id);
    res.json({
      id: parseInt(req.params.id),
      title,
      image_url,
      artist: {
        id: artist.id,
        name: artist.name
      },
      description,
      registration_certificate,
      license_rights,
      license_period,
      owner_rights,
      license_items,
      project_name,
      product_name,
      project_owner,
      issuer,
      issue_batch,
      issue_year,
      batch_quantity,
      price
    });
  } catch (error) {
    console.error('Error updating digital artwork:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

// 删除数字艺术品（需要认证）
router.delete('/:id', authenticateToken, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // 先查询artist_id用于清理缓存
    const [artworkRows] = await connection.query('SELECT artist_id FROM digital_artworks WHERE id = ?', [req.params.id]);
    const artistId = artworkRows.length > 0 ? artworkRows[0].artist_id : null;

    // 先删除相关的数字身份购买记录
    await connection.query('DELETE FROM digital_identity_purchases WHERE digital_artwork_id = ?', [req.params.id]);
    
    // 删除购物车中的相关记录
    await connection.query('DELETE FROM cart_items WHERE digital_artwork_id = ? AND type = "digital"', [req.params.id]);
    
    // 删除数字艺术品
    await connection.query('DELETE FROM digital_artworks WHERE id = ?', [req.params.id]);

    await connection.commit();
    // 清理缓存
    await redisClient.del(REDIS_DIGITAL_ARTWORKS_LIST_KEY);
    if (artistId) {
      await redisClient.del(REDIS_DIGITAL_ARTWORKS_LIST_KEY_PREFIX + artistId);
    }
    await redisClient.del(REDIS_DIGITAL_ARTWORK_DETAIL_KEY_PREFIX + req.params.id);
    res.json({ message: '删除成功' });
  } catch (error) {
    await connection.rollback();
    console.error('Error deleting digital artwork:', error);
    res.status(500).json({ error: '删除失败' });
  } finally {
    connection.release();
  }
});

module.exports = router; 