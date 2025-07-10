const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../auth');
const { processObjectImages } = require('../utils/image');
const redisClient = require('../utils/redisClient');
const REDIS_RIGHTS_LIST_KEY = 'rights:list';
const REDIS_RIGHT_DETAIL_KEY_PREFIX = 'rights:detail:';

// 清理所有版权实物相关缓存
async function clearRightsCache() {
    try {
        const keys = await redisClient.keys(`${REDIS_RIGHTS_LIST_KEY}*`);
        if (keys.length > 0) {
            await redisClient.del(keys);
            console.log(`Cleared ${keys.length} rights cache keys`);
        }
    } catch (error) {
        console.error('Error clearing rights cache:', error);
    }
}

// 获取版权实物列表（需要认证）
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 20, status, category_id, sort = 'created_at', order = 'desc' } = req.query;
        
        // 输入验证
        const cleanPage = Math.max(1, parseInt(page) || 1);
        const cleanLimit = Math.min(100, Math.max(1, parseInt(limit) || 20));
        const cleanSort = ['id', 'title', 'price', 'created_at', 'updated_at'].includes(sort) ? sort : 'created_at';
        const cleanOrder = ['asc', 'desc'].includes(order.toLowerCase()) ? order.toLowerCase() : 'desc';
        const cleanStatus = status && ['onsale', 'sold', 'draft'].includes(status) ? status : null;
        const cleanCategoryId = category_id && !isNaN(parseInt(category_id)) ? parseInt(category_id) : null;
        
        const offset = (cleanPage - 1) * cleanLimit;
        
        // 构建缓存key
        const cacheKey = cleanPage === 1 && !cleanStatus && !cleanCategoryId && sort === 'created_at' && order === 'desc'
            ? REDIS_RIGHTS_LIST_KEY
            : `${REDIS_RIGHTS_LIST_KEY}:${cleanPage}:${cleanLimit}:${cleanStatus || 'all'}:${cleanCategoryId || 'all'}:${cleanSort}:${cleanOrder}`;
        
        // 先查redis缓存
        const cache = await redisClient.get(cacheKey);
        if (cache) {
            return res.json(JSON.parse(cache));
        }
        
        // 构建查询条件
        let whereClause = 'WHERE 1=1';
        let params = [];
        
        if (cleanStatus) {
            whereClause += ' AND r.status = ?';
            params.push(cleanStatus);
        }
        
        if (cleanCategoryId) {
            whereClause += ' AND r.category_id = ?';
            params.push(cleanCategoryId);
        }
        
        // 查询总数
        const [[{ total }]] = await db.query(`
            SELECT COUNT(*) as total 
            FROM rights r 
            ${whereClause}
        `, params);
        
        // 查询版权实物基本信息，只查询必要字段
        const [rows] = await db.query(`
            SELECT 
                r.id,
                r.title,
                r.status,
                r.price,
                r.original_price,
                r.period,
                r.total_count,
                r.remaining_count,
                r.description,
                r.category_id,
                r.created_at,
                r.updated_at,
                c.title as category_title
            FROM rights r
            LEFT JOIN physical_categories c ON r.category_id = c.id
            ${whereClause}
            ORDER BY r.${cleanSort} ${cleanOrder.toUpperCase()}
            LIMIT ? OFFSET ?
        `, [...params, cleanLimit, offset]);

        if (!rows || !Array.isArray(rows)) {
            return res.json({
                data: [],
                pagination: {
                    total: 0,
                    page: cleanPage,
                    limit: cleanLimit,
                    totalPages: 0
                }
            });
        }

        // 批量查询所有版权实物的图片，避免N+1查询
        const rightIds = rows.map(row => row.id);
        const [allImages] = await db.query(`
            SELECT right_id, image_url 
            FROM right_images 
            WHERE right_id IN (?)
            ORDER BY right_id, id
        `, [rightIds]);
        
        // 将图片按right_id分组
        const imagesMap = new Map();
        allImages.forEach(img => {
            if (!imagesMap.has(img.right_id)) {
                imagesMap.set(img.right_id, []);
            }
            imagesMap.get(img.right_id).push(img.image_url);
        });

        // 组装数据
        const rightsWithImages = rows.map(right => ({
            ...right,
            images: imagesMap.get(right.id) || []
        }));

        const result = {
            data: rightsWithImages,
            pagination: {
                total: parseInt(total),
                page: cleanPage,
                limit: cleanLimit,
                totalPages: Math.ceil(parseInt(total) / cleanLimit)
            }
        };

        res.json(result);
        
        // 写入redis缓存，7天过期（仅缓存第一页默认查询）
        if (cleanPage === 1 && !cleanStatus && !cleanCategoryId && sort === 'created_at' && order === 'desc') {
            await redisClient.setEx(REDIS_RIGHTS_LIST_KEY, 604800, JSON.stringify(result));
        }
    } catch (error) {
        console.error('获取版权实物列表失败:', error);
        res.status(500).json({ error: '获取版权实物列表服务暂时不可用' });
    }
});

