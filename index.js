const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const db = require('./db');
const https = require('https');
const fs = require('fs');
const { body } = require('express-validator');
const auth = require('./auth');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const xml2js = require('xml2js');

const app = express();
const port = 2000;

// CORS 配置
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      'http://localhost:5173',
      'https://wx.ht.2000gallery.art',
      'http://wx.ht.2000gallery.art',
      'https://www.wx.ht.2000gallery.art',
      'http://www.wx.ht.2000gallery.art'
    ];
    
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, origin);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
  exposedHeaders: ['Authorization']
}));

// 安全相关的响应头
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// 解析JSON请求体
app.use(express.json());

// 解析URL编码的请求体
app.use(express.urlencoded({ extended: true }));

// 静态文件服务
app.use('/uploads', express.static('uploads'));

// 创建上传目录
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// SSL证书配置
const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, 'api.wx.2000gallery.art.key')),
  cert: fs.readFileSync(path.join(__dirname, 'api.wx.2000gallery.art.pem'))
};

// 添加基础URL配置
const BASE_URL = 'https://api.wx.2000gallery.art:2000';

// 配置文件上传
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    // 获取文件扩展名
    const ext = path.extname(file.originalname).toLowerCase();
    // 生成文件名
    cb(null, Date.now() + ext);
  }
});

// 文件类型验证
const fileFilter = (req, file, cb) => {
  // 允许的文件类型
  const allowedTypes = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedTypes.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('不支持的文件类型'));
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 限制文件大小为5MB
  }
});

// 配置中间件
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// 创建上传目录
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// 文件上传接口
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '没有上传文件' });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    const fullUrl = `${BASE_URL}${fileUrl}`;
    res.json({ 
      url: fileUrl,
      fullUrl: fullUrl,
      filename: req.file.filename,
      size: req.file.size
    });
  } catch (error) {
    console.error('文件上传失败:', error);
    res.status(500).json({ error: '文件上传失败' });
  }
});

// 艺术家相关接口
app.get('/api/artists', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM artists');
    console.log('Artists query result:', rows);
    
    if (!rows || !Array.isArray(rows)) {
      console.log('Invalid artists data:', rows);
      return res.json([]);
    }
    const artistsWithFullUrls = rows.map(artist => ({
      ...artist,
      avatar: artist.avatar ? (artist.avatar.startsWith('http') ? artist.avatar : `${BASE_URL}${artist.avatar}`) : '',
      banner: artist.banner ? (artist.banner.startsWith('http') ? artist.banner : `${BASE_URL}${artist.banner}`) : ''
    }));
    res.json(artistsWithFullUrls);
  } catch (error) {
    console.error('Error fetching artists:', error);
    res.status(500).json({ error: '获取数据失败' });
  }
});

app.post('/api/artists', async (req, res) => {
  try {
    const { avatar, name, description } = req.body;
    const [result] = await db.query(
      'INSERT INTO artists (avatar, name, description) VALUES (?, ?, ?)',
      [avatar, name, description]
    );
    res.json({ id: result.insertId, ...req.body });
  } catch (error) {
    console.error('Error creating artist:', error);
    res.status(500).json({ error: '创建失败' });
  }
});

// 更新艺术家接口
app.put('/api/artists/:id', async (req, res) => {
  try {
    const { name, era, avatar, banner, description, biography, journey } = req.body;
    
    // 验证图片URL
    if (avatar && !validateImageUrl(avatar)) {
      return res.status(400).json({ error: '无效的头像URL' });
    }
    if (banner && !validateImageUrl(banner)) {
      return res.status(400).json({ error: '无效的背景图URL' });
    }

    // 更新艺术家信息
    await db.query(
      'UPDATE artists SET name = ?, era = ?, avatar = ?, banner = ?, description = ?, biography = ?, journey = ? WHERE id = ?',
      [name, era, avatar, banner, description, biography, journey, req.params.id]
    );

    // 获取更新后的艺术家信息
    const [artists] = await db.query('SELECT * FROM artists WHERE id = ?', [req.params.id]);
    if (artists.length === 0) {
      return res.status(404).json({ error: '艺术家不存在' });
    }

    const artist = artists[0];
    // 处理图片URL
    const artistWithFullUrls = {
      ...artist,
      avatar: artist.avatar ? (artist.avatar.startsWith('http') ? artist.avatar : `${BASE_URL}${artist.avatar}`) : '',
      banner: artist.banner ? (artist.banner.startsWith('http') ? artist.banner : `${BASE_URL}${artist.banner}`) : ''
    };

    res.json(artistWithFullUrls);
  } catch (error) {
    console.error('Error updating artist:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

// 删除艺术家接口
app.delete('/api/artists/:id', async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // 先删除与艺术家相关的作品
    await connection.query('DELETE FROM original_artworks WHERE artist_id = ?', [req.params.id]);
    
    // 然后删除艺术家
    await connection.query('DELETE FROM artists WHERE id = ?', [req.params.id]);

    await connection.commit();
    res.json({ message: '删除成功' });
  } catch (error) {
    await connection.rollback();
    console.error('Error deleting artist:', error);
    res.status(500).json({ error: '删除失败' });
  } finally {
    connection.release();
  }
});

// 验证图片URL的函数
function validateImageUrl(url) {
  if (!url) return false;
  
  // 如果是相对路径，直接验证是否以 /uploads/ 开头
  if (url.startsWith('/uploads/')) {
    return true;
  }
  
  // 如果是完整URL，解析并验证
  try {
    const urlObj = new URL(url);
    return urlObj.pathname.startsWith('/uploads/');
  } catch (e) {
    return false;
  }
}

// 获取艺术品列表
app.get('/api/original-artworks', async (req, res) => {
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
    
    // 为每个图片URL添加BASE_URL并构建正确的数据结构
    const artworksWithFullUrls = rows.map(artwork => ({
      ...artwork,
      image: artwork.image ? (artwork.image.startsWith('http') ? artwork.image : `${BASE_URL}${artwork.image}`) : '',
      artist: {
        id: artwork.artist_id,
        name: artwork.artist_name,
        avatar: artwork.artist_avatar ? (artwork.artist_avatar.startsWith('http') ? artwork.artist_avatar : `${BASE_URL}${artwork.artist_avatar}`) : ''
      },
      collection: {
        location: artwork.collection_location,
        number: artwork.collection_number,
        size: artwork.collection_size,
        material: artwork.collection_material
      }
    }));
    
    res.json(artworksWithFullUrls);
  } catch (error) {
    console.error('获取艺术品列表失败:', error);
    res.status(500).json({ error: '获取艺术品列表失败' });
  }
});

app.post('/api/original-artworks', async (req, res) => {
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

app.put('/api/original-artworks/:id', async (req, res) => {
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

app.delete('/api/original-artworks/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM original_artworks WHERE id = ?', [req.params.id]);
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('Error deleting original artwork:', error);
    res.status(500).json({ error: '删除失败' });
  }
});

// 数字艺术品相关接口
app.get('/api/digital-artworks', async (req, res) => {
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
      image: artwork.image_url ? (artwork.image_url.startsWith('http') ? artwork.image_url : `${BASE_URL}${artwork.image_url}`) : '',
      price: artwork.price || 0
    }));
    res.json(artworksWithFullUrls);
  } catch (error) {
    console.error('Error fetching digital artworks:', error);
    res.status(500).json({ error: '获取数据失败' });
  }
});

app.post('/api/digital-artworks', async (req, res) => {
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

app.put('/api/digital-artworks/:id', async (req, res) => {
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

app.delete('/api/digital-artworks/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM digital_artworks WHERE id = ?', [req.params.id]);
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('Error deleting digital artwork:', error);
    res.status(500).json({ error: '删除失败' });
  }
});

// 实物分类相关接口
app.get('/api/physical-categories', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM physical_categories');
    console.log('Physical categories query result:', rows);
    
    if (!rows || !Array.isArray(rows)) {
      console.log('Invalid physical categories data:', rows);
      return res.json([]);
    }
    
    // 为每个分类的图片添加完整URL
    const categoriesWithFullUrls = rows.map(category => ({
      ...category,
      image: category.image ? (category.image.startsWith('http') ? category.image : `${BASE_URL}${category.image}`) : '',
      icon: category.icon ? (category.icon.startsWith('http') ? category.icon : `${BASE_URL}${category.icon}`) : ''
    }));
    res.json(categoriesWithFullUrls);
  } catch (error) {
    console.error('Error fetching physical categories:', error);
    res.status(500).json({ error: '获取数据失败' });
  }
});

