const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../db');
const { authenticateToken } = require('../auth');
const { processObjectImages } = require('../utils/image');
const redisClient = require('../utils/redisClient');

// 外部API配置
const EXTERNAL_API_CONFIG = {
  VERIFICATION_CODE_BASE_URL: 'https://node.wespace.cn'
};
const REDIS_DIGITAL_ARTWORKS_LIST_KEY = 'digital_artworks:list';
const REDIS_DIGITAL_ARTWORKS_LIST_KEY_PREFIX = 'digital_artworks:list:artist:';
const REDIS_DIGITAL_ARTWORK_DETAIL_KEY_PREFIX = 'digital_artworks:detail:';

// 数据库健康检查端点
router.get('/health', async (req, res) => {
  try {
    const poolStatus = db.getPoolStatus();
    const healthCheck = await db.checkPoolHealth();

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: {
        poolStatus,
        healthCheck
      }
    });
  } catch (error) {
    console.error('健康检查失败:', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

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

/**
 * 获取授权信息的辅助函数
 */
function getAuthorization(req) {
  // 优先使用请求头中的 authorization（可能是 Bearer token 或 Basic 认证）
  let authorization = req.headers.authorization || req.headers.Authorization;
  
  // 如果没有提供，尝试从专门的请求头获取
  if (!authorization) {
    authorization = req.headers['x-external-authorization'] || 
                   req.headers['X-External-Authorization'];
  }
  
  // 如果还是没有，使用环境变量或默认值（Basic 认证）
  if (!authorization) {
    authorization = process.env.VERIFICATION_CODE_AUTHORIZATION || 
                   'Basic d2VzcGFjZTp3ZXNwYWNlLXNlY3JldA==';
  }
  
  return authorization;
}

/**
 * 从外部数据中解析 issueInfo
 */
function parseIssueInfo(issueInfoStr) {
  if (!issueInfoStr) return null;
  try {
    return typeof issueInfoStr === 'string' ? JSON.parse(issueInfoStr) : issueInfoStr;
  } catch (e) {
    console.error('解析 issueInfo 失败:', e);
    return null;
  }
}

// 获取数字艺术品列表（管理员接口，包含隐藏作品）
router.get('/admin', authenticateToken, async (req, res) => {
  try {
    const { artist_id, page = 1, pageSize = 20 } = req.query;
    const pageNum = parseInt(page) > 0 ? parseInt(page) : 1;
    const sizeNum = parseInt(pageSize) > 0 ? parseInt(pageSize) : 20;
    const offset = (pageNum - 1) * sizeNum;

    let query = `
      SELECT 
        da.id, da.title, da.image_url, da.description, da.price, da.created_at, da.is_hidden,
        a.id as artist_id, a.name as artist_name, a.avatar as artist_avatar
      FROM digital_artworks da
      LEFT JOIN artists a ON da.artist_id = a.id
    `;

    const queryParams = [];

    // 如果提供了 artist_id 参数，添加筛选条件
    if (artist_id) {
      query += ` WHERE da.artist_id = ?`;
      queryParams.push(artist_id);
    }

    query += ` ORDER BY da.created_at DESC LIMIT ? OFFSET ?`;
    queryParams.push(sizeNum, offset);

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

    // 检查是否是连接池问题
    if (error.message === 'Pool is closed.' || error.message.includes('Pool is closed')) {
      return res.status(503).json({
        error: '数据库连接暂时不可用，请稍后重试',
        code: 'DB_POOL_CLOSED'
      });
    }

    res.status(500).json({ error: '获取数字艺术品列表失败' });
  }
});

// 获取数字艺术品列表（公开接口，支持融合外部数据）
router.get('/', async (req, res) => {
  try {
    const { artist_id, page = 1, pageSize = 20, usn, fuse = 'true' } = req.query;
    const pageNum = parseInt(page) > 0 ? parseInt(page) : 1;
    const sizeNum = parseInt(pageSize) > 0 ? parseInt(pageSize) : 20;
    const offset = (pageNum - 1) * sizeNum;
    const shouldFuse = fuse === 'true' || fuse === true;

    let query = `
      SELECT 
        da.id, da.title, da.image_url, da.description, da.price, da.created_at,
        da.product_name, da.issue_batch, da.batch_quantity,
        a.id as artist_id, a.name as artist_name, a.avatar as artist_avatar
      FROM digital_artworks da
      LEFT JOIN artists a ON da.artist_id = a.id
      WHERE da.is_hidden = 0
    `;

    const queryParams = [];

    // 如果提供了 artist_id 参数，添加筛选条件
    if (artist_id) {
      query += ` AND da.artist_id = ?`;
      queryParams.push(artist_id);
    }

    query += ` ORDER BY da.created_at DESC LIMIT ? OFFSET ?`;
    queryParams.push(sizeNum, offset);

    const [rows] = await db.query(query, queryParams);

    if (!rows || !Array.isArray(rows)) {
      return res.json([]);
    }

    let artworksWithProcessedImages = rows.map(artwork => {
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

    // 如果提供了 usn 且需要融合，尝试从外部API获取产品列表并融合
    if (shouldFuse && usn && typeof usn === 'string' && usn.trim().length > 0) {
      try {
        const authorization = getAuthorization(req);
        
        const productListUrl = `${EXTERNAL_API_CONFIG.VERIFICATION_CODE_BASE_URL}/orderApi/wespace/index/list/V2`;
        const response = await axios.get(productListUrl, {
          params: {
            usn: usn.trim(),
            newsPageSize: 5,
            publicityPageSize: 5,
            activityPageSize: 6
          },
          headers: {
            'pragma': 'no-cache',
            'cache-control': 'no-cache',
            'authorization': authorization,
            'apptype': '16',
            'tenantid': 'wespace',
            'content-type': 'application/x-www-form-urlencoded',
            'origin': 'https://m.wespace.cn',
            'sec-fetch-site': 'same-site',
            'sec-fetch-mode': 'cors',
            'sec-fetch-dest': 'empty',
            'referer': 'https://m.wespace.cn/',
            'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'priority': 'u=1, i'
          },
          timeout: 10000
        });
        
        if (response.data && response.data.code === 200 && response.data.status === true && response.data.data) {
          const externalList = response.data.data.qgList || [];
          
          // 创建两个 Map：一个按 goods_id 索引，一个按名称索引
          const externalMapById = new Map();
          const externalMapByName = new Map();
          
          externalList.forEach(item => {
            if (item.goods_id) {
              externalMapById.set(item.goods_id, item);
            }
            // 按名称建立索引（用于匹配本地数据）
            if (item.name) {
              const nameKey = item.name.trim();
              // 如果同一个名称有多个产品，保留第一个
              if (!externalMapByName.has(nameKey)) {
                externalMapByName.set(nameKey, item);
              }
            }
          });
          
          // 融合外部数据到本地数据
          artworksWithProcessedImages = artworksWithProcessedImages.map(artwork => {
            let matched = null;
            
            // 首先检查 artwork 是否已经有 goods_id（从之前的请求中获取的）
            const existingGoodsId = artwork.goods_id || (artwork.externalData && artwork.externalData.goods_id);
            if (existingGoodsId) {
              matched = externalMapById.get(existingGoodsId);
            }
            
            // 如果 goods_id 匹配失败，通过 title 匹配 name 获取 goods_id
            if (!matched && artwork.title) {
              const titleKey = artwork.title.trim();
              matched = externalMapByName.get(titleKey);
            }
            
            // 如果找到匹配的外部数据，只保留 goods_id
            if (matched && matched.goods_id) {
              return {
                ...artwork,
                goods_id: matched.goods_id // 从外部数据获取 goods_id
              };
            }
            
            // 如果没有匹配到，返回原始数据（不包含 goods_id）
            return artwork;
          });
        }
      } catch (externalError) {
        console.error('获取外部产品列表失败:', externalError);
        // 继续返回本地数据，不中断请求
      }
    }

    res.json(artworksWithProcessedImages);
    // 写入redis缓存，7天过期（如果融合了外部数据，缓存时间可以缩短）
    let cacheKey = REDIS_DIGITAL_ARTWORKS_LIST_KEY + `:page:${pageNum}:size:${sizeNum}`;
    if (artist_id) {
      cacheKey = REDIS_DIGITAL_ARTWORKS_LIST_KEY_PREFIX + artist_id + `:page:${pageNum}:size:${sizeNum}`;
    }
    // 如果融合了外部数据，缓存时间缩短为1小时
    const cacheTTL = shouldFuse && usn ? 3600 : 604800;
    await redisClient.setEx(cacheKey, cacheTTL, JSON.stringify(artworksWithProcessedImages));
  } catch (error) {
    console.error('获取数字艺术品列表失败:', error);

    // 检查是否是连接池问题
    if (error.message === 'Pool is closed.' || error.message.includes('Pool is closed')) {
      return res.status(503).json({
        error: '数据库连接暂时不可用，请稍后重试',
        code: 'DB_POOL_CLOSED'
      });
    }

    res.status(500).json({ error: '获取数字艺术品列表失败' });
  }
});

// 获取数字艺术品详情（公开接口，支持融合外部数据）
router.get('/:id', async (req, res) => {
  try {
    // 验证ID参数
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: '无效的作品ID' });
    }

    const { goodsVerId, usn, fuse = 'true' } = req.query;
    const shouldFuse = fuse === 'true' || fuse === true;

    // 如果不需要融合且没有 goodsVerId，直接使用缓存
    if (!shouldFuse && !goodsVerId) {
      const cache = await redisClient.get(REDIS_DIGITAL_ARTWORK_DETAIL_KEY_PREFIX + id);
      if (cache) {
        return res.json(JSON.parse(cache));
      }
    }

    const [rows] = await db.query(`
      SELECT 
        da.id, da.title, da.image_url, da.description, da.registration_certificate,
        da.license_rights, da.license_period, da.owner_rights, da.license_items,
        da.project_name, da.product_name, da.project_owner, da.issuer, da.issue_batch,
        da.issue_year, da.batch_quantity, da.price, da.created_at, da.updated_at,
        a.id as artist_id, a.name as artist_name, a.avatar as artist_avatar,
        a.description as artist_description
      FROM digital_artworks da
      LEFT JOIN artists a ON da.artist_id = a.id
      WHERE da.id = ?
    `, [id]);

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

    let result = {
      ...artworkData,
      artist: artist
    };

    let obtainedGoodsId = null;
    
    // 如果提供了 usn，尝试从外部产品列表接口获取 goods_id
    if (shouldFuse && usn && typeof usn === 'string' && usn.trim().length > 0) {
      try {
        const authorization = getAuthorization(req);
        
        const productListUrl = `${EXTERNAL_API_CONFIG.VERIFICATION_CODE_BASE_URL}/orderApi/wespace/index/list/V2`;
        const response = await axios.get(productListUrl, {
          params: {
            usn: usn.trim(),
            newsPageSize: 5,
            publicityPageSize: 5,
            activityPageSize: 6
          },
          headers: {
            'pragma': 'no-cache',
            'cache-control': 'no-cache',
            'authorization': authorization,
            'apptype': '16',
            'tenantid': 'wespace',
            'content-type': 'application/x-www-form-urlencoded',
            'origin': 'https://m.wespace.cn',
            'sec-fetch-site': 'same-site',
            'sec-fetch-mode': 'cors',
            'sec-fetch-dest': 'empty',
            'referer': 'https://m.wespace.cn/',
            'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'priority': 'u=1, i'
          },
          timeout: 10000
        });
        
        if (response.data && response.data.code === 200 && response.data.status === true && response.data.data) {
          const externalList = response.data.data.qgList || [];
          
          // 通过 title 匹配 name 获取 goods_id
          if (result.title) {
            const titleKey = result.title.trim();
            const matched = externalList.find(item => item.name && item.name.trim() === titleKey);
            if (matched && matched.goods_id) {
              obtainedGoodsId = matched.goods_id;
              result.goods_id = obtainedGoodsId;
            }
          }
        }
      } catch (externalError) {
        console.error('获取外部产品列表失败（用于获取goods_id）:', externalError);
        // 继续执行，不中断请求
      }
    }

    // 如果获取到了 goods_id，使用它调用商品接口获取 goodsVerId
    let targetGoodsVerId = goodsVerId; // 优先使用手动传入的 goodsVerId
    if (shouldFuse && !targetGoodsVerId && obtainedGoodsId && usn) {
      try {
        // 商品接口需要 Bearer token，优先从请求头获取
        let authorization = req.headers.authorization || req.headers.Authorization;
        
        // 如果没有 Bearer token，尝试其他方式
        if (!authorization || !authorization.startsWith('Bearer ')) {
          authorization = req.headers['x-external-authorization'] || 
                         req.headers['X-External-Authorization'];
        }
        
        // 如果还是没有 Bearer token，尝试从环境变量或使用测试 token
        if (!authorization || !authorization.startsWith('Bearer ')) {
          // 尝试从环境变量获取 Bearer token（用于测试）
          const testToken = process.env.EXTERNAL_BEARER_TOKEN;
          if (testToken) {
            authorization = `Bearer ${testToken}`;
            console.log('使用环境变量中的 Bearer token');
          } else {
            // 临时测试：使用提供的测试 token
            authorization = 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c24iOiI0MWY4ZDY4MzE2NTcxMmFmM2FlYzMzZTFjODQwODk4ZmU0YmRlYzlmNjM3ZWFmNjY0MmQwNzc0ZTJlODFmYjNiIiwiYWNjb3VudF90eXBlIjoiYWRtaW4iLCJ1c2VyX25hbWUiOiI0MWY4ZDY4MzE2NTcxMmFmM2FlYzMzZTFjODQwODk4ZmU0YmRlYzlmNjM3ZWFmNjY0MmQwNzc0ZTJlODFmYjNiIiwic2NvcGUiOlsiYWxsIl0sImlkIjoxODE0NTAsImV4cCI6MTc2NDc2MDU3NiwianRpIjoiYjEzNzI4NTUtNmU0Zi00ZWViLThiYTctMmE5YTkwOGYzMWNmIiwiY2xpZW50X2lkIjoid2VzcGFjZSJ9.ombbQ9GWbtJT-S1qm_FEG1GgkBccvsS8Vk1T26VoIHQo-XDm61jWA3bhdf29nqSOX-cFD_pVKTw8jUhJw8YlrsR0mTw-rpnBYAIlRDI2NVK7M7q6pdBbiBhZYETOhouDUOYCyPIv4CVw68VWULVWbdosktnQtFDi8KK54dnEX3Q';
            console.warn('警告：未从请求头获取到 Bearer token，使用测试 token（仅用于测试）');
          }
        }
        
        // 构建商品接口的请求参数 - goods 作为表单数据传递（application/x-www-form-urlencoded）
        const goodsParam = JSON.stringify({
          goodsId: obtainedGoodsId,
          buyerUsn: usn.trim(),
          issueBatch: "1",
          pageSize: "20",
          currentPage: 1
        });
        
        const goodsListUrl = `${EXTERNAL_API_CONFIG.VERIFICATION_CODE_BASE_URL}/orderApi/goods/ver/list/v3`;
        console.log('调用商品接口获取 goodsVerId，请求参数:', goodsParam);
        console.log('Authorization 类型:', authorization?.startsWith('Bearer ') ? 'Bearer Token' : authorization?.startsWith('Basic ') ? 'Basic Auth' : '未知');
        console.log('Authorization:', authorization ? (authorization.startsWith('Bearer ') ? authorization.substring(0, 30) + '...' : authorization.substring(0, 20) + '...') : '未设置');
        
        // 使用 URLSearchParams 构建表单数据
        const formData = new URLSearchParams();
        formData.append('goods', goodsParam);
        
        const response = await axios.post(
          goodsListUrl,
          formData.toString(), // 作为表单数据传递
          {
            headers: {
              'pragma': 'no-cache',
              'cache-control': 'no-cache',
              'authorization': authorization,
              'apptype': '16',
              'tenantid': 'wespace',
              'content-type': 'application/x-www-form-urlencoded',
              'origin': 'https://m.wespace.cn',
              'sec-fetch-site': 'same-site',
              'sec-fetch-mode': 'cors',
              'sec-fetch-dest': 'empty',
              'referer': 'https://m.wespace.cn/',
              'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
              'priority': 'u=1, i'
            },
            timeout: 10000
          }
        );
        
        console.log('商品接口响应状态:', response.status);
        console.log('商品接口响应数据:', JSON.stringify(response.data).substring(0, 500)); // 只打印前500字符
        
        if (response.data && response.data.code === 200 && response.data.status === true && response.data.data) {
          const goodsList = response.data.data.list || [];
          console.log('商品列表长度:', goodsList.length);
          
          // 获取第一个商品的 goodsVerId
          if (goodsList.length > 0) {
            console.log('第一个商品数据:', JSON.stringify(goodsList[0]).substring(0, 300));
            if (goodsList[0].goodsVerId) {
              targetGoodsVerId = goodsList[0].goodsVerId;
              result.goodsVerId = targetGoodsVerId;
              console.log('成功获取 goodsVerId:', targetGoodsVerId, '来自 goods_id:', obtainedGoodsId);
            } else {
              console.log('第一个商品没有 goodsVerId 字段，可用字段:', Object.keys(goodsList[0]));
            }
          } else {
            console.log('商品列表为空');
          }
        } else {
          console.log('商品接口返回非成功状态，code:', response.data?.code, 'status:', response.data?.status);
        }
      } catch (goodsError) {
        console.error('获取商品列表失败（用于获取goodsVerId）:', goodsError.message);
        if (goodsError.response) {
          console.error('响应状态:', goodsError.response.status);
          console.error('响应数据:', goodsError.response.data);
        }
        // 继续执行，不中断请求
      }
    }

    // 如果手动传入了 goodsVerId，也添加到结果中
    if (targetGoodsVerId && !result.goodsVerId) {
      result.goodsVerId = targetGoodsVerId;
      console.log('使用手动传入的 goodsVerId:', targetGoodsVerId);
    }

    // 调试日志
    if (result.goodsVerId) {
      console.log('返回数据包含 goodsVerId:', result.goodsVerId);
    } else {
      console.log('警告：返回数据中未找到 goodsVerId，targetGoodsVerId:', targetGoodsVerId, 'obtainedGoodsId:', obtainedGoodsId);
    }

    res.json(result);
    
    // 写入redis缓存（如果融合了外部数据，缓存时间缩短为1小时）
    const cacheTTL = shouldFuse && (targetGoodsVerId || obtainedGoodsId) ? 3600 : 604800;
    await redisClient.setEx(REDIS_DIGITAL_ARTWORK_DETAIL_KEY_PREFIX + id, cacheTTL, JSON.stringify(result));
  } catch (error) {
    console.error('获取数字艺术品详情失败:', error);

    // 检查是否是连接池问题
    if (error.message === 'Pool is closed.' || error.message.includes('Pool is closed')) {
      return res.status(503).json({
        error: '数据库连接暂时不可用，请稍后重试',
        code: 'DB_POOL_CLOSED'
      });
    }

    res.status(500).json({ error: '获取数字艺术品详情服务暂时不可用' });
  }
});



// 公共数字艺术品列表接口（无需认证）
router.get('/public', async (req, res) => {
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

    let query = 'SELECT id, title, image_url, description, price, created_at FROM digital_artworks WHERE is_hidden = 0';
    const queryParams = [];

    // 如果提供了 artist_id 参数，添加筛选条件
    if (artist_id) {
      query += ' AND artist_id = ?';
      queryParams.push(parseInt(artist_id));
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    queryParams.push(sizeNum, offset);

    const [rows] = await db.query(query, queryParams);
    const artworksWithFullUrls = rows.map(artwork => ({
      ...artwork,
      image: artwork.image_url || '',
      price: artwork.price || 0
    }));
    res.json(artworksWithFullUrls);
  } catch (error) {
    console.error('Error fetching digital artworks (public):', error);
    res.status(500).json({ error: '获取数字艺术品数据服务暂时不可用' });
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
    // 清理缓存
    await redisClient.del(REDIS_DIGITAL_ARTWORKS_LIST_KEY);
    if (artist_id) {
      await redisClient.del(REDIS_DIGITAL_ARTWORKS_LIST_KEY_PREFIX + artist_id);
    }
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
    // 清理缓存
    await redisClient.del(REDIS_DIGITAL_ARTWORKS_LIST_KEY);
    if (artist_id) {
      await redisClient.del(REDIS_DIGITAL_ARTWORKS_LIST_KEY_PREFIX + artist_id);
    }
    await redisClient.del(REDIS_DIGITAL_ARTWORK_DETAIL_KEY_PREFIX + req.params.id);
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

// 隐藏/显示数字艺术品（需要认证）
router.patch('/:id/hide', authenticateToken, async (req, res) => {
  try {
    const { is_hidden } = req.body;

    // 验证参数
    if (typeof is_hidden !== 'boolean') {
      return res.status(400).json({ error: 'is_hidden 参数必须是布尔值' });
    }

    // 验证ID参数
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: '无效的作品ID' });
    }

    // 先查询artist_id用于清理缓存
    const [artworkRows] = await db.query('SELECT artist_id FROM digital_artworks WHERE id = ?', [id]);
    if (artworkRows.length === 0) {
      return res.status(404).json({ error: '作品不存在' });
    }
    const artistId = artworkRows[0].artist_id;

    // 更新隐藏状态
    await db.query('UPDATE digital_artworks SET is_hidden = ? WHERE id = ?', [is_hidden ? 1 : 0, id]);

    // 清理缓存
    await redisClient.del(REDIS_DIGITAL_ARTWORKS_LIST_KEY);
    if (artistId) {
      await redisClient.del(REDIS_DIGITAL_ARTWORKS_LIST_KEY_PREFIX + artistId);
    }
    await redisClient.del(REDIS_DIGITAL_ARTWORK_DETAIL_KEY_PREFIX + id);

    res.json({
      message: is_hidden ? '作品已隐藏' : '作品已显示',
      is_hidden: is_hidden
    });
  } catch (error) {
    console.error('Error updating artwork visibility:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

// 删除数字艺术品（需要认证）
router.delete('/:id', authenticateToken, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // 先查询artist_id用于清理缓存
    const [artworkRows] = await connection.query('SELECT artist_id FROM digital_artworks WHERE id = ?', [req.params.id]);
    const artistId = artworkRows.length > 0 ? artworkRows[0].artist_id : null;

    // 先删除相关的数字身份购买记录
    await connection.query('DELETE FROM digital_identity_purchases WHERE digital_artwork_id = ?', [req.params.id]);

    // 删除购物车中的相关记录
    await connection.query('DELETE FROM cart_items WHERE digital_artwork_id = ? AND type = "digital"', [req.params.id]);

    // 删除数字艺术品
    await connection.query('DELETE FROM digital_artworks WHERE id = ?', [req.params.id]);

    await connection.commit();
    // 清理缓存
    await redisClient.del(REDIS_DIGITAL_ARTWORKS_LIST_KEY);
    if (artistId) {
      await redisClient.del(REDIS_DIGITAL_ARTWORKS_LIST_KEY_PREFIX + artistId);
    }
    await redisClient.del(REDIS_DIGITAL_ARTWORK_DETAIL_KEY_PREFIX + req.params.id);
    res.json({ message: '删除成功' });
  } catch (error) {
    await connection.rollback();
    console.error('Error deleting digital artwork:', error);
    res.status(500).json({ error: '删除失败' });
  } finally {
    connection.release();
  }
});

/**
 * 获取产品列表
 * GET /api/digital-artworks/order/product-list
 * 转发到外部接口：GET https://node.wespace.cn/orderApi/wespace/index/list/V2
 */
router.get('/order/product-list', async (req, res) => {
  try {
    const { newsPageSize, publicityPageSize, activityPageSize, usn } = req.query;
    
    // 参数验证
    if (!usn || typeof usn !== 'string' || usn.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'usn参数不能为空'
      });
    }

    // 获取 authorization，外部接口统一使用 Basic 认证
    const authorization = getAuthorization(req);

    // 构建请求参数
    const params = {
      usn: usn.trim()
    };

    // 添加可选参数，设置默认值
    if (newsPageSize !== undefined && newsPageSize !== null) {
      params.newsPageSize = parseInt(newsPageSize) || 5;
    } else {
      params.newsPageSize = 5;
    }

    if (publicityPageSize !== undefined && publicityPageSize !== null) {
      params.publicityPageSize = parseInt(publicityPageSize) || 5;
    } else {
      params.publicityPageSize = 5;
    }

    if (activityPageSize !== undefined && activityPageSize !== null) {
      params.activityPageSize = parseInt(activityPageSize) || 6;
    } else {
      params.activityPageSize = 6;
    }

    // 调用外部API获取产品列表
    const productListUrl = `${EXTERNAL_API_CONFIG.VERIFICATION_CODE_BASE_URL}/orderApi/wespace/index/list/V2`;
    console.log('调用外部产品列表接口:', productListUrl);
    console.log('请求参数:', params);
    console.log('Authorization:', authorization ? (authorization.startsWith('Bearer ') ? authorization.substring(0, 30) + '...' : authorization.substring(0, 20) + '...') : '未设置');
    
    const response = await axios.get(
      productListUrl,
      {
        params,
        headers: {
          'pragma': 'no-cache',
          'cache-control': 'no-cache',
          'authorization': authorization,
          'apptype': '16',
          'tenantid': 'wespace',
          'content-type': 'application/x-www-form-urlencoded',
          'origin': 'https://m.wespace.cn',
          'sec-fetch-site': 'same-site',
          'sec-fetch-mode': 'cors',
          'sec-fetch-dest': 'empty',
          'referer': 'https://m.wespace.cn/',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'priority': 'u=1, i'
        },
        timeout: 10000
      }
    );
    
    console.log('外部API响应状态:', response.status);

    // 处理并返回外部API的响应 - 只返回 qgList 中的产品数据
    if (response.data && response.data.code === 200 && response.data.status === true && response.data.data) {
      const originalData = response.data.data;
      const filteredData = {
        code: response.data.code,
        status: response.data.status,
        data: {
          // 只返回 qgList（产品列表）
          qgList: originalData.qgList || []
        }
      };
      console.log('过滤后的产品列表数量:', filteredData.data.qgList.length);
      res.json(filteredData);
    } else {
      // 如果不是成功响应，直接返回原始响应
      res.json(response.data);
    }

  } catch (error) {
    console.error('获取产品列表失败:', error);
    console.error('错误详情:', {
      message: error.message,
      response: error.response ? {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers
      } : null,
      request: error.request ? {
        method: error.config?.method,
        url: error.config?.url,
        params: error.config?.params
      } : null
    });
    
    if (error.response) {
      const statusCode = error.response.status || 500;
      const responseData = error.response.data || {
        code: statusCode,
        status: false,
        message: '获取产品列表失败'
      };
      res.status(statusCode).json(responseData);
    } else if (error.request) {
      res.status(500).json({
        code: 500,
        status: false,
        message: '外部接口连接失败'
      });
    } else {
      res.status(500).json({
        code: 500,
        status: false,
        message: '服务器内部错误'
      });
    }
  }
});

/**
 * 获取商品详情
 * POST /api/digital-artworks/goods/ver/list/v3
 * 转发到外部接口：POST https://node.wespace.cn/orderApi/goods/ver/list/v3
 */
router.post('/goods/ver/list/v3', async (req, res) => {
  try {
    // POST 请求可以从查询参数或请求体中获取 goods 参数
    const goods = req.query?.goods || req.body?.goods;
    
    // 参数验证
    if (!goods || typeof goods !== 'string' || goods.trim().length === 0) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'goods参数不能为空'
      });
    }

    // 获取 authorization，外部接口统一使用 Basic 认证
    const authorization = getAuthorization(req);

    // 构建请求参数 - goods 参数需要作为查询参数传递（URL编码的JSON字符串）
    const params = {
      goods: goods.trim()
    };

    // 调用外部API获取商品详情
    const goodsDetailUrl = `${EXTERNAL_API_CONFIG.VERIFICATION_CODE_BASE_URL}/orderApi/goods/ver/list/v3`;
    console.log('调用外部商品详情接口:', goodsDetailUrl);
    console.log('请求参数:', params);
    console.log('Authorization:', authorization ? (authorization.startsWith('Bearer ') ? authorization.substring(0, 30) + '...' : authorization.substring(0, 20) + '...') : '未设置');
    
    const response = await axios.post(
      goodsDetailUrl,
      null, // POST 请求体为空，参数通过查询字符串传递
      {
        params,
        headers: {
          'pragma': 'no-cache',
          'cache-control': 'no-cache',
          'authorization': authorization,
          'apptype': '16',
          'tenantid': 'wespace',
          'origin': 'https://m.wespace.cn',
          'sec-fetch-site': 'same-site',
          'sec-fetch-mode': 'cors',
          'sec-fetch-dest': 'empty',
          'referer': 'https://m.wespace.cn/',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'priority': 'u=1, i'
        },
        timeout: 10000
      }
    );
    
    console.log('外部API响应状态:', response.status);

    // 直接返回外部API的响应
    res.json(response.data);

  } catch (error) {
    console.error('获取商品详情失败:', error);
    console.error('错误详情:', {
      message: error.message,
      response: error.response ? {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers
      } : null,
      request: error.request ? {
        method: error.config?.method,
        url: error.config?.url,
        params: error.config?.params
      } : null
    });
    
    if (error.response) {
      const statusCode = error.response.status || 500;
      const responseData = error.response.data || {
        code: statusCode,
        status: false,
        message: '获取商品详情失败'
      };
      res.status(statusCode).json(responseData);
    } else if (error.request) {
      res.status(500).json({
        code: 500,
        status: false,
        message: '外部接口连接失败'
      });
    } else {
      res.status(500).json({
        code: 500,
        status: false,
        message: '服务器内部错误'
      });
    }
  }
});

