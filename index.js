const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const db = require('./db');

const app = express();
const port = 3000;

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
app.post('/upload', upload.single('file'), (req, res) => {
  res.json({ url: `/uploads/${req.file.filename}` });
});

// 艺术家相关接口
app.get('/artists', async (req, res) => {
  try {
    const [artists] = await db.query('SELECT * FROM artists');
    res.json(artists);
  } catch (error) {
    console.error('Error fetching artists:', error);
    res.status(500).json({ error: '获取数据失败' });
  }
});

app.post('/artists', async (req, res) => {
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

// 原作艺术品相关接口
app.get('/original-artworks', async (req, res) => {
  try {
    const [artworks] = await db.query(`
      SELECT oa.*, a.avatar, a.name as artist_name, a.description as artist_description
      FROM original_artworks oa
      JOIN artists a ON oa.artist_id = a.id
    `);
    const formattedArtworks = artworks.map(artwork => ({
      id: artwork.id,
      title: artwork.title,
      image: artwork.image,
      artist: {
        id: artwork.artist_id,
        avatar: artwork.avatar,
        name: artwork.artist_name,
        description: artwork.artist_description
      }
    }));
    res.json(formattedArtworks);
  } catch (error) {
    console.error('Error fetching original artworks:', error);
    res.status(500).json({ error: '获取数据失败' });
  }
});

app.post('/original-artworks', async (req, res) => {
  try {
    const { title, image, artist_id } = req.body;
    const [result] = await db.query(
      'INSERT INTO original_artworks (title, image, artist_id) VALUES (?, ?, ?)',
      [title, image, artist_id]
    );
    res.json({ id: result.insertId, ...req.body });
  } catch (error) {
    console.error('Error creating original artwork:', error);
    res.status(500).json({ error: '创建失败' });
  }
});

app.put('/original-artworks/:id', async (req, res) => {
  try {
    const { title, image, artist_id } = req.body;
    await db.query(
      'UPDATE original_artworks SET title = ?, image = ?, artist_id = ? WHERE id = ?',
      [title, image, artist_id, req.params.id]
    );
    res.json({ id: req.params.id, ...req.body });
  } catch (error) {
    console.error('Error updating original artwork:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

app.delete('/original-artworks/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM original_artworks WHERE id = ?', [req.params.id]);
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('Error deleting original artwork:', error);
    res.status(500).json({ error: '删除失败' });
  }
});

// 数字艺术品相关接口
app.get('/digital-artworks', async (req, res) => {
  try {
    const [artworks] = await db.query('SELECT * FROM digital_artworks');
    res.json(artworks);
  } catch (error) {
    console.error('Error fetching digital artworks:', error);
    res.status(500).json({ error: '获取数据失败' });
  }
});

app.post('/digital-artworks', async (req, res) => {
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

app.put('/digital-artworks/:id', async (req, res) => {
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

app.delete('/digital-artworks/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM digital_artworks WHERE id = ?', [req.params.id]);
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('Error deleting digital artwork:', error);
    res.status(500).json({ error: '删除失败' });
  }
});

// 实物分类相关接口
app.get('/physical-categories', async (req, res) => {
  try {
    const [categories] = await db.query('SELECT * FROM physical_categories');
    res.json(categories);
  } catch (error) {
    console.error('Error fetching physical categories:', error);
    res.status(500).json({ error: '获取数据失败' });
  }
});

app.post('/physical-categories', async (req, res) => {
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

app.put('/physical-categories/:id', async (req, res) => {
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

app.delete('/physical-categories/:id', async (req, res) => {
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