-- 为rights和right_images表添加精确索引
-- 基于实际代码使用模式优化

USE data;

-- 1. 为rights表添加精确索引

-- 主要查询模式：WHERE status = 'onsale' (用于购物车和支付查询)
CREATE INDEX idx_rights_status_onsale ON rights(status, remaining_count);

-- 复合索引：status + category_id (用于按状态和分类查询)
CREATE INDEX idx_rights_status_category ON rights(status, category_id);

-- 复合索引：status + price (用于按状态和价格排序)
CREATE INDEX idx_rights_status_price ON rights(status, price);

-- 复合索引：status + created_at (用于按状态和时间排序)
CREATE INDEX idx_rights_status_created ON rights(status, created_at DESC);

-- 复合索引：category_id + status (用于按分类和状态查询)
CREATE INDEX idx_rights_category_status ON rights(category_id, status);

-- 复合索引：category_id + created_at (用于按分类和时间排序)
CREATE INDEX idx_rights_category_created ON rights(category_id, created_at DESC);

-- 复合索引：price + status (用于按价格和状态查询)
CREATE INDEX idx_rights_price_status ON rights(price, status);

-- 复合索引：remaining_count + status (用于库存和状态查询)
CREATE INDEX idx_rights_remaining_status ON rights(remaining_count, status);

-- 复合索引：id + status (用于按ID和状态查询)
CREATE INDEX idx_rights_id_status ON rights(id, status);

-- 2. 为right_images表添加精确索引

-- 主要查询模式：WHERE right_id = ? (用于查询特定权益的图片)
-- 这个索引已经存在，但我们需要确保它是最优的
-- CREATE INDEX right_id ON right_images(right_id);

-- 复合索引：right_id + id (用于按right_id和id排序)
CREATE INDEX idx_right_images_right_id_order ON right_images(right_id, id);

-- 复合索引：right_id + image_url (用于按right_id和图片URL查询)
CREATE INDEX idx_right_images_right_url ON right_images(right_id, image_url);

-- 3. 分析表统计信息
ANALYZE TABLE rights;
ANALYZE TABLE right_images;

-- 4. 检查索引创建结果
SELECT 
    table_name,
    index_name,
    column_name,
    seq_in_index,
    index_type
FROM information_schema.statistics 
WHERE table_schema = 'data' 
AND table_name IN ('rights', 'right_images')
ORDER BY table_name, index_name, seq_in_index;

-- 5. 测试实际查询性能
-- 测试rights主要查询：WHERE id IN (?) AND status = 'onsale'
EXPLAIN SELECT r.id, r.title, r.price, r.original_price, r.status, r.remaining_count, r.category_id, c.title as category_title
FROM rights r
LEFT JOIN physical_categories c ON r.category_id = c.id
WHERE r.id IN (1,2,3) AND r.status = 'onsale';

-- 测试rights列表查询：按状态和分类查询
EXPLAIN SELECT r.id, r.title, r.status, r.price, r.original_price, r.period, r.total_count, r.remaining_count, r.description, r.category_id, r.created_at, r.updated_at, c.title as category_title
FROM rights r
LEFT JOIN physical_categories c ON r.category_id = c.id
WHERE r.status = 'onsale'
ORDER BY r.created_at DESC
LIMIT 20 OFFSET 0;

-- 测试right_images查询：WHERE right_id IN (?)
EXPLAIN SELECT right_id, image_url 
FROM right_images 
WHERE right_id IN (1,2,3)
ORDER BY right_id, id;

-- 测试right_images查询：WHERE right_id = ?
EXPLAIN SELECT image_url FROM right_images WHERE right_id = 1 ORDER BY id;

-- 6. 检查当前全表扫描情况
SELECT 
    OBJECT_NAME as table_name,
    COUNT_STAR as full_table_scans,
    SUM_TIMER_WAIT as total_wait_time,
    AVG_TIMER_WAIT as avg_wait_time
FROM performance_schema.table_io_waits_summary_by_index_usage 
WHERE index_name IS NULL 
AND count_star > 0 
AND object_schema = 'data'
AND OBJECT_NAME IN ('rights', 'right_images')
ORDER BY count_star DESC;

-- 7. 检查索引使用情况
SELECT 
    OBJECT_NAME as table_name,
    INDEX_NAME as index_name,
    COUNT_STAR as usage_count,
    SUM_TIMER_WAIT as total_wait_time,
    AVG_TIMER_WAIT as avg_wait_time
FROM performance_schema.table_io_waits_summary_by_index_usage 
WHERE index_name IS NOT NULL 
AND count_star > 0 
AND object_schema = 'data'
AND OBJECT_NAME IN ('rights', 'right_images')
ORDER BY count_star DESC;