/**
 * 获取商品详情（项目详情）
 * POST /api/digital-artworks/goods/ver/details
 * 转发到外部接口：POST https://node.wespace.cn/orderApi/goods/ver/details
 */
router.post('/goods/ver/details', async (req, res) => {
  try {
    // POST 请求可以从查询参数或请求体中获取 goods 参数
    const goods = req.query?.goods || req.body?.goods;
    
    // 参数验证
    if (!goods) {
      return res.status(400).json({
        code: 400,
        status: false,
        message: 'goods参数不能为空'
      });
    }

    // 如果 goods 是字符串，尝试解析为 JSON
    let goodsData;
    if (typeof goods === 'string') {
      try {
        goodsData = JSON.parse(goods);
      } catch (e) {
        // 如果不是有效的 JSON，直接使用字符串
        goodsData = goods;
      }
    } else {
      goodsData = goods;
    }

    // 获取 authorization，外部接口统一使用 Basic 认证
    const authorization = getAuthorization(req);

    // 调用外部API获取商品详情
    const goodsDetailUrl = `${EXTERNAL_API_CONFIG.VERIFICATION_CODE_BASE_URL}/orderApi/goods/ver/details`;
    console.log('调用外部商品详情接口:', goodsDetailUrl);
    console.log('请求参数:', goodsData);
    console.log('Authorization:', authorization ? (authorization.startsWith('Bearer ') ? authorization.substring(0, 30) + '...' : authorization.substring(0, 20) + '...') : '未设置');
    
    // 根据 goods 的数据类型构建请求数据
    // 如果 goods 是对象，转换为 JSON 字符串作为表单字段发送
    // 如果 goods 是字符串，直接作为表单字段发送
    const requestData = typeof goodsData === 'object' 
      ? { goods: JSON.stringify(goodsData) }
      : { goods: goodsData };
    
    const response = await axios.post(
      goodsDetailUrl,
      requestData,
      {
        headers: {
          'pragma': 'no-cache',
          'cache-control': 'no-cache',
          'authorization': authorization,
          'apptype': '16',
          'tenantid': 'wespace',
          'origin': 'https://m.wespace.cn',
          'sec-fetch-site': 'same-site',
          'sec-fetch-mode': 'cors',
          'sec-fetch-dest': 'empty',
          'referer': 'https://m.wespace.cn/',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'priority': 'u=1, i',
          'content-type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      }
    );
    
    console.log('外部API响应状态:', response.status);

    // 直接返回外部API的响应
    res.json(response.data);

  } catch (error) {
    console.error('获取商品详情失败:', error);
    console.error('错误详情:', {
      message: error.message,
      response: error.response ? {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers
      } : null,
      request: error.request ? {
        method: error.config?.method,
        url: error.config?.url,
        params: error.config?.params,
        data: error.config?.data
      } : null
    });
    
    if (error.response) {
      const statusCode = error.response.status || 500;
      const responseData = error.response.data || {
        code: statusCode,
        status: false,
        message: '获取商品详情失败'
      };
      res.status(statusCode).json(responseData);
    } else if (error.request) {
      res.status(500).json({
        code: 500,
        status: false,
        message: '外部接口连接失败'
      });
    } else {
      res.status(500).json({
        code: 500,
        status: false,
        message: '服务器内部错误'
      });
    }
  }
});

module.exports = router; 