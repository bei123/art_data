const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const db = require('./db');

const app = express();
const port = 3000;

// 添加基础URL配置
const BASE_URL = 'http://192.168.0.80:3000';

// 配置文件上传
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// 配置中间件
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// 创建上传目录
const fs = require('fs');
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// 文件上传接口
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '没有上传文件' });
  }
  const fileUrl = `${BASE_URL}/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

// 艺术家相关接口
app.get('/api/artists', async (req, res) => {
  try {
    const [artists] = await db.query('SELECT * FROM artists');
    res.json(artists);
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

// 验证图片URL的函数
function validateImageUrl(url) {
  if (!url) return false;
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
    const [artworks] = await db.query(`
      SELECT oa.*, a.name as artist_name 
      FROM original_artworks oa 
      LEFT JOIN artists a ON oa.artist_id = a.id
      ORDER BY oa.created_at DESC
    `);
    
    // 为每个图片URL添加BASE_URL
    const artworksWithFullUrls = artworks.map(artwork => ({
      ...artwork,
      image: artwork.image.startsWith('http') ? artwork.image : `${BASE_URL}${artwork.image}`
    }));
    
    res.json(artworksWithFullUrls);
  } catch (error) {
    console.error('获取艺术品列表失败:', error);
    res.status(500).json({ error: '获取艺术品列表失败' });
  }
});

app.post('/api/original-artworks', async (req, res) => {
  try {
    const { title, image, artist_name } = req.body;
    
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
      'INSERT INTO original_artworks (title, image, artist_id) VALUES (?, ?, ?)',
      [title, image, artist_id]
    );
    
    res.json({ 
      id: result.insertId,
      title,
      image,
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
    const { title, image, artist_name } = req.body;
    
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
      'UPDATE original_artworks SET title = ?, image = ?, artist_id = ? WHERE id = ?',
      [title, image, artist_id, req.params.id]
    );
    
    res.json({ 
      id: parseInt(req.params.id),
      title,
      image,
      artist: {
        id: artist_id,
        name: artist_name
      }
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
    const [artworks] = await db.query('SELECT * FROM digital_artworks');
    res.json(artworks);
  } catch (error) {
    console.error('Error fetching digital artworks:', error);
    res.status(500).json({ error: '获取数据失败' });
  }
});

app.post('/api/digital-artworks', async (req, res) => {
  try {
    const { title, image, author, copyright } = req.body;
    const [result] = await db.query(
      'INSERT INTO digital_artworks (title, image, author, copyright) VALUES (?, ?, ?, ?)',
      [title, image, author, copyright]
    );
    res.json({ id: result.insertId, ...req.body });
  } catch (error) {
    console.error('Error creating digital artwork:', error);
    res.status(500).json({ error: '创建失败' });
  }
});

app.put('/api/digital-artworks/:id', async (req, res) => {
  try {
    const { title, image, author, copyright } = req.body;
    await db.query(
      'UPDATE digital_artworks SET title = ?, image = ?, author = ?, copyright = ? WHERE id = ?',
      [title, image, author, copyright, req.params.id]
    );
    res.json({ id: req.params.id, ...req.body });
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
    const [categories] = await db.query('SELECT * FROM physical_categories');
    res.json(categories);
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

// 启动服务器
app.listen(port, () => {
  console.log(`服务器运行在 http://192.168.0.80:${port}`);
}); 