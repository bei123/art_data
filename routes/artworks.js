const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../auth');
const { processObjectImages } = require('../utils/image');
const redisClient = require('../utils/redisClient');
const REDIS_ARTWORKS_LIST_KEY = 'artworks:list';
const REDIS_ARTWORKS_LIST_KEY_PREFIX = 'artworks:list:artist:';
const REDIS_ARTWORK_DETAIL_KEY_PREFIX = 'artworks:detail:';

// 性能监控
const performanceMetrics = {
  queryTimes: [],
  cacheHitRate: 0,
  totalRequests: 0
};

// 获取艺术品列表（公开接口）- 性能优化版本
router.get('/', async (req, res) => {
  const startTime = Date.now();
  performanceMetrics.totalRequests++;
  
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

    // 优化缓存键设计
    const cacheKey = artist_id 
      ? `${REDIS_ARTWORKS_LIST_KEY_PREFIX}${artist_id}:${pageNum}:${sizeNum}`
      : `${REDIS_ARTWORKS_LIST_KEY}:${pageNum}:${sizeNum}`;

    // 先查redis缓存
    try {
      const cache = await redisClient.get(cacheKey);
      if (cache) {
        performanceMetrics.cacheHitRate = (performanceMetrics.cacheHitRate * (performanceMetrics.totalRequests - 1) + 1) / performanceMetrics.totalRequests;
        console.log(`缓存命中: ${cacheKey}, 响应时间: ${Date.now() - startTime}ms`);
        return res.json(JSON.parse(cache));
      }
    } catch (cacheError) {
      console.warn('Redis缓存查询失败，继续数据库查询:', cacheError.message);
    }

    // 优化SQL查询 - 使用子查询避免重复JOIN
    const queryStartTime = Date.now();
    let sql = `
      SELECT 
        oa.id, oa.title, oa.year, oa.image, oa.price, oa.is_on_sale, oa.stock, oa.sales, oa.created_at,
        a.id as artist_id, a.name as artist_name, a.avatar as artist_avatar
      FROM original_artworks oa 
      LEFT JOIN artists a ON oa.artist_id = a.id
    `;
    const params = [];

    if (artist_id) {
      sql += ' WHERE oa.artist_id = ?';
      params.push(parseInt(artist_id));
    }

    sql += ' ORDER BY oa.created_at DESC LIMIT ? OFFSET ?';
    params.push(sizeNum, offset);

    const [rows] = await db.query(sql, params);
    const queryTime = Date.now() - queryStartTime;
    performanceMetrics.queryTimes.push(queryTime);
    
    console.log(`数据库查询耗时: ${queryTime}ms, SQL: ${sql.substring(0, 100)}...`);

    if (!rows || !Array.isArray(rows)) {
      return res.json({
        data: [],
        pagination: {
          page: pageNum,
          pageSize: sizeNum,
          total: 0
        }
      });
    }

    // 优化总数查询 - 使用缓存或估算
    let total;
    const totalCacheKey = artist_id 
      ? `${REDIS_ARTWORKS_LIST_KEY_PREFIX}${artist_id}:total`
      : `${REDIS_ARTWORKS_LIST_KEY}:total`;
    
    try {
      const totalCache = await redisClient.get(totalCacheKey);
      if (totalCache) {
        total = parseInt(totalCache);
      } else {
        // 只在缓存未命中时查询总数
        let countSql = `
          SELECT COUNT(*) as total
          FROM original_artworks oa 
          LEFT JOIN artists a ON oa.artist_id = a.id
        `;
        const countParams = [];
        
        if (artist_id) {
          countSql += ' WHERE oa.artist_id = ?';
          countParams.push(parseInt(artist_id));
        }
        
        const [countRows] = await db.query(countSql, countParams);
        total = countRows[0].total;
        
        // 缓存总数，5分钟过期
        await redisClient.setEx(totalCacheKey, 300, total.toString());
      }
    } catch (countError) {
      console.warn('总数查询失败，使用估算:', countError.message);
      // 使用估算值，避免阻塞
      total = rows.length === sizeNum ? (pageNum + 1) * sizeNum : pageNum * sizeNum;
    }

    // 异步处理图片URL，不阻塞响应
    const processImagesAsync = async () => {
      try {
        const artworksWithFullUrls = rows.map(artwork => {
          const processedArtwork = processObjectImages(artwork, ['image', 'avatar']);
          return {
            ...processedArtwork,
            artist: {
              id: artwork.artist_id,
              name: artwork.artist_name,
              avatar: processedArtwork.artist_avatar || ''
            },
            collection: {
              location: artwork.collection_location,
              number: artwork.collection_number,
              size: artwork.collection_size,
              material: artwork.collection_material
            }
          };
        });

        const result = {
          data: artworksWithFullUrls,
          pagination: {
            page: pageNum,
            pageSize: sizeNum,
            total: total
          }
        };

        // 异步写入缓存，不阻塞响应
        try {
          await redisClient.setEx(cacheKey, 1800, JSON.stringify(result)); // 30分钟过期
        } catch (cacheWriteError) {
          console.warn('缓存写入失败:', cacheWriteError.message);
        }
      } catch (processError) {
        console.error('图片处理失败:', processError);
      }
    };

    // 立即返回结果，异步处理图片和缓存
    const immediateResult = {
      data: rows.map(artwork => ({
        ...artwork,
        artist: {
          id: artwork.artist_id,
          name: artwork.artist_name,
          avatar: artwork.artist_avatar || ''
        },
        collection: {
          location: artwork.collection_location,
          number: artwork.collection_number,
          size: artwork.collection_size,
          material: artwork.collection_material
        }
      })),
      pagination: {
        page: pageNum,
        pageSize: sizeNum,
        total: total
      }
    };

    // 异步处理图片URL
    processImagesAsync();

    const totalTime = Date.now() - startTime;
    console.log(`API响应时间: ${totalTime}ms, 缓存命中率: ${(performanceMetrics.cacheHitRate * 100).toFixed(2)}%`);
    
    res.json(immediateResult);
  } catch (error) {
    console.error('获取艺术品列表失败:', error);
    res.status(500).json({ error: '获取艺术品列表服务暂时不可用' });
  }
});

