const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../auth');
const { processObjectImages } = require('../utils/image');

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
    const { artist_id } = req.query;
    
    let query = `
      SELECT 
        da.*,
        a.id as artist_id,
        a.name as artist_name,
        a.avatar as artist_avatar
      FROM digital_artworks da 
      LEFT JOIN artists a ON da.artist_id = a.id
    `;
    
    const queryParams = [];
    
    // 如果提供了 artist_id 参数，添加筛选条件
    if (artist_id) {
      query += ` WHERE da.artist_id = ?`;
      queryParams.push(artist_id);
    }
    
    query += ` ORDER BY da.created_at DESC`;
    
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
  } catch (error) {
    console.error('获取数字艺术品列表失败:', error);
    res.status(500).json({ error: '获取数字艺术品列表失败' });
  }
});

// 获取数字艺术品详情（公开接口）
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        da.*,
        a.id as artist_id,
        a.name as artist_name,
        a.avatar as artist_avatar,
        a.description as artist_description
      FROM digital_artworks da
      LEFT JOIN artists a ON da.artist_id = a.id
      WHERE da.id = ?
    `, [req.params.id]);

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

    res.json({
      ...artworkData,
      artist: artist
    });
  } catch (error) {
    console.error('获取数字艺术品详情失败:', error);
    res.status(500).json({ error: '获取数字艺术品详情失败' });
  }
});



// 公共数字艺术品列表接口（无需认证）
router.get('/public', async (req, res) => {
  try {
    const { artist_id } = req.query;
    
    let query = 'SELECT * FROM digital_artworks';
    const queryParams = [];
    
    // 如果提供了 artist_id 参数，添加筛选条件
    if (artist_id) {
      query += ' WHERE artist_id = ?';
      queryParams.push(artist_id);
    }
    
    const [rows] = await db.query(query, queryParams);
    const artworksWithFullUrls = rows.map(artwork => ({
      ...artwork,
      image: artwork.image_url || '',
      copyright: artwork.copyright || '',
      price: artwork.price || 0
    }));
    res.json(artworksWithFullUrls);
  } catch (error) {
    console.error('Error fetching digital artworks (public):', error);
    res.status(500).json({ error: '获取数据失败' });
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

    // 先删除相关的数字身份购买记录
    await connection.query('DELETE FROM digital_identity_purchases WHERE digital_artwork_id = ?', [req.params.id]);
    
    // 删除购物车中的相关记录
    await connection.query('DELETE FROM cart_items WHERE digital_artwork_id = ? AND type = "digital"', [req.params.id]);
    
    // 删除数字艺术品
    await connection.query('DELETE FROM digital_artworks WHERE id = ?', [req.params.id]);

    await connection.commit();
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