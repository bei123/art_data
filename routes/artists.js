const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../auth');
const { processObjectImages } = require('../utils/image');
const redisClient = require('../utils/redisClient');
const REDIS_ARTISTS_LIST_KEY = 'artists:list';
const REDIS_ARTIST_DETAIL_KEY_PREFIX = 'artists:detail:';

// 获取艺术家列表（公开接口）
router.get('/', async (req, res) => {
  try {
    // 先查redis缓存
    const cache = await redisClient.get(REDIS_ARTISTS_LIST_KEY);
    if (cache) {
      return res.json(JSON.parse(cache));
    }
    const [rows] = await db.query('SELECT * FROM artists ORDER BY created_at DESC');
    const artistsWithProcessedImages = rows.map(artist => 
      processObjectImages(artist, ['avatar', 'banner'])
    );
    // 写入redis缓存，永久有效
    await redisClient.set(REDIS_ARTISTS_LIST_KEY, JSON.stringify(artistsWithProcessedImages));
    res.json(artistsWithProcessedImages);
  } catch (error) {
    console.error('获取艺术家列表失败:', error);
    res.status(500).json({ error: '获取艺术家列表失败' });
  }
});

// 获取艺术家详情（公开接口）
router.get('/:id', async (req, res) => {
  try {
    // 验证ID参数
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: '无效的艺术家ID' });
    }
    // 先查redis缓存
    const cache = await redisClient.get(REDIS_ARTIST_DETAIL_KEY_PREFIX + id);
    if (cache) {
      return res.json(JSON.parse(cache));
    }
    const [rows] = await db.query('SELECT * FROM artists WHERE id = ?', [id]);
    
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: '艺术家不存在' });
    }
    
    const artist = processObjectImages(rows[0], ['avatar', 'banner']);
    // 写入redis缓存，永久有效
    await redisClient.set(REDIS_ARTIST_DETAIL_KEY_PREFIX + id, JSON.stringify(artist));
    res.json(artist);
  } catch (error) {
    console.error('获取艺术家详情失败:', error);
    res.status(500).json({ error: '获取艺术家详情服务暂时不可用' });
  }
});

// 创建艺术家（需要认证）
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { avatar, name, description } = req.body;
    
    // 输入验证
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: '艺术家名称不能为空' });
    }
    
    if (name.length > 100) {
      return res.status(400).json({ error: '艺术家名称长度不能超过100个字符' });
    }
    
    if (description && description.length > 2000) {
      return res.status(400).json({ error: '描述长度不能超过2000个字符' });
    }
    
    // 清理输入
    const cleanName = name.trim();
    const cleanDescription = description ? description.trim() : '';
    
    const [result] = await db.query(
      'INSERT INTO artists (avatar, name, description) VALUES (?, ?, ?)',
      [avatar, cleanName, cleanDescription]
    );
    // 清理缓存
    await redisClient.del(REDIS_ARTISTS_LIST_KEY);
    res.json({ id: result.insertId, name: cleanName, description: cleanDescription, avatar });
  } catch (error) {
    console.error('Error creating artist:', error);
    res.status(500).json({ error: '创建艺术家服务暂时不可用' });
  }
});

// 更新艺术家（需要认证）
router.put('/:id', authenticateToken, async (req, res) => {
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
    // 清理缓存
    await redisClient.del(REDIS_ARTISTS_LIST_KEY);
    await redisClient.del(REDIS_ARTIST_DETAIL_KEY_PREFIX + req.params.id);

    // 获取更新后的艺术家信息
    const [artists] = await db.query('SELECT * FROM artists WHERE id = ?', [req.params.id]);
    if (artists.length === 0) {
      return res.status(404).json({ error: '艺术家不存在' });
    }

    const artist = artists[0];
    // 处理图片URL
    const artistWithFullUrls = {
      ...artist,
      avatar: artist.avatar || '',
      banner: artist.banner || ''
    };

    res.json(artistWithFullUrls);
  } catch (error) {
    console.error('Error updating artist:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

// 删除艺术家（需要认证）
router.delete('/:id', authenticateToken, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // 先删除与艺术家相关的作品
    await connection.query('DELETE FROM original_artworks WHERE artist_id = ?', [req.params.id]);
    
    // 然后删除艺术家
    await connection.query('DELETE FROM artists WHERE id = ?', [req.params.id]);

    await connection.commit();
    // 清理缓存
    await redisClient.del(REDIS_ARTISTS_LIST_KEY);
    await redisClient.del(REDIS_ARTIST_DETAIL_KEY_PREFIX + req.params.id);
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