// 获取艺术品详情（公开接口）
router.get('/:id', async (req, res) => {
  try {
    // 验证ID参数
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: '无效的作品ID' });
    }
    
    // 先查redis缓存
    const cache = await redisClient.get(REDIS_ARTWORK_DETAIL_KEY_PREFIX + id);
    if (cache) {
      return res.json(JSON.parse(cache));
    }

    const [rows] = await db.query(`
      SELECT 
        oa.*,
        a.id as artist_id,
        a.name as artist_name,
        a.avatar as artist_avatar,
        a.description as artist_description
      FROM original_artworks oa
      LEFT JOIN artists a ON oa.artist_id = a.id
      WHERE oa.id = ?
    `, [id]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: '作品不存在' });
    }

    const artwork = processObjectImages(rows[0], ['image', 'avatar']);

    const collection = {
      location: artwork.collection_location,
      number: artwork.collection_number,
      size: artwork.collection_size,
      material: artwork.collection_material
    };

    const artist = {
      id: artwork.artist_id,
      name: artwork.artist_name,
      avatar: artwork.artist_avatar,
      description: artwork.artist_description
    };

    const result = {
      id: artwork.id,
      title: artwork.title,
      year: artwork.year,
      image: artwork.image,
      description: artwork.description,
      long_description: artwork.long_description,
      background: artwork.background,
      features: artwork.features,
      collection: collection,
      artist: artist,
      price: artwork.price,
      stock: artwork.stock,
      discount_price: artwork.discount_price,
      original_price: artwork.original_price,
      sales: artwork.sales,
      is_on_sale: artwork.is_on_sale
    };
    res.json(result);
    // 写入redis缓存，7天过期
    await redisClient.setEx(REDIS_ARTWORK_DETAIL_KEY_PREFIX + id, 604800, JSON.stringify(result));
  } catch (error) {
    console.error('获取作品详情失败:', error);
    res.status(500).json({ error: '获取作品详情服务暂时不可用' });
  }
});

