const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../auth');

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

// 数字艺术品相关接口
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM digital_artworks');
    console.log('Digital artworks query result:', rows);
    
    if (!rows || !Array.isArray(rows)) {
      console.log('Invalid digital artworks data:', rows);
      return res.json([]);
    }
    
    // 为每个作品的图片添加完整URL
    const artworksWithFullUrls = rows.map(artwork => ({
      ...artwork,
      image: artwork.image_url || '',
      price: artwork.price || 0
    }));
    res.json(artworksWithFullUrls);
  } catch (error) {
    console.error('Error fetching digital artworks:', error);
    res.status(500).json({ error: '获取数据失败' });
  }
});

// 公共数字艺术品列表接口（无需认证）
router.get('/public', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM digital_artworks');
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
      author, 
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
    
    // 验证图片URL
    if (!validateImageUrl(image_url)) {
      return res.status(400).json({ error: '无效的图片URL' });
    }
    
    const [result] = await db.query(
      `INSERT INTO digital_artworks (
        title, image_url, author, description, registration_certificate,
        license_rights, license_period, owner_rights, license_items,
        project_name, product_name, project_owner, issuer, issue_batch,
        issue_year, batch_quantity, price
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title, image_url, author, description, registration_certificate,
        license_rights, license_period, owner_rights, license_items,
        project_name, product_name, project_owner, issuer, issue_batch,
        issue_year, batch_quantity, price
      ]
    );
    
    res.json({ 
      id: result.insertId,
      title,
      image_url,
      author,
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
      author, 
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
    
    // 验证图片URL
    if (!validateImageUrl(image_url)) {
      return res.status(400).json({ error: '无效的图片URL' });
    }
    
    await db.query(
      `UPDATE digital_artworks SET 
        title = ?, image_url = ?, author = ?, description = ?, 
        registration_certificate = ?, license_rights = ?, license_period = ?,
        owner_rights = ?, license_items = ?, project_name = ?, product_name = ?,
        project_owner = ?, issuer = ?, issue_batch = ?, issue_year = ?,
        batch_quantity = ?, price = ?
      WHERE id = ?`,
      [
        title, image_url, author, description, registration_certificate,
        license_rights, license_period, owner_rights, license_items,
        project_name, product_name, project_owner, issuer, issue_batch,
        issue_year, batch_quantity, price, req.params.id
      ]
    );
    
    res.json({ 
      id: parseInt(req.params.id),
      title,
      image_url,
      author,
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