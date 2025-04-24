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
    const [artists] = await db.query('SELECT * FROM artists');
    // 为每个艺术家的图片添加完整URL
    const artistsWithFullUrls = artists.map(artist => ({
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
    const { name, era, avatar, banner, description, biography } = req.body;
    
    // 验证图片URL
    if (avatar && !validateImageUrl(avatar)) {
      return res.status(400).json({ error: '无效的头像URL' });
    }
    if (banner && !validateImageUrl(banner)) {
      return res.status(400).json({ error: '无效的背景图URL' });
    }

    // 更新艺术家信息
    await db.query(
      'UPDATE artists SET name = ?, era = ?, avatar = ?, banner = ?, description = ?, biography = ? WHERE id = ?',
      [name, era, avatar, banner, description, biography, req.params.id]
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
    // 为每个作品的图片添加完整URL
    const artworksWithFullUrls = artworks.map(artwork => ({
      ...artwork,
      image: artwork.image ? (artwork.image.startsWith('http') ? artwork.image : `${BASE_URL}${artwork.image}`) : ''
    }));
    res.json(artworksWithFullUrls);
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
    // 为每个分类的图片添加完整URL
    const categoriesWithFullUrls = categories.map(category => ({
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
    const [artwork] = await db.query(`
      SELECT 
        oa.*,
        a.name as artist_name,
        a.avatar as artist_avatar,
        a.description as artist_description
      FROM original_artworks oa
      LEFT JOIN artists a ON oa.artist_id = a.id
      WHERE oa.id = ?
    `, [req.params.id]);

    if (!artwork) {
      return res.status(404).json({ error: '作品不存在' });
    }

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
    const [artist] = await db.query('SELECT * FROM artists WHERE id = ?', [req.params.id]);
    
    if (!artist) {
      return res.status(404).json({ error: '艺术家不存在' });
    }

    const [achievements] = await db.query(
      'SELECT * FROM artist_achievements WHERE artist_id = ?',
      [req.params.id]
    );

    const [artworks] = await db.query(
      'SELECT id, title, image FROM original_artworks WHERE artist_id = ?',
      [req.params.id]
    );

    res.json({
      name: artist.name,
      avatar: artist.avatar,
      banner: artist.banner,
      era: artist.era,
      description: artist.description,
      biography: artist.biography,
      artworks: artworks,
      achievements: achievements
    });
  } catch (error) {
    console.error('获取艺术家详情失败:', error);
    res.status(500).json({ error: '获取艺术家详情失败' });
  }
});

// 获取版权实物列表
app.get('/api/rights', async (req, res) => {
  try {
    const [rights] = await db.query(`
      SELECT r.*, GROUP_CONCAT(ri.image_url) as images
      FROM rights r
      LEFT JOIN right_images ri ON r.id = ri.right_id
      GROUP BY r.id
    `);
    
    // 为每个版权实物的图片添加完整URL
    const rightsWithFullUrls = rights.map(right => ({
      ...right,
      images: right.images ? right.images.split(',').map(image => 
        image.startsWith('http') ? image : `${BASE_URL}${image}`
      ) : []
    }));
    
    res.json(rightsWithFullUrls);
  } catch (error) {
    console.error('获取版权实物列表失败:', error);
    res.status(500).json({ error: '获取版权实物列表失败' });
  }
});

// 创建版权实物
app.post('/api/rights', async (req, res) => {
  try {
    const { title, status, price, originalPrice, period, totalCount, remainingCount, description, images } = req.body;
    
    // 开始事务
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 插入版权实物基本信息
      const [result] = await connection.query(
        'INSERT INTO rights (title, status, price, original_price, period, total_count, remaining_count, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [title, status, price, originalPrice, period, totalCount, remainingCount, description]
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
        SELECT r.*, GROUP_CONCAT(ri.image_url) as images
        FROM rights r
        LEFT JOIN right_images ri ON r.id = ri.right_id
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

// 更新版权实物
app.put('/api/rights/:id', async (req, res) => {
  try {
    const { title, status, price, originalPrice, period, totalCount, remainingCount, description, images } = req.body;
    
    // 开始事务
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 更新版权实物基本信息
      await connection.query(
        'UPDATE rights SET title = ?, status = ?, price = ?, original_price = ?, period = ?, total_count = ?, remaining_count = ?, description = ? WHERE id = ?',
        [title, status, price, originalPrice, period, totalCount, remainingCount, description, req.params.id]
      );

      // 删除旧图片
      await connection.query('DELETE FROM right_images WHERE right_id = ?', [req.params.id]);

      // 插入新图片
      if (images && images.length > 0) {
        const imageValues = images.map(image => [req.params.id, image]);
        await connection.query(
          'INSERT INTO right_images (right_id, image_url) VALUES ?',
          [imageValues]
        );
      }

      await connection.commit();
      
      // 返回更新后的版权实物信息
      const [updatedRight] = await db.query(`
        SELECT r.*, GROUP_CONCAT(ri.image_url) as images
        FROM rights r
        LEFT JOIN right_images ri ON r.id = ri.right_id
        WHERE r.id = ?
        GROUP BY r.id
      `, [req.params.id]);

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

// 获取版权实物详情
app.get('/api/rights/detail/:id', async (req, res) => {
  try {
    const [right] = await db.query('SELECT * FROM rights WHERE id = ?', [req.params.id]);
    
    if (!right) {
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

    res.json({
      title: right.title,
      price: right.price,
      originalPrice: right.original_price,
      description: right.description,
      status: right.status,
      period: right.period,
      remainingCount: right.remaining_count,
      totalCount: right.total_count,
      images: images.map(img => img.image_url),
      details: details,
      rules: rules
    });
  } catch (error) {
    console.error('获取版权实物详情失败:', error);
    res.status(500).json({ error: '获取版权实物详情失败' });
  }
});

// 启动服务器
app.listen(port, () => {
  console.log(`服务器运行在 http://192.168.0.80:${port}`);
}); 