// 创建艺术品（需要认证）
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      title,
      image,
      artist_id,
      artist_name,
      year,
      description,
      long_description,
      background,
      features,
      collection_location,
      collection_number,
      collection_size,
      collection_material,
      price,
    } = req.body;

    let finalArtistId = artist_id;
    // 如果没有artist_id，兼容老前端用artist_name查找或新建
    if (!finalArtistId && artist_name) {
      const [existingArtists] = await db.query('SELECT id FROM artists WHERE name = ?', [artist_name]);
      if (existingArtists.length > 0) {
        finalArtistId = existingArtists[0].id;
      } else {
        const [artistResult] = await db.query(
          'INSERT INTO artists (name) VALUES (?)',
          [artist_name]
        );
        finalArtistId = artistResult.insertId;
      }
    }
    if (!finalArtistId) {
      return res.status(400).json({ error: '缺少有效的艺术家ID' });
    }
    // 验证图片URL
    if (!validateImageUrl(image)) {
      return res.status(400).json({ error: '无效的图片URL' });
    }
    // 创建艺术品
    const [result] = await db.query(
      `INSERT INTO original_artworks (
        title, image, artist_id, year, description, long_description,
        background, features, collection_location, 
        collection_number, collection_size, collection_material, price, original_price, discount_price
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title, image, finalArtistId, year, description, long_description,
        background, features, collection_location,
        collection_number, collection_size, collection_material, price, req.body.original_price, req.body.discount_price
      ]
    );

    // 查询艺术家信息
    const [artistRows] = await db.query('SELECT id, name FROM artists WHERE id = ?', [finalArtistId]);
    const artist = artistRows[0] || {};
    // 清理所有artworks:list相关缓存（包括分页）
    const listKeys = await redisClient.keys('artworks:list*');
    if (listKeys.length > 0) {
      await redisClient.del(listKeys);
    }
    res.json({
      id: result.insertId,
      title,
      price,
      image,
      year,
      description,
      long_description,
      background,
      features,
      collection: {
        location: collection_location,
        number: collection_number,
        size: collection_size,
        material: collection_material
      },
      artist: {
        id: artist.id,
        name: artist.name
      }
    });
  } catch (error) {
    console.error('Error creating original artwork:', error);
    res.status(500).json({ error: '创建失败' });
  }
});

// 更新艺术品（需要认证）
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const {
      title,
      image,
      artist_id,
      artist_name,
      year,
      description,
      long_description,
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
      is_on_sale,
      price
    } = req.body;
    let finalArtistId = artist_id;
    // 如果没有artist_id，兼容老前端用artist_name查找或新建
    if (!finalArtistId && artist_name) {
      const [existingArtists] = await db.query('SELECT id FROM artists WHERE name = ?', [artist_name]);
      if (existingArtists.length > 0) {
        finalArtistId = existingArtists[0].id;
      } else {
        const [artistResult] = await db.query(
          'INSERT INTO artists (name) VALUES (?)',
          [artist_name]
        );
        finalArtistId = artistResult.insertId;
      }
    }
    if (!finalArtistId) {
      return res.status(400).json({ error: '缺少有效的艺术家ID' });
    }
    // 更新艺术品
    await db.query(
      `UPDATE original_artworks SET 
        title = ?, 
        image = ?, 
        artist_id = ?,
        year = ?,
        description = ?,
        long_description = ?,
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
        title, image, finalArtistId, year, description, long_description,
        background, features, collection_location,
        collection_number, collection_size, collection_material,
        original_price, discount_price, stock, sales, is_on_sale,
        req.params.id
      ]
    );

    // 查询艺术家信息
    const [artistRows] = await db.query('SELECT id, name FROM artists WHERE id = ?', [finalArtistId]);
    const artist = artistRows[0] || {};
    // 清理所有artworks:list相关缓存（包括分页）
    const listKeys = await redisClient.keys('artworks:list*');
    if (listKeys.length > 0) {
      await redisClient.del(listKeys);
    }
    await redisClient.del(REDIS_ARTWORK_DETAIL_KEY_PREFIX + req.params.id);
    res.json({
      id: parseInt(req.params.id),
      title,
      price,
      image,
      year,
      description,
      long_description,
      background,
      features,
      collection: {
        location: collection_location,
        number: collection_number,
        size: collection_size,
        material: collection_material
      },
      artist: {
        id: artist.id,
        name: artist.name
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

// 删除艺术品（需要认证）
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    // 先查artist_id
    const [rows] = await db.query('SELECT artist_id FROM original_artworks WHERE id = ?', [req.params.id]);
    await db.query('DELETE FROM original_artworks WHERE id = ?', [req.params.id]);
    // 清理所有artworks:list相关缓存（包括分页）
    const listKeys = await redisClient.keys('artworks:list*');
    if (listKeys.length > 0) {
      await redisClient.del(listKeys);
    }
    // 精准清理对应artist_id的缓存
    if (rows && rows.length > 0 && rows[0].artist_id) {
      await redisClient.del(REDIS_ARTWORKS_LIST_KEY_PREFIX + rows[0].artist_id);
    }
    await redisClient.del(REDIS_ARTWORK_DETAIL_KEY_PREFIX + req.params.id);
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('Error deleting original artwork:', error);
    res.status(500).json({ error: '删除失败' });
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

// 性能监控端点
router.get('/performance/metrics', async (req, res) => {
  try {
    const redisMetrics = redisClient.getMetrics ? redisClient.getMetrics() : {};
    const dbMetrics = db.getPoolStatus ? db.getPoolStatus() : {};
    
    // 计算API性能统计
    const avgQueryTime = performanceMetrics.queryTimes.length > 0 
      ? performanceMetrics.queryTimes.reduce((a, b) => a + b, 0) / performanceMetrics.queryTimes.length 
      : 0;
    
    const maxQueryTime = Math.max(...performanceMetrics.queryTimes, 0);
    const slowQueries = performanceMetrics.queryTimes.filter(time => time > 1000).length;
    
    const metrics = {
      api: {
        totalRequests: performanceMetrics.totalRequests,
        cacheHitRate: (performanceMetrics.cacheHitRate * 100).toFixed(2) + '%',
        averageQueryTime: avgQueryTime.toFixed(2) + 'ms',
        maxQueryTime: maxQueryTime + 'ms',
        slowQueries: slowQueries,
        slowQueryRate: performanceMetrics.queryTimes.length > 0 
          ? ((slowQueries / performanceMetrics.queryTimes.length) * 100).toFixed(2) + '%'
          : '0%'
      },
      redis: redisMetrics,
      database: dbMetrics,
      timestamp: new Date().toISOString()
    };
    
    res.json(metrics);
  } catch (error) {
    console.error('获取性能指标失败:', error);
    res.status(500).json({ error: '获取性能指标失败' });
  }
});

// 清理缓存端点
router.post('/performance/clear-cache', authenticateToken, async (req, res) => {
  try {
    const { type = 'all' } = req.body;
    
    let clearedKeys = 0;
    
    if (type === 'all' || type === 'list') {
      const listKeys = await redisClient.keys('artworks:list*');
      if (listKeys.length > 0) {
        await redisClient.del(listKeys);
        clearedKeys += listKeys.length;
      }
    }
    
    if (type === 'all' || type === 'detail') {
      const detailKeys = await redisClient.keys('artworks:detail*');
      if (detailKeys.length > 0) {
        await redisClient.del(detailKeys);
        clearedKeys += detailKeys.length;
      }
    }
    
    res.json({ 
      message: '缓存清理成功', 
      clearedKeys: clearedKeys,
      type: type 
    });
  } catch (error) {
    console.error('清理缓存失败:', error);
    res.status(500).json({ error: '清理缓存失败' });
  }
});

// 重置性能统计
router.post('/performance/reset', authenticateToken, async (req, res) => {
  try {
    performanceMetrics.queryTimes = [];
    performanceMetrics.cacheHitRate = 0;
    performanceMetrics.totalRequests = 0;
    
    res.json({ message: '性能统计已重置' });
  } catch (error) {
    console.error('重置性能统计失败:', error);
    res.status(500).json({ error: '重置性能统计失败' });
  }
});

module.exports = router; 