app.post('/api/physical-categories', async (req, res) => {
  try {
    const { title, image, icon, count, description } = req.body;
    const [result] = await db.query(
      'INSERT INTO physical_categories (title, image, icon, count, description) VALUES (?, ?, ?, ?, ?)',
      [title, image, icon, count, description]
    );
    res.json({ id: result.insertId, ...req.body });
  } catch (error) {
    console.error('Error creating physical category:', error);
    res.status(500).json({ error: '创建失败' });
  }
});

app.put('/api/physical-categories/:id', async (req, res) => {
  try {
    const { title, image, icon, count, description } = req.body;
    await db.query(
      'UPDATE physical_categories SET title = ?, image = ?, icon = ?, count = ?, description = ? WHERE id = ?',
      [title, image, icon, count, description, req.params.id]
    );
    res.json({ id: req.params.id, ...req.body });
  } catch (error) {
    console.error('Error updating physical category:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

app.delete('/api/physical-categories/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM physical_categories WHERE id = ?', [req.params.id]);
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('Error deleting physical category:', error);
    res.status(500).json({ error: '删除失败' });
  }
});

// 获取作品详情
app.get('/api/artworks/:id', async (req, res) => {
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

    const artwork = rows[0];
    // 处理图片URL
    artwork.image = artwork.image ? (artwork.image.startsWith('http') ? artwork.image : `${BASE_URL}${artwork.image}`) : '';
    artwork.artist_avatar = artwork.artist_avatar ? (artwork.artist_avatar.startsWith('http') ? artwork.artist_avatar : `${BASE_URL}${artwork.artist_avatar}`) : '';

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
      artist: artist
    });
  } catch (error) {
    console.error('获取作品详情失败:', error);
    res.status(500).json({ error: '获取作品详情失败' });
  }
});

// 获取艺术家详情
app.get('/api/artists/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM artists WHERE id = ?', [req.params.id]);
    
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: '艺术家不存在' });
    }

    const artist = rows[0];

    const [achievementRows] = await db.query(
      'SELECT * FROM artist_achievements WHERE artist_id = ?',
      [req.params.id]
    );

    const [artworkRows] = await db.query(
      'SELECT id, title, image FROM original_artworks WHERE artist_id = ?',
      [req.params.id]
    );

    // 处理图片URL
    const processedArtworks = artworkRows.map(artwork => ({
      ...artwork,
      image: artwork.image ? (artwork.image.startsWith('http') ? artwork.image : `${BASE_URL}${artwork.image}`) : ''
    }));

    res.json({
      name: artist.name,
      avatar: artist.avatar ? (artist.avatar.startsWith('http') ? artist.avatar : `${BASE_URL}${artist.avatar}`) : '',
      banner: artist.banner ? (artist.banner.startsWith('http') ? artist.banner : `${BASE_URL}${artist.banner}`) : '',
      era: artist.era,
      description: artist.description,
      biography: artist.biography,
      journey: artist.journey,
      artworks: processedArtworks,
      achievements: achievementRows
    });
  } catch (error) {
    console.error('获取艺术家详情失败:', error);
    res.status(500).json({ error: '获取艺术家详情失败' });
  }
});

// 获取版权实物列表
app.get('/api/rights', async (req, res) => {
  try {
    // 获取版权实物基本信息和分类信息
    const [rows] = await db.query(`
      SELECT r.*, c.title as category_title
      FROM rights r
      LEFT JOIN physical_categories c ON r.category_id = c.id
      ORDER BY r.id DESC
    `);
    
    if (!rows || !Array.isArray(rows)) {
      return res.json([]);
    }

    // 获取每个版权实物的图片
    for (const right of rows) {
      const [images] = await db.query(
        'SELECT image_url FROM right_images WHERE right_id = ?',
        [right.id]
      );
      right.images = images.map(img => 
        img.image_url.startsWith('http') ? img.image_url : `${BASE_URL}${img.image_url}`
      );
    }

    res.json(rows);
  } catch (error) {
    console.error('获取版权实物列表失败:', error);
    res.status(500).json({ error: '获取版权实物列表失败' });
  }
});

// 新增版权实物（增加 category_id）
app.post('/api/rights', async (req, res) => {
  try {
    const { title, status, price, originalPrice, period, totalCount, remainingCount, description, images, category_id } = req.body;
    // 开始事务
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 插入版权实物基本信息
      const [result] = await connection.query(
        'INSERT INTO rights (title, status, price, original_price, period, total_count, remaining_count, description, category_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [title, status, price, originalPrice, period, totalCount, remainingCount, description, category_id]
      );

      const rightId = result.insertId;

      // 插入图片
      if (images && images.length > 0) {
        const imageValues = images.map(image => [rightId, image]);
        await connection.query(
          'INSERT INTO right_images (right_id, image_url) VALUES ?',
          [imageValues]
        );
      }

      await connection.commit();
      // 返回完整的版权实物信息
      const [newRight] = await db.query(`
        SELECT r.*, c.title as category_title
        FROM rights r
        LEFT JOIN physical_categories c ON r.category_id = c.id
        WHERE r.id = ?
        GROUP BY r.id
      `, [rightId]);

      res.json(newRight[0]);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('创建版权实物失败:', error);
    res.status(500).json({ error: '创建版权实物失败' });
  }
});

// 编辑版权实物（增加 category_id）
app.put('/api/rights/:id', async (req, res) => {
  try {
    const { title, status, price, originalPrice, period, totalCount, remainingCount, description, images, category_id } = req.body;
    // 开始事务
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 更新版权实物基本信息
      await connection.query(
        'UPDATE rights SET title = ?, status = ?, price = ?, original_price = ?, period = ?, total_count = ?, remaining_count = ?, description = ?, category_id = ? WHERE id = ?',
        [title, status, price, originalPrice, period, totalCount, remainingCount, description, category_id, req.params.id]
      );

      // 删除旧图片
      await connection.query('DELETE FROM right_images WHERE right_id = ?', [req.params.id]);

      // 插入新图片，处理图片URL
      if (images && images.length > 0) {
        const imageValues = images.map(image => {
          // 如果是完整URL，需要移除BASE_URL前缀
          const imageUrl = image.startsWith(BASE_URL) ? image.substring(BASE_URL.length) : image;
          return [req.params.id, imageUrl];
        });
        await connection.query(
          'INSERT INTO right_images (right_id, image_url) VALUES ?',
          [imageValues]
        );
      }

      await connection.commit();
      // 返回更新后的版权实物信息
      const [updatedRight] = await db.query(`
        SELECT r.*, c.title as category_title
        FROM rights r
        LEFT JOIN physical_categories c ON r.category_id = c.id
        WHERE r.id = ?
        GROUP BY r.id
      `, [req.params.id]);

      // 获取并处理图片URL
      const [rightImages] = await db.query(
        'SELECT image_url FROM right_images WHERE right_id = ?',
        [req.params.id]
      );
      updatedRight[0].images = rightImages.map(img => 
        img.image_url.startsWith('http') ? img.image_url : `${BASE_URL}${img.image_url}`
      );

      res.json(updatedRight[0]);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('更新版权实物失败:', error);
    res.status(500).json({ error: '更新版权实物失败' });
  }
});

