-- 最终性能验证脚本
-- 检查优化后的MySQL性能

USE data;

-- 1. 检查当前全表扫描情况
SELECT 
    OBJECT_NAME as table_name,
    COUNT_STAR as full_table_scans,
    SUM_TIMER_WAIT as total_wait_time,
    AVG_TIMER_WAIT as avg_wait_time
FROM performance_schema.table_io_waits_summary_by_index_usage 
WHERE index_name IS NULL 
AND count_star > 0 
AND object_schema = 'data'
ORDER BY count_star DESC;

-- 2. 检查索引使用情况
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
ORDER BY count_star DESC;

-- 3. 测试关键查询的性能
-- 测试original_artworks分页查询
EXPLAIN SELECT 
  oa.id, oa.title, oa.year, oa.image, oa.price, oa.is_on_sale, oa.stock, oa.sales, oa.created_at,
  a.id as artist_id, a.name as artist_name, a.avatar as artist_avatar
FROM original_artworks oa FORCE INDEX (idx_created_at)
LEFT JOIN artists a ON oa.artist_id = a.id
ORDER BY oa.created_at DESC 
LIMIT 20 OFFSET 0;

-- 测试orders查询
EXPLAIN SELECT * FROM orders FORCE INDEX (idx_orders_user_id) WHERE user_id = 1 ORDER BY created_at DESC;

-- 测试搜索查询
EXPLAIN SELECT oa.id, oa.title, oa.image, oa.description, oa.artist_id, a.name as artist_name, a.avatar as artist_avatar, 'original_artwork' as type 
FROM original_artworks oa
LEFT JOIN artists a ON oa.artist_id = a.id
WHERE MATCH(oa.title, oa.description) AGAINST('test' IN NATURAL LANGUAGE MODE) 
   OR MATCH(a.name) AGAINST('test' IN NATURAL LANGUAGE MODE)
LIMIT 20 OFFSET 0;

-- 4. 检查Handler统计
SHOW STATUS LIKE 'Handler_read%';

-- 5. 检查InnoDB缓冲池状态
SHOW STATUS LIKE 'Innodb_buffer_pool_%';

-- 6. 检查当前连接数
SHOW STATUS LIKE 'Threads_%';
SHOW STATUS LIKE 'Connections';
