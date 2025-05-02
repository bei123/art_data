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
const wxRouter = require('./routes/wx');
const wxpayRouter = require('./routes/pay');
const favoritesRouter = require('./routes/favorites');

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



// 使用微信路由
app.use('/api/wx', wxRouter);

// 使用微信支付路由
app.use('/api/wx/pay', wxpayRouter);

// 使用收藏路由
app.use('/api/favorites', favoritesRouter);

// 启动HTTPS服务器
const PORT = process.env.PORT || 2000;
https.createServer(sslOptions, app).listen(PORT, () => {
  console.log(`HTTPS服务器运行在端口 ${PORT}`);
}); 