// 删除版权实物
app.delete('/api/rights/:id', async (req, res) => {
  try {
    // 开始事务
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 先删除相关的订单项
      await connection.query('DELETE FROM order_items WHERE right_id = ?', [req.params.id]);
      
      // 删除图片
      await connection.query('DELETE FROM right_images WHERE right_id = ?', [req.params.id]);
      
      // 删除版权实物
      await connection.query('DELETE FROM rights WHERE id = ?', [req.params.id]);

      await connection.commit();
      res.json({ message: '删除成功' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('删除版权实物失败:', error);
    res.status(500).json({ error: '删除版权实物失败' });
  }
});

// 获取版权实物详情（公开接口）
app.get('/api/rights/public/:id', async (req, res) => {
  try {
    const [right] = await db.query('SELECT * FROM rights WHERE id = ?', [req.params.id]);
    
    if (!right || right.length === 0) {
      return res.status(404).json({ error: '版权实物不存在' });
    }

    const [images] = await db.query(
      'SELECT image_url FROM right_images WHERE right_id = ?',
      [req.params.id]
    );

    const [details] = await db.query(
      'SELECT title, content FROM right_details WHERE right_id = ?',
      [req.params.id]
    );

    const [rules] = await db.query(
      'SELECT title, content FROM right_rules WHERE right_id = ?',
      [req.params.id]
    );

    // 获取分类信息
    const [category] = await db.query(
      'SELECT * FROM physical_categories WHERE id = ?',
      [right[0].category_id]
    );

    res.json({
      id: right[0].id,
      title: right[0].title,
      price: right[0].price,
      originalPrice: right[0].original_price,
      description: right[0].description,
      status: right[0].status,
      period: right[0].period,
      remainingCount: right[0].remaining_count,
      totalCount: right[0].total_count,
      category: {
        id: category[0]?.id || null,
        title: category[0]?.title || '',
        image: category[0]?.image ? (category[0].image.startsWith('http') ? category[0].image : `${BASE_URL}${category[0].image}`) : '',
        icon: category[0]?.icon ? (category[0].icon.startsWith('http') ? category[0].icon : `${BASE_URL}${category[0].icon}`) : '',
        count: category[0]?.count || 0,
        description: category[0]?.description || ''
      },
      images: images.map(img => 
        img.image_url.startsWith('http') ? img.image_url : `${BASE_URL}${img.image_url}`
      ),
      details: details.map(detail => ({
        title: detail.title,
        content: detail.content
      })),
      rules: rules.map(rule => ({
        title: rule.title,
        content: rule.content
      })),
      createdAt: right[0].created_at,
      updatedAt: right[0].updated_at
    });
  } catch (error) {
    console.error('获取版权实物详情失败:', error);
    res.status(500).json({ error: '获取版权实物详情失败' });
  }
});

// 搜索接口
app.get('/api/search', async (req, res) => {
  try {
    const { keyword } = req.query;
    if (!keyword) {
      return res.status(400).json({ error: '请输入搜索关键词' });
    }

    const searchTerm = `%${keyword}%`;
    
    // 搜索艺术家
    const [artistRows] = await db.query(
      `SELECT id, name, avatar, description, 'artist' as type 
       FROM artists 
       WHERE name LIKE ? OR description LIKE ?`,
      [searchTerm, searchTerm]
    );

    // 搜索原创作品
    const [artworkRows] = await db.query(
      `SELECT id, title, image, description, 'original_artwork' as type 
       FROM original_artworks 
       WHERE title LIKE ? OR description LIKE ?`,
      [searchTerm, searchTerm]
    );

    // 搜索数字作品
    const [digitalRows] = await db.query(
      `SELECT id, title, image_url as image, description, 'digital_artwork' as type 
       FROM digital_artworks 
       WHERE title LIKE ? OR description LIKE ?`,
      [searchTerm, searchTerm]
    );

    // 合并结果并添加完整URL
    const results = [
      ...artistRows.map(item => ({
        ...item,
        avatar: item.avatar ? (item.avatar.startsWith('http') ? item.avatar : `${BASE_URL}${item.avatar}`) : ''
      })),
      ...artworkRows.map(item => ({
        ...item,
        image: item.image ? (item.image.startsWith('http') ? item.image : `${BASE_URL}${item.image}`) : ''
      })),
      ...digitalRows.map(item => ({
        ...item,
        image: item.image ? (item.image.startsWith('http') ? item.image : `${BASE_URL}${item.image}`) : ''
      }))
    ];

    res.json(results);
  } catch (error) {
    console.error('搜索失败:', error);
    res.status(500).json({ error: '搜索失败' });
  }
});

// 公共数字艺术品列表接口（无需认证）
app.get('/api/digital-artworks/public', async (req, res) => {
    try {
      const [rows] = await db.query('SELECT * FROM digital_artworks');
      const artworksWithFullUrls = rows.map(artwork => ({
        ...artwork,
        image: artwork.image_url ? (artwork.image_url.startsWith('http') ? artwork.image_url : `${BASE_URL}${artwork.image_url}`) : '',
        copyright: artwork.copyright || '',
        price: artwork.price || 0
      }));
      res.json(artworksWithFullUrls);
    } catch (error) {
      console.error('Error fetching digital artworks (public):', error);
      res.status(500).json({ error: '获取数据失败' });
    }
  });
  

// 认证相关路由
app.post('/api/auth/register', [
  body('username').isLength({ min: 3 }).withMessage('用户名至少3个字符'),
  body('email').isEmail().withMessage('请输入有效的邮箱地址'),
  body('password').isLength({ min: 6 }).withMessage('密码至少6个字符')
], auth.register);

app.post('/api/auth/login', [
  body('username').notEmpty().withMessage('请输入用户名'),
  body('password').notEmpty().withMessage('请输入密码')
], auth.login);

app.get('/api/auth/me', auth.authenticateToken, auth.getCurrentUser);

app.post('/api/auth/logout', auth.authenticateToken, auth.logout);

// 保护需要认证的路由
app.use('/api/artists', auth.authenticateToken);
app.use('/api/original-artworks', auth.authenticateToken);
app.use('/api/digital-artworks', auth.authenticateToken);
app.use('/api/rights', auth.authenticateToken);

// 保护需要管理员权限的路由
app.use('/api/admin/*', auth.authenticateToken, auth.checkRole(['admin']));

// 获取轮播图列表（公开接口）
app.get('/api/banners', async (req, res) => {
  try {
    const [banners] = await db.query(
      'SELECT * FROM banners WHERE status = "active" ORDER BY sort_order ASC'
    );
    
    // 处理图片URL
    const bannersWithFullUrls = banners.map(banner => ({
      ...banner,
      image_url: banner.image_url ? (banner.image_url.startsWith('http') ? banner.image_url : `${BASE_URL}${banner.image_url}`) : ''
    }));
    
    res.json(bannersWithFullUrls);
  } catch (error) {
    console.error('获取轮播图列表失败:', error);
    res.status(500).json({ error: '获取轮播图列表失败' });
  }
});

// 新增：获取所有轮播图（管理后台用）
app.get('/api/banners/all', async (req, res) => {
  try {
    const [banners] = await db.query(
      'SELECT * FROM banners ORDER BY sort_order ASC'
    );
    // 处理图片URL
    const bannersWithFullUrls = banners.map(banner => ({
      ...banner,
      image_url: banner.image_url ? (banner.image_url.startsWith('http') ? banner.image_url : `${BASE_URL}${banner.image_url}`) : ''
    }));
    res.json(bannersWithFullUrls);
  } catch (error) {
    console.error('获取所有轮播图失败:', error);
    res.status(500).json({ error: '获取所有轮播图失败' });
  }
});

// 添加轮播图（需要认证）
app.post('/api/banners', auth.authenticateToken, async (req, res) => {
  try {
    const { title, image_url, link_url, sort_order } = req.body;
    
    if (!title || !image_url) {
      return res.status(400).json({ error: '标题和图片URL不能为空' });
    }

    const [result] = await db.query(
      'INSERT INTO banners (title, image_url, link_url, sort_order) VALUES (?, ?, ?, ?)',
      [title, image_url, link_url || null, sort_order || 0]
    );

    const [banner] = await db.query('SELECT * FROM banners WHERE id = ?', [result.insertId]);
    res.json(banner[0]);
  } catch (error) {
    console.error('添加轮播图失败:', error);
    res.status(500).json({ error: '添加轮播图失败' });
  }
});

// 更新轮播图（需要认证）
app.put('/api/banners/:id', auth.authenticateToken, async (req, res) => {
  try {
    const { title, image_url, link_url, sort_order, status } = req.body;
    
    if (!title || !image_url) {
      return res.status(400).json({ error: '标题和图片URL不能为空' });
    }

    await db.query(
      'UPDATE banners SET title = ?, image_url = ?, link_url = ?, sort_order = ?, status = ? WHERE id = ?',
      [title, image_url, link_url || null, sort_order || 0, status || 'active', req.params.id]
    );

    const [banner] = await db.query('SELECT * FROM banners WHERE id = ?', [req.params.id]);
    res.json(banner[0]);
  } catch (error) {
    console.error('更新轮播图失败:', error);
    res.status(500).json({ error: '更新轮播图失败' });
  }
});

// 删除轮播图（需要认证）
app.delete('/api/banners/:id', auth.authenticateToken, async (req, res) => {
  try {
    await db.query('DELETE FROM banners WHERE id = ?', [req.params.id]);
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除轮播图失败:', error);
    res.status(500).json({ error: '删除轮播图失败' });
  }
});

// 微信小程序获取手机号接口
async function getAccessToken(appid, secret) {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`;
  const res = await axios.get(url);
  return res.data.access_token;
}

async function getPhoneNumberFromWx(code, access_token) {
  const url = `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${access_token}`;
  const res = await axios.post(url, { code });
  return res.data;
}

// 新增：获取手机号接口
app.post('/api/wx/getPhoneNumber', async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: '缺少 code' });
  }

  // 你的微信小程序 appid 和 appsecret
  const appid = 'wx96a502c78c9156d0'; // TODO: 替换为你自己的
  const secret = 'bf47d45e6b0a96b1d1b73b186860c4cb'; // TODO: 替换为你自己的

  try {
    // 1. 获取 access_token
    const access_token = await getAccessToken(appid, secret);
    // 2. 用 code 换手机号
    const result = await getPhoneNumberFromWx(code, access_token);
    if (result.errcode === 0) {
      res.json(result); // result.phone_info.phoneNumber 就是手机号
    } else {
      res.status(400).json({ error: result.errmsg });
    }
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// 小程序登录注册接口
app.post('/api/wx/login', async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: '缺少 code' });
  }

  const appid = 'wx96a502c78c9156d0';
  const secret = 'bf47d45e6b0a96b1d1b73b186860c4cb';

  try {
    // 1. 用 code 换 openid 和 session_key
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${code}&grant_type=authorization_code`;
    const wxRes = await axios.get(url);
    const { openid, session_key } = wxRes.data;

    if (!openid) {
      return res.status(400).json({ error: '微信登录失败', detail: wxRes.data });
    }

    // 2. 在你自己的数据库查找或注册用户（表名改为 wx_users）
    let [users] = await db.query('SELECT * FROM wx_users WHERE openid = ?', [openid]);
    let user;
    if (users.length === 0) {
      // 没有则注册
      const [result] = await db.query('INSERT INTO wx_users (openid, session_key) VALUES (?, ?)', [openid, session_key]);
      user = { id: result.insertId, openid, session_key };
    } else {
      // 有则更新 session_key
      await db.query('UPDATE wx_users SET session_key = ? WHERE openid = ?', [session_key, openid]);
      user = users[0];
    }

    // 3. 生成你自己系统的 token（如 JWT）
    const token = jwt.sign({ userId: user.id, openid }, 'your_jwt_secret', { expiresIn: '7d' });

    // 4. 返回用户信息和 token
    res.json({
      token,
      user: {
        id: user.id,
        openid
      }
    });
  } catch (err) {
    res.status(500).json({ error: '服务器错误', detail: err.message });
  }
});