// 新增版权实物（需要认证）
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { title, status, price, originalPrice, period, totalCount, remainingCount, description, images, category_id, rich_text } = req.body;
        
        // 输入验证
        if (!title || typeof title !== 'string' || title.trim().length === 0) {
            return res.status(400).json({ error: '标题不能为空' });
        }
        
        if (title.length > 200) {
            return res.status(400).json({ error: '标题长度不能超过200个字符' });
        }
        
        if (!status || !['onsale', 'sold', 'draft'].includes(status)) {
            return res.status(400).json({ error: '状态必须是 onsale、sold 或 draft' });
        }
        
        if (!price || isNaN(parseFloat(price)) || parseFloat(price) < 0) {
            return res.status(400).json({ error: '价格必须是有效的正数' });
        }
        
        if (originalPrice && (isNaN(parseFloat(originalPrice)) || parseFloat(originalPrice) < 0)) {
            return res.status(400).json({ error: '原价必须是有效的正数' });
        }
        
        if (totalCount && (isNaN(parseInt(totalCount)) || parseInt(totalCount) < 0)) {
            return res.status(400).json({ error: '总数量必须是有效的正整数' });
        }
        
        if (remainingCount && (isNaN(parseInt(remainingCount)) || parseInt(remainingCount) < 0)) {
            return res.status(400).json({ error: '剩余数量必须是有效的正整数' });
        }
        
        if (description && description.length > 2000) {
            return res.status(400).json({ error: '描述长度不能超过2000个字符' });
        }
        
        if (images && !Array.isArray(images)) {
            return res.status(400).json({ error: '图片必须是数组格式' });
        }
        
        // 开始事务
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // 插入版权实物基本信息
            const [insertResult] = await connection.query(
                'INSERT INTO rights (title, status, price, original_price, period, total_count, remaining_count, description, category_id, rich_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [title.trim(), status, parseFloat(price), originalPrice ? parseFloat(originalPrice) : null, period, totalCount ? parseInt(totalCount) : null, remainingCount ? parseInt(remainingCount) : null, description ? description.trim() : '', category_id, rich_text]
            );

            const rightId = insertResult.insertId;

            // 插入图片
            if (images && images.length > 0) {
                const imageValues = images.map(image => [rightId, image]);
                await connection.query(
                    'INSERT INTO right_images (right_id, image_url) VALUES ?',
                    [imageValues]
                );
            }

            await connection.commit();
            
            // 查询新创建的版权实物信息，只查询必要字段
            const [newRight] = await db.query(`
                SELECT 
                    r.id,
                    r.title,
                    r.status,
                    r.price,
                    r.original_price,
                    r.period,
                    r.total_count,
                    r.remaining_count,
                    r.description,
                    r.category_id,
                    r.rich_text,
                    r.created_at,
                    r.updated_at,
                    c.title as category_title
                FROM rights r
                LEFT JOIN physical_categories c ON r.category_id = c.id
                WHERE r.id = ?
            `, [rightId]);

            if (!newRight || newRight.length === 0) {
                return res.status(500).json({ error: '创建版权实物失败' });
            }

            // 查询图片
            const [rightImages] = await db.query(
                'SELECT image_url FROM right_images WHERE right_id = ? ORDER BY id',
                [rightId]
            );

            const result = {
                ...newRight[0],
                images: rightImages.map(img => img.image_url || '')
            };

            res.json(result);
            
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
        
        // 验证ID参数
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: '无效的版权实物ID' });
        }
        
        // 输入验证
        if (!title || typeof title !== 'string' || title.trim().length === 0) {
            return res.status(400).json({ error: '标题不能为空' });
        }
        
        if (title.length > 200) {
            return res.status(400).json({ error: '标题长度不能超过200个字符' });
        }
        
        if (!status || !['onsale', 'sold', 'draft'].includes(status)) {
            return res.status(400).json({ error: '状态必须是 onsale、sold 或 draft' });
        }
        
        if (!price || isNaN(parseFloat(price)) || parseFloat(price) < 0) {
            return res.status(400).json({ error: '价格必须是有效的正数' });
        }
        
        if (originalPrice && (isNaN(parseFloat(originalPrice)) || parseFloat(originalPrice) < 0)) {
            return res.status(400).json({ error: '原价必须是有效的正数' });
        }
        
        if (totalCount && (isNaN(parseInt(totalCount)) || parseInt(totalCount) < 0)) {
            return res.status(400).json({ error: '总数量必须是有效的正整数' });
        }
        
        if (remainingCount && (isNaN(parseInt(remainingCount)) || parseInt(remainingCount) < 0)) {
            return res.status(400).json({ error: '剩余数量必须是有效的正整数' });
        }
        
        if (description && description.length > 2000) {
            return res.status(400).json({ error: '描述长度不能超过2000个字符' });
        }
        
        if (images && !Array.isArray(images)) {
            return res.status(400).json({ error: '图片必须是数组格式' });
        }
        
        // 开始事务
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // 检查版权实物是否存在
            const [existing] = await connection.query(
                'SELECT id FROM rights WHERE id = ?',
                [id]
            );
            
            if (!existing || existing.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: '版权实物不存在' });
            }
            
            // 更新版权实物基本信息
            await connection.query(
                'UPDATE rights SET title = ?, status = ?, price = ?, original_price = ?, period = ?, total_count = ?, remaining_count = ?, description = ?, category_id = ?, rich_text = ?, updated_at = NOW() WHERE id = ?',
                [title.trim(), status, parseFloat(price), originalPrice ? parseFloat(originalPrice) : null, period, totalCount ? parseInt(totalCount) : null, remainingCount ? parseInt(remainingCount) : null, description ? description.trim() : '', category_id, rich_text, id]
            );

            // 删除旧图片
            await connection.query('DELETE FROM right_images WHERE right_id = ?', [id]);

            // 插入新图片
            if (images && images.length > 0) {
                const imageValues = images.map(image => [id, image]);
                await connection.query(
                    'INSERT INTO right_images (right_id, image_url) VALUES ?',
                    [imageValues]
                );
            }

            await connection.commit();
            
            // 查询更新后的版权实物信息，只查询必要字段
            const [updatedRight] = await db.query(`
                SELECT 
                    r.id,
                    r.title,
                    r.status,
                    r.price,
                    r.original_price,
                    r.period,
                    r.total_count,
                    r.remaining_count,
                    r.description,
                    r.category_id,
                    r.rich_text,
                    r.created_at,
                    r.updated_at,
                    c.title as category_title
                FROM rights r
                LEFT JOIN physical_categories c ON r.category_id = c.id
                WHERE r.id = ?
            `, [id]);

            if (!updatedRight || updatedRight.length === 0) {
                return res.status(500).json({ error: '更新版权实物失败' });
            }

            // 查询图片
            const [rightImages] = await db.query(
                'SELECT image_url FROM right_images WHERE right_id = ? ORDER BY id',
                [id]
            );

            const result = {
                ...updatedRight[0],
                images: rightImages.map(img => img.image_url || '')
            };

            res.json(result);
            
            // 清理缓存
            await clearRightsCache();
            await redisClient.del(REDIS_RIGHT_DETAIL_KEY_PREFIX + id);
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
        // 验证ID参数
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: '无效的版权实物ID' });
        }
        
        // 开始事务
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // 检查版权实物是否存在
            const [existing] = await connection.query(
                'SELECT id, title FROM rights WHERE id = ?',
                [id]
            );
            
            if (!existing || existing.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: '版权实物不存在' });
            }
            
            // 先删除相关的订单项
            await connection.query('DELETE FROM order_items WHERE right_id = ?', [id]);

            // 删除图片
            await connection.query('DELETE FROM right_images WHERE right_id = ?', [id]);

            // 删除版权实物
            await connection.query('DELETE FROM rights WHERE id = ?', [id]);

            await connection.commit();
            
            res.json({ 
                message: '删除成功',
                deletedRight: {
                    id: existing[0].id,
                    title: existing[0].title
                }
            });
            
            // 清理缓存
            await clearRightsCache();
            await redisClient.del(REDIS_RIGHT_DETAIL_KEY_PREFIX + id);
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
        
        // 查询版权实物详情，只查询必要字段
        const [rows] = await db.query(`
            SELECT 
                r.id,
                r.title,
                r.status,
                r.price,
                r.original_price,
                r.period,
                r.total_count,
                r.remaining_count,
                r.description,
                r.category_id,
                r.rich_text,
                r.created_at,
                r.updated_at,
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
            'SELECT image_url FROM right_images WHERE right_id = ? ORDER BY id',
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