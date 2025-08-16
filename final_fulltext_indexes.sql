-- 最终全文索引优化脚本
-- 只添加全文索引，这些是最重要的性能优化

USE data;

-- 1. 为digital_artworks表添加全文索引
CREATE FULLTEXT INDEX ft_digital_artworks_search ON digital_artworks(title, description);

-- 2. 为wx_users表添加全文索引
CREATE FULLTEXT INDEX ft_wx_users_search ON wx_users(nickname, phone);

-- 3. 为artists表添加全文索引
CREATE FULLTEXT INDEX ft_artists_search ON artists(name, description);

-- 4. 为user_sessions表添加全文索引
CREATE FULLTEXT INDEX ft_user_sessions_search ON user_sessions(session_data);

-- 5. 为institutions表添加全文索引
CREATE FULLTEXT INDEX ft_institutions_search ON institutions(name, description);

-- 6. 为physical_categories表添加全文索引
CREATE FULLTEXT INDEX ft_physical_categories_search ON physical_categories(title, description);

-- 7. 为banners表添加全文索引
CREATE FULLTEXT INDEX ft_banners_search ON banners(title, description);

-- 8. 为favorites表添加全文索引
CREATE FULLTEXT INDEX ft_favorites_search ON favorites(notes);

-- 9. 分析表统计信息
ANALYZE TABLE digital_artworks;
ANALYZE TABLE wx_users;
ANALYZE TABLE artists;
ANALYZE TABLE user_sessions;
ANALYZE TABLE institutions;
ANALYZE TABLE physical_categories;
ANALYZE TABLE banners;
ANALYZE TABLE favorites;

-- 10. 检查全文索引创建结果
SELECT 
    table_name,
    index_name,
    column_name,
    seq_in_index,
    index_type
FROM information_schema.statistics 
WHERE table_schema = 'data' 
AND table_name IN ('digital_artworks', 'wx_users', 'artists', 'user_sessions', 'institutions', 'physical_categories', 'banners', 'favorites')
AND index_type = 'FULLTEXT'
ORDER BY table_name, index_name, seq_in_index;

-- 11. 测试全文搜索性能
-- 测试digital_artworks全文搜索
EXPLAIN SELECT 
    da.id, da.title, da.image_url, da.description, da.price, da.created_at,
    a.id as artist_id, a.name as artist_name, a.avatar as artist_avatar
FROM digital_artworks da
LEFT JOIN artists a ON da.artist_id = a.id
WHERE MATCH(da.title, da.description) AGAINST('test' IN NATURAL LANGUAGE MODE)
   OR MATCH(a.name) AGAINST('test' IN NATURAL LANGUAGE MODE)
LIMIT 20 OFFSET 0;

-- 测试wx_users全文搜索
EXPLAIN SELECT id, openid, nickname, avatar, phone, created_at, updated_at 
FROM wx_users 
WHERE MATCH(nickname, phone) AGAINST('test' IN NATURAL LANGUAGE MODE);

-- 测试artists全文搜索
EXPLAIN SELECT 
    a.*,
    i.id as institution_id,
    i.name as institution_name,
    i.logo as institution_logo,
    i.description as institution_description
FROM artists a
LEFT JOIN institutions i ON a.institution_id = i.id
WHERE MATCH(a.name, a.description) AGAINST('test' IN NATURAL LANGUAGE MODE);

-- 测试institutions全文搜索
EXPLAIN SELECT * FROM institutions 
WHERE MATCH(name, description) AGAINST('test' IN NATURAL LANGUAGE MODE);

-- 测试physical_categories全文搜索
EXPLAIN SELECT * FROM physical_categories 
WHERE MATCH(title, description) AGAINST('test' IN NATURAL LANGUAGE MODE);

-- 测试banners全文搜索
EXPLAIN SELECT * FROM banners 
WHERE MATCH(title, description) AGAINST('test' IN NATURAL LANGUAGE MODE);

-- 测试favorites全文搜索
EXPLAIN SELECT * FROM favorites 
WHERE MATCH(notes) AGAINST('test' IN NATURAL LANGUAGE MODE);

-- 12. 检查当前全表扫描情况
SELECT 
    OBJECT_NAME as table_name,
    COUNT_STAR as full_table_scans,
    SUM_TIMER_WAIT as total_wait_time,
    AVG_TIMER_WAIT as avg_wait_time
FROM performance_schema.table_io_waits_summary_by_index_usage 
WHERE index_name IS NULL 
AND count_star > 0 
AND object_schema = 'data'
AND OBJECT_NAME IN ('digital_artworks', 'wx_users', 'artists', 'user_sessions', 'institutions', 'physical_categories', 'banners', 'favorites')
ORDER BY count_star DESC;

-- 13. 检查索引使用情况
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
AND OBJECT_NAME IN ('digital_artworks', 'wx_users', 'artists', 'user_sessions', 'institutions', 'physical_categories', 'banners', 'favorites')
ORDER BY count_star DESC;

-- 14. 最终性能总结
SELECT 
    '全表扫描统计' as type,
    COUNT(*) as table_count,
    SUM(COUNT_STAR) as total_full_scans
FROM performance_schema.table_io_waits_summary_by_index_usage 
WHERE index_name IS NULL 
AND count_star > 0 
AND object_schema = 'data'
AND OBJECT_NAME IN ('digital_artworks', 'wx_users', 'artists', 'user_sessions', 'institutions', 'physical_categories', 'banners', 'favorites')

UNION ALL

SELECT 
    '索引使用统计' as type,
    COUNT(*) as index_count,
    SUM(COUNT_STAR) as total_index_usage
FROM performance_schema.table_io_waits_summary_by_index_usage 
WHERE index_name IS NOT NULL 
AND count_star > 0 
AND object_schema = 'data'
AND OBJECT_NAME IN ('digital_artworks', 'wx_users', 'artists', 'user_sessions', 'institutions', 'physical_categories', 'banners', 'favorites');