// 绑定/更新小程序用户信息（手机号、昵称、头像）
app.post('/api/wx/bindUserInfo', async (req, res) => {
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

  const { phone, nickname, avatar } = req.body;
  if (!phone && !nickname && !avatar) {
    return res.status(400).json({ error: '缺少参数' });
  }

  try {
    // 只更新有传的字段
    const fields = [];
    const values = [];
    if (phone) {
      fields.push('phone = ?');
      values.push(phone);
    }
    if (nickname) {
      fields.push('nickname = ?');
      values.push(nickname);
    }
    if (avatar) {
      fields.push('avatar = ?');
      values.push(avatar);
    }
    values.push(payload.userId);

    const sql = `UPDATE wx_users SET ${fields.join(', ')} WHERE id = ?`;
    await db.query(sql, values);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取当前小程序用户信息
app.get('/api/wx/userInfo', async (req, res) => {
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

  try {
    const [users] = await db.query('SELECT * FROM wx_users WHERE id = ?', [payload.userId]);
    if (!users || users.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }
    const user = users[0];
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取购物车列表
app.get('/api/cart', async (req, res) => {
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
app.post('/api/cart', async (req, res) => {
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
app.put('/api/cart/:id', async (req, res) => {
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
app.delete('/api/cart/:id', async (req, res) => {
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
app.delete('/api/cart', async (req, res) => {
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

// 微信支付V3配置
const WX_PAY_CONFIG = {
  appId: 'wx96a502c78c9156d0', // 小程序appid
  mchId: '1360639602', // 商户号
  key: 'e0v3TF5sgZS82fk1ylb4oNqczZbKqeYk', // API密钥
  serialNo: '34DF8EA1B52AD35997FF23DFAD7940574A1D6857', // 商户证书序列号
  privateKey: fs.readFileSync(path.join(__dirname, 'apiclient_key.pem')), // 商户私钥
  notifyUrl: 'https://api.wx.2000gallery.art:2000/api/wx/pay/notify', // 支付回调地址
  spbillCreateIp: '127.0.0.1' // 终端IP
};

// 生成随机字符串
function generateNonceStr() {
  return Math.random().toString(36).substr(2, 15);
}

// 生成签名
function generateSignV3(method, url, timestamp, nonceStr, body) {
  // 1. 构造签名串
  const message = `${method}\n${url}\n${timestamp}\n${nonceStr}\n${body}\n`;
  
  // 2. 使用SHA256-RSA签名
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(message);
  const signature = sign.sign(WX_PAY_CONFIG.privateKey, 'base64');
  
  return signature;
}

// 验证签名
function verifySignV3(timestamp, nonceStr, body, signature) {
  const message = `${timestamp}\n${nonceStr}\n${body}\n`;
  const verify = crypto.createVerify('RSA-SHA256');
  verify.update(message);
  return verify.verify(WX_PAY_CONFIG.privateKey, signature, 'base64');
}

// 解密回调数据
function decryptCallbackData(associatedData, nonce, ciphertext) {
  const key = Buffer.from(WX_PAY_CONFIG.key, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(associatedData, 'base64'));
  let decrypted = decipher.update(Buffer.from(ciphertext, 'base64'));
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString('utf8');
}

// 统一下单接口
app.post('/api/wx/pay/unifiedorder', async (req, res) => {
  try {
    const { openid, total_fee, body, out_trade_no, cart_items } = req.body;

    if (!openid || !total_fee || !body || !out_trade_no || !cart_items) {
      return res.status(400).json({ error: '参数不完整' });
    }

    // 开始事务
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 根据openid获取用户id
      const [users] = await connection.query(
        'SELECT id FROM wx_users WHERE openid = ?',
        [openid]
      );

      if (!users || users.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: '用户不存在' });
      }

      const userId = users[0].id;

      // 获取用户可用的抵扣金额
      const [discounts] = await connection.query(`
        SELECT SUM(dip.discount_amount) as total_discount
        FROM digital_identity_purchases dip
        WHERE dip.user_id = ? AND dip.discount_amount > 0
      `, [userId]);

      const availableDiscount = discounts[0].total_discount || 0;

      // 校验所有商品
      for (const item of cart_items) {
        if (item.type === 'right') {
          const [rights] = await connection.query(
            'SELECT id, price, remaining_count, discount_amount FROM rights WHERE id = ? AND status = "onsale"',
            [item.right_id]
          );
          if (!rights || rights.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: `商品ID ${item.right_id} 不存在或已下架` });
          }
          if (rights[0].remaining_count < item.quantity) {
            await connection.rollback();
            return res.status(400).json({ error: `商品ID ${item.right_id} 库存不足` });
          }
          // 验证价格
          const itemPrice = parseFloat(item.price);
          const dbPrice = parseFloat(rights[0].price);
          if (Math.abs(itemPrice - dbPrice) > 0.01) {
            await connection.rollback();
            return res.status(400).json({
              error: `商品ID ${item.right_id} 价格不匹配`,
              detail: {
                expected: dbPrice,
                received: itemPrice
              }
            });
          }
        } else if (item.type === 'artwork') {
          const [artworks] = await connection.query(
            'SELECT id, original_price, discount_price, stock FROM original_artworks WHERE id = ? AND is_on_sale = 1',
            [item.artwork_id]
          );
          if (!artworks || artworks.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: `艺术品ID ${item.artwork_id} 不存在或已下架` });
          }
          if (artworks[0].stock < item.quantity) {
            await connection.rollback();
            return res.status(400).json({ error: `艺术品ID ${item.artwork_id} 库存不足` });
          }
          // 验证价格
          const itemPrice = parseFloat(item.price);
          const actualPrice = (artworks[0].discount_price && artworks[0].discount_price > 0 && artworks[0].discount_price < artworks[0].original_price)
            ? artworks[0].discount_price
            : artworks[0].original_price;
          if (Math.abs(itemPrice - actualPrice) > 0.01) {
            await connection.rollback();
            return res.status(400).json({
              error: `艺术品ID ${item.artwork_id} 价格不匹配`,
              detail: {
                expected: actualPrice,
                received: itemPrice
              }
            });
          }
        } else if (item.type === 'digital') {
          const [digitals] = await connection.query(
            'SELECT id, price FROM digital_artworks WHERE id = ?',
            [item.digital_artwork_id]
          );
          if (!digitals || digitals.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: `数字艺术品ID ${item.digital_artwork_id} 不存在` });
          }
          // 验证价格
          const itemPrice = parseFloat(item.price);
          const dbPrice = parseFloat(digitals[0].price);
          if (Math.abs(itemPrice - dbPrice) > 0.01) {
            await connection.rollback();
            return res.status(400).json({
              error: `数字艺术品ID ${item.digital_artwork_id} 价格不匹配`,
              detail: {
                expected: dbPrice,
                received: itemPrice
              }
            });
          }
        } else {
          await connection.rollback();
          return res.status(400).json({ error: `不支持的商品类型: ${item.type}` });
        }
      }

      // 计算实际支付金额（考虑抵扣）
      const actualTotalFee = Math.max(0, total_fee - availableDiscount);

      // 创建订单
      const [orderResult] = await connection.query(
        'INSERT INTO orders (user_id, out_trade_no, total_fee, actual_fee, discount_amount, body) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, out_trade_no, total_fee, actualTotalFee, availableDiscount, body]
      );

      const orderId = orderResult.insertId;

      // 创建订单项，支持三种类型
      const orderItems = cart_items.map(item => {
        if (item.type === 'right') {
          return [orderId, 'right', item.right_id, null, null, item.quantity, parseFloat(item.price)];
        } else if (item.type === 'digital') {
          return [orderId, 'digital', null, item.digital_artwork_id, null, item.quantity, parseFloat(item.price)];
        } else if (item.type === 'artwork') {
          return [orderId, 'artwork', null, null, item.artwork_id, item.quantity, parseFloat(item.price)];
        }
      });
      await connection.query(
        'INSERT INTO order_items (order_id, type, right_id, digital_artwork_id, artwork_id, quantity, price) VALUES ?',
        [orderItems]
      );

      // 如果使用了抵扣，更新抵扣记录
      if (availableDiscount > 0) {
        await connection.query(`
          UPDATE digital_identity_purchases 
          SET discount_amount = 0 
          WHERE user_id = ? AND discount_amount > 0
        `, [userId]);
      }

      // 构建统一下单参数
      const params = {
        appid: WX_PAY_CONFIG.appId,
        mchid: WX_PAY_CONFIG.mchId,
        description: body,
        out_trade_no: out_trade_no,
        notify_url: WX_PAY_CONFIG.notifyUrl,
        amount: {
          total: actualTotalFee,
          currency: 'CNY'
        },
        scene_info: {
          payer_client_ip: WX_PAY_CONFIG.spbillCreateIp
        },
        payer: {
          openid: openid
        }
      };

      // 生成签名所需的参数
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const nonceStr = generateNonceStr();
      const method = 'POST';
      const url = '/v3/pay/transactions/jsapi';
      const bodyStr = JSON.stringify(params);

      // 生成签名
      const signature = generateSignV3(method, url, timestamp, nonceStr, bodyStr);

      // 发送请求到微信支付
      const response = await axios.post('https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi', params, {
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
          'User-Agent': 'axios/1.9.0'
        }
      });

      if (response.status === 200) {
        await connection.commit();
        res.json({
          success: true,
          data: response.data
        });
      } else {
        await connection.rollback();
        res.status(400).json({
          success: false,
          error: '统一下单失败',
          detail: response.data
        });
      }
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('统一下单失败:', error);
    res.status(500).json({ 
      error: '统一下单失败',
      detail: error.message
    });
  }
});

// 支付回调接口
app.post('/api/wx/pay/notify', async (req, res) => {
  try {
    // 获取回调数据
    const {
      id, // 通知ID
      create_time, // 通知创建时间
      event_type, // 通知类型
      resource_type, // 通知数据类型
      resource, // 通知数据
      summary // 回调摘要
    } = req.body;

    // 验证签名
    const timestamp = req.headers['wechatpay-timestamp'];
    const nonce = req.headers['wechatpay-nonce'];
    const signature = req.headers['wechatpay-signature'];
    const serial = req.headers['wechatpay-serial'];

    if (!verifySignV3(timestamp, nonce, JSON.stringify(req.body), signature)) {
      return res.status(401).json({
        code: 'FAIL',
        message: '签名验证失败'
      });
    }

    // 解密回调数据
    const decryptedData = decryptCallbackData(
      resource.associated_data,
      resource.nonce,
      resource.ciphertext
    );

    const callbackData = JSON.parse(decryptedData);

    // 处理支付结果
    if (callbackData.trade_state === 'SUCCESS') {
      const { 
        out_trade_no, // 商户订单号
        transaction_id, // 微信支付订单号
        trade_type, // 交易类型
        trade_state, // 交易状态
        trade_state_desc, // 交易状态描述
        success_time, // 支付完成时间
        amount // 订单金额
      } = callbackData;

      // 开始事务
      const connection = await db.getConnection();
      await connection.beginTransaction();

      try {
        // 更新订单状态
        await connection.query(
          `UPDATE orders SET 
            transaction_id = ?,
            trade_type = ?,
            trade_state = ?,
            trade_state_desc = ?,
            success_time = ?
          WHERE out_trade_no = ?`,
          [transaction_id, trade_type, trade_state, trade_state_desc, success_time, out_trade_no]
        );

        // 获取订单项
        const [orderItems] = await connection.query(
          'SELECT * FROM order_items WHERE order_id = (SELECT id FROM orders WHERE out_trade_no = ?)',
          [out_trade_no]
        );

        // 更新商品库存
        for (const item of orderItems) {
          await connection.query(
            'UPDATE rights SET remaining_count = remaining_count - ? WHERE id = ?',
            [item.quantity, item.right_id]
          );
        }

        await connection.commit();
        res.json({
          code: 'SUCCESS',
          message: 'OK'
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
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
});

// 关闭订单接口
app.post('/api/wx/pay/close', async (req, res) => {
  try {
    const { out_trade_no } = req.body;

    if (!out_trade_no) {
      return res.status(400).json({ error: '缺少商户订单号' });
    }

    // 构建请求参数
    const params = {
      mchid: WX_PAY_CONFIG.mchId
    };

    // 生成签名所需的参数
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = generateNonceStr();
    const method = 'POST';
    const url = `/v3/pay/transactions/out-trade-no/${out_trade_no}/close`;
    const bodyStr = JSON.stringify(params);

    // 生成签名
    const signature = generateSignV3(method, url, timestamp, nonceStr, bodyStr);

    // 发送请求到微信支付
    const response = await axios.post(
      `https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/${out_trade_no}/close`,
      params,
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
          'User-Agent': 'axios/1.9.0'
        }
      }
    );

    if (response.status === 204) {
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
    if (error.response) {
      res.status(error.response.status).json({
        success: false,
        error: error.response.data.message || '关闭订单失败'
      });
    } else {
      res.status(500).json({
        success: false,
        error: '关闭订单失败'
      });
    }
  }
});

// 申请退款接口
app.post('/api/wx/pay/refund', async (req, res) => {
  try {
    const { 
      transaction_id, // 微信支付订单号
      out_trade_no,  // 商户订单号
      out_refund_no, // 商户退款单号
      reason,        // 退款原因
      notify_url,    // 退款结果回调url
      funds_account, // 退款资金来源
      amount         // 金额信息
    } = req.body;

    // 参数验证
    if (!out_refund_no || !amount || !amount.refund || !amount.total || !amount.currency) {
      return res.status(400).json({ error: '参数不完整' });
    }

    // 开始事务
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 创建退款申请记录
      const [refundResult] = await connection.query(
        `INSERT INTO refund_requests (
          out_trade_no,
      out_refund_no,
          transaction_id,
      reason,
          amount,
          status,
          created_at
        ) VALUES (?, ?, ?, ?, ?, 'PENDING', NOW())`,
        [
          out_trade_no,
          out_refund_no,
          transaction_id,
          reason,
          JSON.stringify(amount)
        ]
      );

      await connection.commit();
      
      res.json({
        success: true,
        data: {
          refund_id: refundResult.insertId,
          status: 'PENDING',
          message: '退款申请已提交，等待审批'
        }
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('申请退款失败:', error);
    res.status(500).json({
      success: false,
      error: '申请退款失败',
      detail: error.message
    });
  }
});

// 审批退款接口
app.post('/api/wx/pay/refund/approve', async (req, res) => {
  try {
    const { refund_id, approve, reject_reason } = req.body;

    if (!refund_id) {
      return res.status(400).json({ error: '缺少退款ID' });
    }

    // 开始事务
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 获取退款申请信息
      const [refunds] = await connection.query(
        'SELECT * FROM refund_requests WHERE id = ? AND status = "PENDING"',
        [refund_id]
      );

      if (!refunds || refunds.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: '退款申请不存在或已处理' });
      }

      const refund = refunds[0];

      if (approve) {
        // 更新退款申请状态为已批准
        await connection.query(
          'UPDATE refund_requests SET status = "APPROVED", approved_at = NOW() WHERE id = ?',
          [refund_id]
        );

        // 确保amount是有效的JSON字符串
        let amountData;
        try {
          amountData = typeof refund.amount === 'string' ? JSON.parse(refund.amount) : refund.amount;
        } catch (error) {
          console.error('解析退款金额失败:', error);
          await connection.rollback();
          return res.status(500).json({
            success: false,
            error: '处理退款申请失败',
            detail: '退款金额数据格式错误'
          });
        }

        // 构建请求参数
        const params = {
          out_refund_no: refund.out_refund_no,
          reason: refund.reason,
          notify_url: WX_PAY_CONFIG.notifyUrl + '/refund',
          funds_account: 'AVAILABLE',
          amount: amountData
    };

    // 添加微信支付订单号或商户订单号
        if (refund.transaction_id) {
          params.transaction_id = refund.transaction_id;
        } else if (refund.out_trade_no) {
          params.out_trade_no = refund.out_trade_no;
    }

    // 生成签名
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = generateNonceStr();
    const signature = generateSignV3(
      'POST',
      '/v3/refund/domestic/refunds',
      timestamp,
      nonceStr,
      JSON.stringify(params)
    );

    // 发送请求到微信支付
    const response = await axios.post(
      'https://api.mch.weixin.qq.com/v3/refund/domestic/refunds',
      params,
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
              'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
              'User-Agent': 'axios/1.9.0'
        }
      }
    );

    if (response.status === 200) {
          // 更新退款申请状态为处理中
          await connection.query(
            'UPDATE refund_requests SET status = "PROCESSING", wx_refund_id = ? WHERE id = ?',
            [response.data.refund_id, refund_id]
          );

          await connection.commit();
      res.json({
        success: true,
            data: {
              status: 'PROCESSING',
              message: '退款申请已批准，正在处理中'
            }
      });
    } else {
          await connection.rollback();
      res.status(400).json({
        success: false,
            error: '退款申请处理失败'
          });
        }
      } else {
        // 拒绝退款申请
        if (!reject_reason) {
          await connection.rollback();
          return res.status(400).json({ error: '拒绝退款必须提供原因' });
        }

        await connection.query(
          'UPDATE refund_requests SET status = "REJECTED", reject_reason = ?, rejected_at = NOW() WHERE id = ?',
          [reject_reason, refund_id]
        );

        await connection.commit();
        res.json({
          success: true,
          data: {
            status: 'REJECTED',
            message: '退款申请已拒绝'
          }
      });
    }
  } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('处理退款申请失败:', error);
    res.status(500).json({
        success: false,
      error: '处理退款申请失败',
      detail: error.message
    });
  }
});

// 获取退款申请列表
app.get('/api/wx/pay/refund/requests', async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    
    const offset = (page - 1) * limit;
    
    // 构建查询条件
    let query = 'SELECT * FROM refund_requests';
    let countQuery = 'SELECT COUNT(*) as total FROM refund_requests';
    let params = [];
    
    if (status) {
      query += ' WHERE status = ?';
      countQuery += ' WHERE status = ?';
      params.push(status);
    }
    
    // 添加排序和分页
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);
    
    // 执行查询
    const [refunds] = await db.query(query, params);
    const [[{ total }]] = await db.query(countQuery, status ? [status] : []);
    
    // 确保amount字段是有效的JSON字符串
    const formattedRefunds = refunds.map(refund => ({
      ...refund,
      amount: typeof refund.amount === 'string' ? refund.amount : JSON.stringify(refund.amount)
    }));
    
    res.json({
      success: true,
      data: formattedRefunds,
      total: parseInt(total),
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (error) {
    console.error('获取退款申请列表失败:', error);
      res.status(500).json({
        success: false,
      error: '获取退款申请列表失败'
      });
    }
});

// 获取退款申请详情
app.get('/api/wx/pay/refund/requests/:id', async (req, res) => {
  try {
    const [refunds] = await db.query(
      'SELECT * FROM refund_requests WHERE id = ?',
      [req.params.id]
    );
    
    if (!refunds || refunds.length === 0) {
      return res.status(404).json({ error: '退款申请不存在' });
    }
    
    res.json({
      success: true,
      data: refunds[0]
    });
  } catch (error) {
    console.error('获取退款申请详情失败:', error);
    res.status(500).json({
      success: false,
      error: '获取退款申请详情失败'
    });
  }
});

// 退款回调接口
app.post('/api/wx/pay/refund/notify', async (req, res) => {
  try {
    // 获取回调数据
    const {
      id, // 通知ID
      create_time, // 通知创建时间
      event_type, // 通知类型
      resource_type, // 通知数据类型
      resource, // 通知数据
      summary // 回调摘要
    } = req.body;

    // 验证签名
    const timestamp = req.headers['wechatpay-timestamp'];
    const nonce = req.headers['wechatpay-nonce'];
    const signature = req.headers['wechatpay-signature'];
    const serial = req.headers['wechatpay-serial'];

    if (!verifySignV3(timestamp, nonce, JSON.stringify(req.body), signature)) {
      return res.status(401).json({
        code: 'FAIL',
        message: '签名验证失败'
      });
    }

    // 解密回调数据
    const decryptedData = decryptCallbackData(
      resource.associated_data,
      resource.nonce,
      resource.ciphertext
    );

    const callbackData = JSON.parse(decryptedData);

    // 处理退款结果
    if (callbackData.refund_status === 'SUCCESS') {
      const { 
        out_refund_no, // 商户退款单号
        out_trade_no, // 商户订单号
        refund_id, // 微信退款单号
        refund_status, // 退款状态
        success_time, // 退款成功时间
        amount // 金额信息
      } = callbackData;

      // TODO: 更新订单状态
      // 这里需要根据你的业务逻辑来处理退款状态更新
      // 例如：更新数据库中的订单状态为已退款

      res.json({
        code: 'SUCCESS',
        message: 'OK'
      });
    } else {
      res.json({
        code: 'FAIL',
        message: callbackData.refund_status || '退款失败'
      });
    }
  } catch (error) {
    console.error('退款回调处理失败:', error);
    res.status(500).json({
      code: 'FAIL',
      message: '处理失败'
    });
  }
});

// 小程序调起支付签名接口
app.post('/api/wx/pay/sign', async (req, res) => {
  try {
    const { prepay_id } = req.body;

    if (!prepay_id) {
      return res.status(400).json({ error: '缺少prepay_id' });
    }

    // 构建签名参数
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = generateNonceStr();
    const package = `prepay_id=${prepay_id}`;
    
    // 构建签名串
    const signStr = `${WX_PAY_CONFIG.appId}\n${timestamp}\n${nonceStr}\n${package}\n`;
    
    // 生成签名
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signStr);
    const signature = sign.sign(WX_PAY_CONFIG.privateKey, 'base64');

    // 返回支付参数
    res.json({
      timeStamp: timestamp,
      nonceStr: nonceStr,
      package: package,
      signType: 'RSA',
      paySign: signature
    });
  } catch (error) {
    console.error('生成支付签名失败:', error);
    res.status(500).json({ error: '生成支付签名失败' });
  }
});

// 查询订单详情接口
app.get('/api/wx/pay/query', async (req, res) => {
  try {
    const { out_trade_no } = req.query;

    if (!out_trade_no) {
      return res.status(400).json({ error: '缺少商户订单号' });
    }

    // 生成签名所需的参数
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = generateNonceStr();
    const method = 'GET';
    const url = `/v3/pay/transactions/out-trade-no/${out_trade_no}`;

    // 生成签名
    const signature = generateSignV3(method, url, timestamp, nonceStr, '');

    // 发送请求到微信支付
    const response = await axios.get(
      `https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/${out_trade_no}`,
      {
        headers: {
          'Accept': 'application/json',
          'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
          'User-Agent': 'axios/1.9.0'
        }
      }
    );

    if (response.status === 200) {
      // 同时查询数据库中的订单信息
      const [orders] = await db.query(
        'SELECT * FROM orders WHERE out_trade_no = ?',
        [out_trade_no]
      );

      if (orders.length === 0) {
        return res.status(404).json({ error: '订单不存在' });
      }

      const order = orders[0];

      // 查询订单项
      const [orderItems] = await db.query(
        `SELECT oi.*, r.title, r.price, r.original_price, r.description, r.status, r.remaining_count
         FROM order_items oi
         JOIN rights r ON oi.right_id = r.id
         WHERE oi.order_id = ?`,
        [order.id]
      );

      // 查询订单图片
      const orderItemsWithImages = await Promise.all(orderItems.map(async (item) => {
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

      res.json({
        success: true,
        data: {
          ...response.data,
          order_info: {
            ...order,
            items: orderItemsWithImages
          }
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: '查询订单失败',
        detail: response.data
      });
    }
  } catch (error) {
    console.error('查询订单失败:', error);
    if (error.response) {
      res.status(error.response.status).json({
        success: false,
        error: '查询订单失败',
        detail: error.response.data
      });
    } else {
      res.status(500).json({
        success: false,
        error: '查询订单失败',
        detail: error.message
      });
    }
  }
});

// 根据用户ID查询订单列表接口
app.get('/api/wx/pay/orders', async (req, res) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: '缺少用户ID' });
    }

    // 查询用户是否存在
    const [users] = await db.query(
      'SELECT * FROM wx_users WHERE id = ?',
      [user_id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // 查询用户的订单列表
    const [orders] = await db.query(
      'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
      [user_id]
    );

    // 查询每个订单的订单项
    const ordersWithItems = await Promise.all(orders.map(async (order) => {
      // 查询订单项
      const [orderItems] = await db.query(
        `SELECT oi.*, r.title, r.price, r.original_price, r.description, r.status, r.remaining_count
         FROM order_items oi
         JOIN rights r ON oi.right_id = r.id
         WHERE oi.order_id = ?`,
        [order.id]
      );

      // 查询订单项图片
      const orderItemsWithImages = await Promise.all(orderItems.map(async (item) => {
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

      // 查询微信支付订单状态
      try {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const nonceStr = generateNonceStr();
        const method = 'GET';
        const url = `/v3/pay/transactions/out-trade-no/${order.out_trade_no}?mchid=${WX_PAY_CONFIG.mchId}`;
        const body = '';
        const signature = generateSignV3(method, url, timestamp, nonceStr, body);

        const response = await axios.get(
          `https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/${order.out_trade_no}?mchid=${WX_PAY_CONFIG.mchId}`,
          {
            headers: {
              'Accept': 'application/json',
              'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
              'User-Agent': 'axios/1.9.0'
            }
          }
        );

        const wxPayData = response.data;
        return {
          ...order,
          items: orderItemsWithImages,
          pay_status: {
            trade_state: wxPayData.trade_state || 'UNKNOWN',
            trade_state_desc: wxPayData.trade_state_desc || '未知状态',
            success_time: wxPayData.success_time || null,
            amount: wxPayData.amount ? {
              total: wxPayData.amount.total,
              currency: wxPayData.amount.currency
            } : null,
            transaction_id: wxPayData.transaction_id || null
          }
        };
      } catch (error) {
        console.error('查询微信支付状态失败:', error.response?.data || error.message);
        // 如果查询微信支付状态失败，返回数据库中的订单信息
        return {
          ...order,
          items: orderItemsWithImages,
          pay_status: {
            trade_state: order.trade_state || 'UNKNOWN',
            trade_state_desc: order.trade_state_desc || '支付状态查询失败',
            success_time: order.success_time || null,
            amount: order.total_fee ? {
              total: order.total_fee,
              currency: 'CNY'
            } : null,
            transaction_id: order.transaction_id || null
          }
        };
      }
    }));

    res.json({
      success: true,
      data: ordersWithItems
    });
  } catch (error) {
    console.error('查询订单列表失败:', error);
    res.status(500).json({
      success: false,
      error: '查询订单列表失败',
      detail: error.message
    });
  }
});

// 记录数字身份购买
app.post('/api/digital-identity/purchase', async (req, res) => {
  try {
    const { user_id, digital_artwork_id, discount_amount } = req.body;

    if (!user_id || !digital_artwork_id || !discount_amount) {
      return res.status(400).json({ error: '参数不完整' });
    }

    // 开始事务
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 检查用户是否存在
      const [users] = await connection.query(
        'SELECT id FROM wx_users WHERE id = ?',
        [user_id]
      );

      if (!users || users.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: '用户不存在' });
      }

      // 检查数字艺术品是否存在
      const [artworks] = await connection.query(
        'SELECT id FROM digital_artworks WHERE id = ?',
        [digital_artwork_id]
      );

      if (!artworks || artworks.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: '数字艺术品不存在' });
      }

      // 记录购买
      await connection.query(
        'INSERT INTO digital_identity_purchases (user_id, digital_artwork_id, discount_amount) VALUES (?, ?, ?)',
        [user_id, digital_artwork_id, discount_amount]
      );

      await connection.commit();
      res.json({ message: '购买记录创建成功' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('记录数字身份购买失败:', error);
    res.status(500).json({ error: '记录数字身份购买失败' });
  }
});

// 获取用户的数字身份购买记录
app.get('/api/digital-identity/purchases/:user_id', async (req, res) => {
  try {
    const [purchases] = await db.query(`
      SELECT 
        dip.*,
        da.title as artwork_title,
        da.image_url as artwork_image
      FROM digital_identity_purchases dip
      JOIN digital_artworks da ON dip.digital_artwork_id = da.id
      WHERE dip.user_id = ?
      ORDER BY dip.purchase_date DESC
    `, [req.params.user_id]);

    res.json(purchases);
  } catch (error) {
    console.error('获取数字身份购买记录失败:', error);
    res.status(500).json({ error: '获取数字身份购买记录失败' });
  }
});

// 获取商家列表接口
app.get('/api/merchants', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search = '',
      status = 'active',
      sort_by = 'created_at',
      sort_order = 'DESC'
    } = req.query;

    const offset = (page - 1) * limit;
    
    // 构建查询条件
    let whereClause = 'WHERE 1=1';
    const params = [];
    
    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }
    
    if (search) {
      whereClause += ' AND (name LIKE ? OR description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    // 验证排序字段
    const allowedSortFields = ['created_at', 'sort_order', 'name'];
    const sortField = allowedSortFields.includes(sort_by) ? sort_by : 'created_at';
    const orderDirection = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // 查询总数
    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM merchants ${whereClause}`,
      params
    );
    const total = countResult[0].total;

    // 查询商家列表
    const [merchants] = await db.query(
      `SELECT * FROM merchants 
       ${whereClause}
       ORDER BY ${sortField} ${orderDirection}
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // 查询每个商家的图片
    for (const merchant of merchants) {
      const [images] = await db.query(
        'SELECT image_url FROM merchant_images WHERE merchant_id = ?',
        [merchant.id]
      );
      merchant.images = images.map(img => 
        img.image_url.startsWith('http') ? img.image_url : `${BASE_URL}${img.image_url}`
      );
    }

    // 处理logo URL
    const merchantsWithFullUrls = merchants.map(merchant => ({
      ...merchant,
      logo: merchant.logo ? (merchant.logo.startsWith('http') ? merchant.logo : `${BASE_URL}${merchant.logo}`) : ''
    }));

    res.json({
      success: true,
      data: merchantsWithFullUrls,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('获取商家列表失败:', error);
    res.status(500).json({ 
      success: false,
      error: '获取商家列表失败' 
    });
  }
});

// 获取商家详情接口
app.get('/api/merchants/:id', async (req, res) => {
  try {
    // 获取商家基本信息
    const [merchants] = await db.query(
      'SELECT * FROM merchants WHERE id = ? AND status = "active"',
      [req.params.id]
    );

    if (!merchants || merchants.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: '商家不存在' 
      });
    }

    const merchant = merchants[0];

    // 获取商家图片
    const [images] = await db.query(
      'SELECT image_url FROM merchant_images WHERE merchant_id = ?',
      [req.params.id]
    );

    // 处理图片URL
    const merchantWithFullUrls = {
      ...merchant,
      logo: merchant.logo ? (merchant.logo.startsWith('http') ? merchant.logo : `${BASE_URL}${merchant.logo}`) : '',
      images: images.map(img => 
        img.image_url.startsWith('http') ? img.image_url : `${BASE_URL}${img.image_url}`
      )
    };

    res.json({
      success: true,
      data: merchantWithFullUrls
    });
  } catch (error) {
    console.error('获取商家详情失败:', error);
    res.status(500).json({ 
      success: false,
      error: '获取商家详情失败' 
    });
  }
});

// 商家Logo上传接口
app.post('/api/merchants/upload-logo', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '没有上传文件' });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    const fullUrl = `${BASE_URL}${fileUrl}`;
    res.json({ 
      url: fileUrl,
      fullUrl: fullUrl,
      filename: req.file.filename,
      size: req.file.size
    });
  } catch (error) {
    console.error('商家Logo上传失败:', error);
    res.status(500).json({ error: '商家Logo上传失败' });
  }
});

// 商家图片上传接口
app.post('/api/merchants/upload-images', upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '没有上传文件' });
    }
    const files = req.files.map(file => ({
      url: `/uploads/${file.filename}`,
      fullUrl: `${BASE_URL}/uploads/${file.filename}`,
      filename: file.filename,
      size: file.size
    }));
    res.json(files);
  } catch (error) {
    console.error('商家图片上传失败:', error);
    res.status(500).json({ error: '商家图片上传失败' });
  }
});

