const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../auth');
const { processObjectImages } = require('../utils/image');
const redisClient = require('../utils/redisClient');
const REDIS_RIGHTS_LIST_KEY = 'rights:list';
const REDIS_RIGHT_DETAIL_KEY_PREFIX = 'rights:detail:';

// 获取版权实物列表（需要认证）
router.get('/', async (req, res) => {
    try {
        // 先查redis缓存
        const cache = await redisClient.get(REDIS_RIGHTS_LIST_KEY);
        if (cache) {
            return res.json(JSON.parse(cache));
        }
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
            right.images = images.map(img => img.image_url || '');
        }

        res.json(rows);
        // 写入redis缓存，7天过期
        await redisClient.setEx(REDIS_RIGHTS_LIST_KEY, 604800, JSON.stringify(rows));
    } catch (error) {
        console.error('获取版权实物列表失败:', error);
        res.status(500).json({ error: '获取版权实物列表服务暂时不可用' });
    }
});

// 新增版权实物（需要认证）
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { title, status, price, originalPrice, period, totalCount, remainingCount, description, images, category_id, rich_text } = req.body;
        // 开始事务
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // 插入版权实物基本信息
            const [result] = await connection.query(
                'INSERT INTO rights (title, status, price, original_price, period, total_count, remaining_count, description, category_id, rich_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [title, status, price, originalPrice, period, totalCount, remainingCount, description, category_id, rich_text]
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
            // 清理缓存
            await redisClient.del(REDIS_RIGHTS_LIST_KEY);
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

// 编辑版权实物（需要认证）
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { title, status, price, originalPrice, period, totalCount, remainingCount, description, images, category_id, rich_text } = req.body;
        // 开始事务
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // 更新版权实物基本信息
            await connection.query(
                'UPDATE rights SET title = ?, status = ?, price = ?, original_price = ?, period = ?, total_count = ?, remaining_count = ?, description = ?, category_id = ?, rich_text = ? WHERE id = ?',
                [title, status, price, originalPrice, period, totalCount, remainingCount, description, category_id, rich_text, req.params.id]
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
            updatedRight[0].images = rightImages.map(img => img.image_url || '');

            res.json(updatedRight[0]);
            // 清理缓存
            await redisClient.del(REDIS_RIGHTS_LIST_KEY);
            await redisClient.del(REDIS_RIGHT_DETAIL_KEY_PREFIX + req.params.id);
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

// 删除版权实物（需要认证）
router.delete('/:id', authenticateToken, async (req, res) => {
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
            // 清理缓存
            await redisClient.del(REDIS_RIGHTS_LIST_KEY);
            await redisClient.del(REDIS_RIGHT_DETAIL_KEY_PREFIX + req.params.id);
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
router.get('/:id', async (req, res) => {
    try {
        // 验证ID参数
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: '无效的版权实物ID' });
        }
        // 先查redis缓存
        const cache = await redisClient.get(REDIS_RIGHT_DETAIL_KEY_PREFIX + id);
        if (cache) {
            return res.json(JSON.parse(cache));
        }
        
        const [rows] = await db.query(`
      SELECT 
        r.*,
        c.title as category_title
      FROM rights r
      LEFT JOIN physical_categories c ON r.category_id = c.id
      WHERE r.id = ?
    `, [id]);

        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: '版权实物不存在' });
        }

        const right = processObjectImages(rows[0], ['image']);
        
        // 获取版权实物的图片
        const [images] = await db.query(
            'SELECT image_url FROM right_images WHERE right_id = ?',
            [right.id]
        );

        const result = {
            ...right,
            rich_text: right.rich_text,
            images: images.map(img => processObjectImages(img, ['image_url']).image_url),
            category: {
                id: right.category_id,
                title: right.category_title
            }
        };
        res.json(result);
        // 写入redis缓存，7天过期
        await redisClient.setEx(REDIS_RIGHT_DETAIL_KEY_PREFIX + id, 604800, JSON.stringify(result));
    } catch (error) {
        console.error('获取版权实物详情失败:', error);
        res.status(500).json({ error: '获取版权实物详情失败' });
    }
});

module.exports = router; 