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
    const { institution_id } = req.query;
    
    // 如果指定了机构ID，直接查询该机构的艺术家
    if (institution_id) {
      const institutionId = parseInt(institution_id);
      if (isNaN(institutionId) || institutionId <= 0) {
        return res.status(400).json({ error: '无效的机构ID' });
      }
      
      // 检查机构是否存在
      const [institutionRows] = await db.query('SELECT id, name FROM institutions WHERE id = ?', [institutionId]);
      if (institutionRows.length === 0) {
        return res.status(404).json({ error: '机构不存在' });
      }
      
      // 获取该机构下的所有艺术家
      const [rows] = await db.query(`
        SELECT 
          a.*,
          i.id as institution_id,
          i.name as institution_name,
          i.logo as institution_logo,
          i.description as institution_description
        FROM artists a FORCE INDEX (idx_artists_institution_created)
        LEFT JOIN institutions i ON a.institution_id = i.id
        WHERE a.institution_id = ?
        ORDER BY a.created_at DESC
      `, [institutionId]);
      
      const artistsWithProcessedImages = rows.map(artist => {
        const processedArtist = processObjectImages(artist, ['avatar', 'banner']);
        return {
          ...processedArtist,
          institution: artist.institution_id ? {
            id: artist.institution_id,
            name: artist.institution_name,
            logo: artist.institution_logo,
            description: artist.institution_description
          } : null
        };
      });
      
      return res.json({
        institution: {
          id: institutionRows[0].id,
          name: institutionRows[0].name
        },
        artists: artistsWithProcessedImages,
        total: artistsWithProcessedImages.length
      });
    }
    
    // 否则获取所有艺术家
    // 先查redis缓存
    const cache = await redisClient.get(REDIS_ARTISTS_LIST_KEY);
    if (cache) {
      return res.json(JSON.parse(cache));
    }
    
    // 修改查询以包含机构信息
    const [rows] = await db.query(`
      SELECT 
        a.*,
        i.id as institution_id,
        i.name as institution_name,
        i.logo as institution_logo,
        i.description as institution_description
      FROM artists a FORCE INDEX (idx_artists_created_at)
      LEFT JOIN institutions i ON a.institution_id = i.id
      ORDER BY a.created_at DESC
    `);
    
    const artistsWithProcessedImages = rows.map(artist => {
      const processedArtist = processObjectImages(artist, ['avatar', 'banner']);
      return {
        ...processedArtist,
        institution: artist.institution_id ? {
          id: artist.institution_id,
          name: artist.institution_name,
          logo: artist.institution_logo,
          description: artist.institution_description
        } : null
      };
    });
    
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
    
    // 修改查询以包含机构信息
    const [rows] = await db.query(`
      SELECT 
        a.*,
        i.id as institution_id,
        i.name as institution_name,
        i.logo as institution_logo,
        i.description as institution_description
      FROM artists a
      LEFT JOIN institutions i ON a.institution_id = i.id
      WHERE a.id = ?
    `, [id]);
    
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: '艺术家不存在' });
    }
    
    const artist = processObjectImages(rows[0], ['avatar', 'banner']);
    const artistWithInstitution = {
      ...artist,
      institution: artist.institution_id ? {
        id: artist.institution_id,
        name: artist.institution_name,
        logo: artist.institution_logo,
        description: artist.institution_description
      } : null
    };
    
    // 写入redis缓存，永久有效
    await redisClient.set(REDIS_ARTIST_DETAIL_KEY_PREFIX + id, JSON.stringify(artistWithInstitution));
    res.json(artistWithInstitution);
  } catch (error) {
    console.error('获取艺术家详情失败:', error);
    res.status(500).json({ error: '获取艺术家详情服务暂时不可用' });
  }
});

// 创建艺术家（需要认证）
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { avatar, name, description, institution_id } = req.body;
    
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
    
    // 验证机构ID（如果提供）
    if (institution_id) {
      const institutionId = parseInt(institution_id);
      if (isNaN(institutionId) || institutionId <= 0) {
        return res.status(400).json({ error: '无效的机构ID' });
      }
      
      // 检查机构是否存在
      const [institutionRows] = await db.query('SELECT id FROM institutions WHERE id = ?', [institutionId]);
      if (institutionRows.length === 0) {
        return res.status(400).json({ error: '指定的机构不存在' });
      }
    }
    
    // 清理输入
    const cleanName = name.trim();
    const cleanDescription = description ? description.trim() : '';
    
    const [result] = await db.query(
      'INSERT INTO artists (avatar, name, description, institution_id) VALUES (?, ?, ?, ?)',
      [avatar, cleanName, cleanDescription, institution_id || null]
    );
    // 清理缓存
    await redisClient.del(REDIS_ARTISTS_LIST_KEY);
    res.json({ 
      id: result.insertId, 
      name: cleanName, 
      description: cleanDescription, 
      avatar,
      institution_id: institution_id || null
    });
  } catch (error) {
    console.error('Error creating artist:', error);
    res.status(500).json({ error: '创建艺术家服务暂时不可用' });
  }
});

// 更新艺术家（需要认证）
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { name, era, avatar, banner, description, biography, journey, institution_id } = req.body;
    
    // 验证图片URL
    if (avatar && !validateImageUrl(avatar)) {
      return res.status(400).json({ error: '无效的头像URL' });
    }
    if (banner && !validateImageUrl(banner)) {
      return res.status(400).json({ error: '无效的背景图URL' });
    }

    // 验证机构ID（如果提供）
    if (institution_id) {
      const institutionId = parseInt(institution_id);
      if (isNaN(institutionId) || institutionId <= 0) {
        return res.status(400).json({ error: '无效的机构ID' });
      }
      
      // 检查机构是否存在
      const [institutionRows] = await db.query('SELECT id FROM institutions WHERE id = ?', [institutionId]);
      if (institutionRows.length === 0) {
        return res.status(400).json({ error: '指定的机构不存在' });
      }
    }

    // 更新艺术家信息
    await db.query(
      'UPDATE artists SET name = ?, era = ?, avatar = ?, banner = ?, description = ?, biography = ?, journey = ?, institution_id = ? WHERE id = ?',
      [name, era, avatar, banner, description, biography, journey, institution_id || null, req.params.id]
    );
    // 清理缓存
    await redisClient.del(REDIS_ARTISTS_LIST_KEY);
    await redisClient.del(REDIS_ARTIST_DETAIL_KEY_PREFIX + req.params.id);

    // 获取更新后的艺术家信息
    const [artists] = await db.query(`
      SELECT 
        a.*,
        i.id as institution_id,
        i.name as institution_name,
        i.logo as institution_logo,
        i.description as institution_description
      FROM artists a
      LEFT JOIN institutions i ON a.institution_id = i.id
      WHERE a.id = ?
    `, [req.params.id]);
    
    if (artists.length === 0) {
      return res.status(404).json({ error: '艺术家不存在' });
    }

    const artist = artists[0];
    // 处理图片URL
    const artistWithFullUrls = {
      ...artist,
      avatar: artist.avatar || '',
      banner: artist.banner || '',
      institution: artist.institution_id ? {
        id: artist.institution_id,
        name: artist.institution_name,
        logo: artist.institution_logo,
        description: artist.institution_description
      } : null
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