// 创建商家接口
app.post('/api/merchants', auth.authenticateToken, async (req, res) => {
  try {
    const { name, logo, description, address, phone, images } = req.body;
    
    // 验证logo URL
    if (!validateImageUrl(logo)) {
      return res.status(400).json({ error: '无效的Logo URL' });
    }

    // 开始事务
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 插入商家基本信息
      const [result] = await connection.query(
        'INSERT INTO merchants (name, logo, description, address, phone, status) VALUES (?, ?, ?, ?, ?, "active")',
        [name, logo, description, address, phone]
      );

      const merchantId = result.insertId;

      // 插入商家图片
      if (images && images.length > 0) {
        const imageValues = images.map(image => [merchantId, image]);
        await connection.query(
          'INSERT INTO merchant_images (merchant_id, image_url) VALUES ?',
          [imageValues]
        );
      }

      await connection.commit();

      // 返回完整的商家信息
      const [newMerchant] = await db.query(
        'SELECT * FROM merchants WHERE id = ?',
        [merchantId]
      );

      res.json({
        success: true,
        data: newMerchant[0]
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('创建商家失败:', error);
    res.status(500).json({ 
      success: false,
      error: '创建商家失败' 
    });
  }
});

// 更新商家接口
app.put('/api/merchants/:id', auth.authenticateToken, async (req, res) => {
  try {
    const { name, logo, description, address, phone, images } = req.body;
    
    // 验证logo URL
    if (!validateImageUrl(logo)) {
      return res.status(400).json({ error: '无效的Logo URL' });
    }

    // 开始事务
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 更新商家基本信息
      await connection.query(
        'UPDATE merchants SET name = ?, logo = ?, description = ?, address = ?, phone = ? WHERE id = ?',
        [name, logo, description, address, phone, req.params.id]
      );

      // 删除旧图片
      await connection.query('DELETE FROM merchant_images WHERE merchant_id = ?', [req.params.id]);

      // 插入新图片
      if (images && images.length > 0) {
        const imageValues = images.map(image => [req.params.id, image]);
        await connection.query(
          'INSERT INTO merchant_images (merchant_id, image_url) VALUES ?',
          [imageValues]
        );
      }

      await connection.commit();

      // 返回更新后的商家信息
      const [updatedMerchant] = await db.query(
        'SELECT * FROM merchants WHERE id = ?',
        [req.params.id]
      );

      res.json({
        success: true,
        data: updatedMerchant[0]
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('更新商家失败:', error);
    res.status(500).json({ 
      success: false,
      error: '更新商家失败' 
    });
  }
});

// 删除商家接口
app.delete('/api/merchants/:id', auth.authenticateToken, async (req, res) => {
  try {
    // 开始事务
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 删除商家图片
      await connection.query('DELETE FROM merchant_images WHERE merchant_id = ?', [req.params.id]);
      
      // 删除商家
      await connection.query('DELETE FROM merchants WHERE id = ?', [req.params.id]);

      await connection.commit();
      res.json({
        success: true,
        message: '删除成功'
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('删除商家失败:', error);
    res.status(500).json({ 
      success: false,
      error: '删除商家失败' 
    });
  }
});

// 更新商家状态接口
app.patch('/api/merchants/:id/status', auth.authenticateToken, async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ 
        success: false,
        error: '无效的状态值' 
      });
    }

    await db.query(
      'UPDATE merchants SET status = ? WHERE id = ?',
      [status, req.params.id]
    );

    res.json({
      success: true,
      message: '状态更新成功'
    });
  } catch (error) {
    console.error('更新商家状态失败:', error);
    res.status(500).json({ 
      success: false,
      error: '更新商家状态失败' 
    });
  }
});

// 更新商家排序接口
app.patch('/api/merchants/:id/sort', auth.authenticateToken, async (req, res) => {
  try {
    const { sort_order } = req.body;
    
    if (typeof sort_order !== 'number') {
      return res.status(400).json({ 
        success: false,
        error: '无效的排序值' 
      });
    }

    await db.query(
      'UPDATE merchants SET sort_order = ? WHERE id = ?',
      [sort_order, req.params.id]
    );

    res.json({
      success: true,
      message: '排序更新成功'
    });
  } catch (error) {
    console.error('更新商家排序失败:', error);
    res.status(500).json({ 
      success: false,
      error: '更新商家排序失败' 
    });
  }
});

// Token验证中间件
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: '未提供token' });
  }
  const token = authHeader.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, 'your_jwt_secret');
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'token无效' });
  }
};

