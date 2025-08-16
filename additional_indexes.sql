-- 为order_items和cart_items表添加精确索引
-- 基于实际代码使用模式优化

USE data;

-- 1. 为order_items表添加精确索引

-- 主要查询模式：WHERE order_id = ? (用于删除和查询订单项)
-- 这个索引已经存在，但我们需要确保它是最优的
-- CREATE INDEX idx_order_items_order_id ON order_items(order_id);

-- 复合索引：order_id + type (用于按订单和类型查询)
CREATE INDEX idx_order_items_order_type ON order_items(order_id, type);

-- 复合索引：order_id + created_at (用于按订单和时间排序)
CREATE INDEX idx_order_items_order_created ON order_items(order_id, created_at DESC);

-- 复合索引：type + right_id (用于按类型和权益ID查询)
CREATE INDEX idx_order_items_type_right ON order_items(type, right_id);

-- 复合索引：type + digital_artwork_id (用于按类型和数字艺术品ID查询)
CREATE INDEX idx_order_items_type_digital ON order_items(type, digital_artwork_id);

-- 复合索引：type + artwork_id (用于按类型和艺术品ID查询)
CREATE INDEX idx_order_items_type_artwork ON order_items(type, artwork_id);

-- 2. 为cart_items表添加精确索引

-- 主要查询模式：WHERE user_id = ? (用于查询用户购物车)
-- 这个索引已经存在，但我们需要确保它是最优的
-- CREATE INDEX idx_cart_user_type ON cart_items(user_id, type);

-- 复合索引：user_id + type + right_id (用于检查特定权益是否在购物车)
CREATE INDEX idx_cart_items_user_type_right ON cart_items(user_id, type, right_id);

-- 复合索引：user_id + type + digital_artwork_id (用于检查特定数字艺术品是否在购物车)
CREATE INDEX idx_cart_items_user_type_digital ON cart_items(user_id, type, digital_artwork_id);

-- 复合索引：user_id + type + artwork_id (用于检查特定艺术品是否在购物车)
CREATE INDEX idx_cart_items_user_type_artwork ON cart_items(user_id, type, artwork_id);

-- 复合索引：user_id + created_at (用于按用户和时间排序)
CREATE INDEX idx_cart_items_user_created ON cart_items(user_id, created_at DESC);

-- 复合索引：type + right_id (用于按类型和权益ID查询)
CREATE INDEX idx_cart_items_type_right ON cart_items(type, right_id);

-- 复合索引：type + digital_artwork_id (用于按类型和数字艺术品ID查询)
CREATE INDEX idx_cart_items_type_digital ON cart_items(type, digital_artwork_id);

-- 复合索引：type + artwork_id (用于按类型和艺术品ID查询)
CREATE INDEX idx_cart_items_type_artwork ON cart_items(type, artwork_id);

-- 3. 分析表统计信息
ANALYZE TABLE order_items;
ANALYZE TABLE cart_items;

-- 4. 检查索引创建结果
SELECT 
    table_name,
    index_name,
    column_name,
    seq_in_index,
    index_type
FROM information_schema.statistics 
WHERE table_schema = 'data' 
AND table_name IN ('order_items', 'cart_items')
ORDER BY table_name, index_name, seq_in_index;

-- 5. 测试实际查询性能
-- 测试cart_items主要查询：WHERE user_id = ?
EXPLAIN SELECT id, type, right_id, digital_artwork_id, artwork_id, quantity, price 
FROM cart_items WHERE user_id = 1;

-- 测试cart_items复合查询：WHERE user_id = ? AND right_id = ? AND type = "right"
EXPLAIN SELECT id, quantity FROM cart_items WHERE user_id = 1 AND right_id = 1 AND type = "right";

-- 测试cart_items复合查询：WHERE user_id = ? AND digital_artwork_id = ? AND type = "digital"
EXPLAIN SELECT id FROM cart_items WHERE user_id = 1 AND digital_artwork_id = 1 AND type = "digital";

-- 测试order_items主要查询：WHERE order_id = ?
EXPLAIN SELECT * FROM order_items WHERE order_id = 1;

-- 测试order_items复合查询：WHERE order_id = ? AND type = ?
EXPLAIN SELECT * FROM order_items WHERE order_id = 1 AND type = 'right';

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
AND OBJECT_NAME IN ('order_items', 'cart_items')
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
AND OBJECT_NAME IN ('order_items', 'cart_items')
ORDER BY count_star DESC;
