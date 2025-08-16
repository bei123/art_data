-- 综合性能检查脚本
-- 验证所有优化效果

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

-- 3. 测试所有关键查询性能
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

-- 测试cart_items查询
EXPLAIN SELECT id, type, right_id, digital_artwork_id, artwork_id, quantity, price 
FROM cart_items WHERE user_id = 1;

-- 测试order_items查询
EXPLAIN SELECT * FROM order_items WHERE order_id = 1;

-- 测试rights查询
EXPLAIN SELECT r.id, r.title, r.price, r.original_price, r.status, r.remaining_count, r.category_id, c.title as category_title
FROM rights r
LEFT JOIN physical_categories c ON r.category_id = c.id
WHERE r.id IN (1,2,3) AND r.status = 'onsale';

-- 测试right_images查询
EXPLAIN SELECT right_id, image_url 
FROM right_images 
WHERE right_id IN (1,2,3)
ORDER BY right_id, id;

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

-- 7. 检查查询缓存状态
SHOW STATUS LIKE 'Qcache%';

-- 8. 显示所有表的索引统计
SELECT 
    table_name,
    COUNT(*) as index_count,
    GROUP_CONCAT(index_name ORDER BY index_name) as indexes
FROM information_schema.statistics 
WHERE table_schema = 'data' 
AND table_name IN ('original_artworks', 'orders', 'cart_items', 'artists', 'digital_artworks', 'rights', 'order_items', 'wx_users', 'right_images')
GROUP BY table_name
ORDER BY table_name;

-- 9. 计算优化效果
SELECT 
    '优化前全表扫描最多的表' as description,
    'order_items: 1129次, cart_items: 1120次, rights: 760次, right_images: 758次' as before_optimization
UNION ALL
SELECT 
    '当前全表扫描情况' as description,
    CONCAT(
        (SELECT COUNT(*) FROM performance_schema.table_io_waits_summary_by_index_usage 
         WHERE index_name IS NULL AND count_star > 0 AND object_schema = 'data'),
        ' 个表仍有全表扫描'
    ) as current_status;