// 添加收藏
app.post('/api/favorites', authenticateToken, async (req, res) => {
  const { itemId, itemType } = req.body;
  if (!itemId || !itemType) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  // 验证收藏类型
  const validTypes = ['artwork', 'digital_art', 'copyright_item'];
  if (!validTypes.includes(itemType)) {
    return res.status(400).json({ error: '无效的收藏类型' });
  }

  try {
    const userId = req.user.userId;
    // 检查是否已经收藏
    const checkSql = 'SELECT * FROM favorites WHERE user_id = ? AND item_id = ? AND item_type = ?';
    const [existing] = await db.query(checkSql, [userId, itemId, itemType]);
    
    if (existing) {
      return res.status(400).json({ error: '已经收藏过该物品' });
    }

    const sql = 'INSERT INTO favorites (user_id, item_id, item_type) VALUES (?, ?, ?)';
    await db.query(sql, [userId, itemId, itemType]);
    res.json({ success: true });
  } catch (err) {
    console.error('添加收藏失败:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 取消收藏
app.delete('/api/favorites/:itemType/:itemId', authenticateToken, async (req, res) => {
  const { itemId, itemType } = req.params;
  const userId = req.user.userId;

  try {
    const sql = 'DELETE FROM favorites WHERE user_id = ? AND item_id = ? AND item_type = ?';
    const result = await db.query(sql, [userId, itemId, itemType]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '未找到该收藏记录' });
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('取消收藏失败:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取收藏列表
app.get('/api/favorites', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { page = 1, pageSize = 10, itemType } = req.query;

  try {
    const offset = (page - 1) * pageSize;
    let sql = '';
    let params = [];
    
    if (itemType) {
      // 获取特定类型的收藏
      sql = `
        SELECT f.*, 
          CASE f.item_type
            WHEN 'artwork' THEN oa.title
            WHEN 'digital_art' THEN da.title
            WHEN 'copyright_item' THEN r.title
          END as title,
          CASE f.item_type
            WHEN 'artwork' THEN oa.image_url
            WHEN 'digital_art' THEN da.image_url
            WHEN 'copyright_item' THEN ri.image_url
          END as image_url,
          f.created_at as favorite_time
        FROM favorites f
        LEFT JOIN original_artworks oa ON f.item_type = 'artwork' AND f.item_id = oa.id
        LEFT JOIN digital_artworks da ON f.item_type = 'digital_art' AND f.item_id = da.id
        LEFT JOIN rights r ON f.item_type = 'copyright_item' AND f.item_id = r.id
        LEFT JOIN right_images ri ON f.item_type = 'copyright_item' AND f.item_id = r.id AND ri.right_id = r.id
        WHERE f.user_id = ? AND f.item_type = ?
        ORDER BY f.created_at DESC
        LIMIT ? OFFSET ?
      `;
      params = [userId, itemType, parseInt(pageSize), offset];
    } else {
      // 获取所有类型的收藏
      sql = `
        SELECT f.*, 
          CASE f.item_type
            WHEN 'artwork' THEN oa.title
            WHEN 'digital_art' THEN da.title
            WHEN 'copyright_item' THEN r.title
          END as title,
          CASE f.item_type
            WHEN 'artwork' THEN oa.image_url
            WHEN 'digital_art' THEN da.image_url
            WHEN 'copyright_item' THEN ri.image_url
          END as image_url,
          f.created_at as favorite_time
        FROM favorites f
        LEFT JOIN original_artworks oa ON f.item_type = 'artwork' AND f.item_id = oa.id
        LEFT JOIN digital_artworks da ON f.item_type = 'digital_art' AND f.item_id = da.id
        LEFT JOIN rights r ON f.item_type = 'copyright_item' AND f.item_id = r.id
        LEFT JOIN right_images ri ON f.item_type = 'copyright_item' AND f.item_id = r.id AND ri.right_id = r.id
        WHERE f.user_id = ?
        ORDER BY f.created_at DESC
        LIMIT ? OFFSET ?
      `;
      params = [userId, parseInt(pageSize), offset];
    }
    
    const [favorites] = await db.query(sql, params);
    
    // 获取总数
    let countSql = 'SELECT COUNT(*) as total FROM favorites WHERE user_id = ?';
    let countParams = [userId];
    if (itemType) {
      countSql += ' AND item_type = ?';
      countParams.push(itemType);
    }
    const [countResult] = await db.query(countSql, countParams);
    
    res.json({
      success: true,
      data: favorites,
      pagination: {
        total: countResult[0].total,
        page: parseInt(page),
        pageSize: parseInt(pageSize)
      }
    });
  } catch (err) {
    console.error('获取收藏列表失败:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 启动HTTPS服务器
const PORT = process.env.PORT || 2000;
https.createServer(sslOptions, app).listen(PORT, () => {
  console.log(`HTTPS服务器运行在端口 ${PORT}`);
}); 

