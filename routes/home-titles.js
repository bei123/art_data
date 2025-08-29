const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../auth');
const redisClient = require('../utils/redisClient');

const REDIS_HOME_TITLES_KEY = 'home:titles';

// 获取首页标题（公开接口）
router.get('/', async (req, res) => {
  try {
    // 先查redis缓存
    const cache = await redisClient.get(REDIS_HOME_TITLES_KEY);
    if (cache) {
      return res.json(JSON.parse(cache));
    }

    // 从数据库获取标题配置
    const [titles] = await db.query(
      'SELECT main_title, sub_title FROM home_titles WHERE id = 1'
    );

    let titleData;
    if (titles.length > 0) {
      titleData = {
        main_title: titles[0].main_title || '可信数字版权生态',
        sub_title: titles[0].sub_title || '数字艺术事业中心'
      };
    } else {
      // 如果没有配置，使用默认值
      titleData = {
        main_title: '可信数字版权生态',
        sub_title: '数字艺术事业中心'
      };
    }

    // 写入redis缓存，设置1小时过期
    try {
      await redisClient.setEx(REDIS_HOME_TITLES_KEY, 3600, JSON.stringify(titleData));
    } catch (redisError) {
      console.error('Redis缓存写入失败:', redisError);
      // Redis错误不影响API响应
    }

    res.json(titleData);
  } catch (error) {
    console.error('获取首页标题失败:', error);
    // 出错时返回默认值
    res.json({
      main_title: '可信数字版权生态',
      sub_title: '数字艺术事业中心'
    });
  }
});

// 更新首页标题（需要认证）
router.put('/', authenticateToken, async (req, res) => {
  try {
    const { main_title, sub_title } = req.body;
    
    // 输入验证
    if (!main_title || typeof main_title !== 'string' || main_title.trim().length === 0) {
      return res.status(400).json({ error: '主标题不能为空' });
    }
    
    if (main_title.length > 20) {
      return res.status(400).json({ error: '主标题长度不能超过20个字符' });
    }
    
    if (!sub_title || typeof sub_title !== 'string' || sub_title.trim().length === 0) {
      return res.status(400).json({ error: '副标题不能为空' });
    }
    
    if (sub_title.length > 30) {
      return res.status(400).json({ error: '副标题长度不能超过30个字符' });
    }

    // 检查是否已存在配置
    const [existing] = await db.query('SELECT id FROM home_titles WHERE id = 1');
    
    if (existing.length > 0) {
      // 更新现有配置
      await db.query(
        'UPDATE home_titles SET main_title = ?, sub_title = ?, updated_at = NOW() WHERE id = 1',
        [main_title.trim(), sub_title.trim()]
      );
    } else {
      // 创建新配置
      await db.query(
        'INSERT INTO home_titles (id, main_title, sub_title, created_at, updated_at) VALUES (1, ?, ?, NOW(), NOW())',
        [main_title.trim(), sub_title.trim()]
      );
    }

    // 清除缓存
    try {
      await redisClient.del(REDIS_HOME_TITLES_KEY);
    } catch (redisError) {
      console.error('Redis缓存清除失败:', redisError);
      // Redis错误不影响API响应
    }

    res.json({ 
      message: '首页标题更新成功',
      data: {
        main_title: main_title.trim(),
        sub_title: sub_title.trim()
      }
    });
  } catch (error) {
    console.error('更新首页标题失败:', error);
    res.status(500).json({ error: '更新首页标题失败' });
  }
});

module.exports = router;
