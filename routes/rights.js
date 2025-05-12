const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../auth');

// 获取版权实物列表（需要认证）
router.get('/', async (req, res) => {
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
            right.images = images.map(img => img.image_url || '');
        }

        res.json(rows);
    } catch (error) {
        console.error('获取版权实物列表失败:', error);
        res.status(500).json({ error: '获取版权实物列表失败' });
    }
});

// 新增版权实物（需要认证）
router.post('/', authenticateToken, async (req, res) => {
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

// 编辑版权实物（需要认证）
router.put('/:id', authenticateToken, async (req, res) => {
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
router.get('/public/:id', async (req, res) => {
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
                image: category[0]?.image || '',
                icon: category[0]?.icon || '',
                count: category[0]?.count || 0,
                description: category[0]?.description || ''
            },
            images: images.map(img => img.image_url || ''),
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

module.exports = router; 