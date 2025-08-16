-- 最终性能检查脚本
-- 验证所有MySQL索引优化的效果

USE data;

-- 1. 检查当前全表扫描情况
SELECT 
    '=== 当前全表扫描情况 ===' as info;
    
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
    '=== 索引使用情况 ===' as info;
    
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

-- 3. 检查所有表的索引统计
SELECT 
    '=== 所有表的索引统计 ===' as info;
    
SELECT 
    table_name,
    COUNT(*) as index_count,
    GROUP_CONCAT(index_name ORDER BY seq_in_index) as indexes
FROM information_schema.statistics 
WHERE table_schema = 'data' 
GROUP BY table_name
ORDER BY index_count DESC;

-- 4. 测试关键查询的性能
SELECT 
    '=== 关键查询性能测试 ===' as info;

-- 测试original_artworks查询（已优化）
EXPLAIN SELECT
    oa.id, oa.title, oa.year, oa.image, oa.price, oa.is_on_sale, oa.stock, oa.sales, oa.created_at,
    a.id as artist_id, a.name as artist_name, a.avatar as artist_avatar
FROM original_artworks oa FORCE INDEX (idx_created_at)
LEFT JOIN artists a ON oa.artist_id = a.id
ORDER BY oa.created_at DESC 
LIMIT 20 OFFSET 0;

-- 测试orders查询（已优化）
EXPLAIN SELECT * FROM orders FORCE INDEX (idx_orders_user_id) 
WHERE user_id = 1 
ORDER BY created_at DESC 
LIMIT 20 OFFSET 0;

-- 测试merchants查询（已优化）
EXPLAIN SELECT id, name, logo, description, address, phone, status, created_at, updated_at 
FROM merchants 
WHERE status = 'active'
ORDER BY created_at DESC
LIMIT 20 OFFSET 0;

-- 测试refund_requests查询（已优化）
EXPLAIN SELECT * FROM refund_requests 
WHERE status = 'PENDING'
ORDER BY created_at DESC
LIMIT 20 OFFSET 0;

-- 测试real_name_registrations查询（已优化）
EXPLAIN SELECT * FROM real_name_registrations 
WHERE user_id = 1;

-- 测试wx_user_addresses查询（已优化）
EXPLAIN SELECT * FROM wx_user_addresses 
WHERE user_id = 1;

-- 测试merchant_images查询（需要进一步优化）
EXPLAIN SELECT merchant_id, image_url 
FROM merchant_images 
WHERE merchant_id IN (1,2,3);

-- 5. 检查MySQL状态
SELECT 
    '=== MySQL性能状态 ===' as info;
    
SHOW STATUS LIKE 'Handler_read%';
SHOW STATUS LIKE 'Qcache%';
SHOW STATUS LIKE 'Innodb_buffer_pool_%';

-- 6. 检查慢查询
SELECT 
    '=== 慢查询统计 ===' as info;
    
SELECT 
    COUNT(*) as slow_query_count
FROM mysql.slow_log 
WHERE start_time > DATE_SUB(NOW(), INTERVAL 1 HOUR);

-- 7. 总结优化效果
SELECT 
    '=== 优化效果总结 ===' as info;
    
SELECT 
    '原始问题：MySQL没有使用索引导致全表扫描' as issue,
    '解决方案：为所有主要查询模式添加了合适的索引' as solution,
    '优化表：original_artworks, orders, cart_items, order_items, rights, right_images, real_name_registrations, merchant_images, merchants, refund_requests, wx_user_addresses' as optimized_tables,
    '预期效果：大幅减少全表扫描，提升查询性能' as expected_result;
