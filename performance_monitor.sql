-- 性能监控脚本
-- 用于检查MySQL索引使用情况和全表扫描问题

USE data;

-- 1. 检查全表扫描情况
SELECT 
    OBJECT_NAME,
    INDEX_NAME,
    COUNT_STAR,
    SUM_TIMER_WAIT,
    AVG_TIMER_WAIT
FROM performance_schema.table_io_waits_summary_by_index_usage
WHERE INDEX_NAME IS NULL 
AND count_star > 0
AND object_schema = 'data'
ORDER BY count_star DESC;

-- 2. 检查索引使用情况
SELECT 
    OBJECT_NAME,
    INDEX_NAME,
    COUNT_STAR,
    SUM_TIMER_WAIT,
    AVG_TIMER_WAIT
FROM performance_schema.table_io_waits_summary_by_index_usage
WHERE INDEX_NAME IS NOT NULL 
AND count_star > 0
AND object_schema = 'data'
ORDER BY count_star DESC;

-- 3. 检查当前正在执行的查询
SHOW PROCESSLIST;

-- 4. 检查慢查询日志
SELECT 
    start_time,
    query_time,
    sql_text
FROM mysql.slow_log 
WHERE start_time > DATE_SUB(NOW(), INTERVAL 1 HOUR)
ORDER BY start_time DESC 
LIMIT 10;

-- 5. 检查表大小和行数
SELECT 
    table_name,
    ROUND(((data_length + index_length) / 1024 / 1024), 2) AS 'Size (MB)',
    table_rows,
    ROUND((data_length / 1024 / 1024), 2) AS 'Data (MB)',
    ROUND((index_length / 1024 / 1024), 2) AS 'Index (MB)'
FROM information_schema.tables 
WHERE table_schema = 'data' 
AND table_name IN ('original_artworks', 'orders', 'cart_items', 'artists', 'digital_artworks', 'rights', 'order_items', 'wx_users')
ORDER BY (data_length + index_length) DESC;

-- 6. 检查索引统计信息
SELECT 
    table_name,
    index_name,
    cardinality,
    sub_part,
    nullable,
    index_type
FROM information_schema.statistics 
WHERE table_schema = 'data' 
AND table_name IN ('original_artworks', 'orders', 'cart_items', 'artists', 'digital_artworks', 'rights', 'order_items', 'wx_users')
ORDER BY table_name, index_name;

-- 7. 检查Handler状态（关键指标）
SHOW STATUS LIKE 'Handler_read%';

-- 8. 检查查询缓存状态
SHOW STATUS LIKE 'Qcache%';

-- 9. 检查InnoDB缓冲池状态
SHOW STATUS LIKE 'Innodb_buffer_pool_%';

-- 10. 检查连接数
SHOW STATUS LIKE 'Threads_%';
SHOW STATUS LIKE 'Connections';
