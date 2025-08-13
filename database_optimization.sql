-- 数据库性能优化建议
-- 执行这些SQL语句来优化数据库性能

-- 1. 为艺术品表创建索引
-- 主键索引（如果不存在）
ALTER TABLE original_artworks ADD PRIMARY KEY IF NOT EXISTS (id);

-- 艺术家ID索引（用于JOIN和WHERE查询）
CREATE INDEX IF NOT EXISTS idx_original_artworks_artist_id ON original_artworks(artist_id);

-- 创建时间索引（用于ORDER BY）
CREATE INDEX IF NOT EXISTS idx_original_artworks_created_at ON original_artworks(created_at DESC);

-- 复合索引（艺术家ID + 创建时间，用于分页查询）
CREATE INDEX IF NOT EXISTS idx_original_artworks_artist_created ON original_artworks(artist_id, created_at DESC);

-- 状态索引（用于筛选在售商品）
CREATE INDEX IF NOT EXISTS idx_original_artworks_is_on_sale ON original_artworks(is_on_sale);

-- 价格索引（用于价格排序和筛选）
CREATE INDEX IF NOT EXISTS idx_original_artworks_price ON original_artworks(price);

-- 年份索引（用于年份筛选）
CREATE INDEX IF NOT EXISTS idx_original_artworks_year ON original_artworks(year);

-- 2. 为艺术家表创建索引
-- 主键索引（如果不存在）
ALTER TABLE artists ADD PRIMARY KEY IF NOT EXISTS (id);

-- 艺术家名称索引（用于搜索）
CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name);

-- 3. 优化表结构
-- 分析表统计信息
ANALYZE TABLE original_artworks;
ANALYZE TABLE artists;

-- 4. 查询优化建议

-- 优化后的艺术品列表查询（使用索引）
-- 这个查询会使用 idx_original_artworks_artist_created 索引
/*
SELECT 
  oa.id, oa.title, oa.year, oa.image, oa.price, oa.is_on_sale, oa.stock, oa.sales, oa.created_at,
  a.id as artist_id, a.name as artist_name, a.avatar as artist_avatar
FROM original_artworks oa 
FORCE INDEX (idx_original_artworks_artist_created)
LEFT JOIN artists a ON oa.artist_id = a.id
WHERE oa.artist_id = ? 
ORDER BY oa.created_at DESC 
LIMIT ? OFFSET ?;
*/

-- 5. 数据库配置优化建议

-- 在MySQL配置文件中添加以下设置：
/*
[mysqld]
# 查询缓存
query_cache_type = 1
query_cache_size = 64M
query_cache_limit = 2M

# 连接池
max_connections = 200
max_connect_errors = 1000
connect_timeout = 10
wait_timeout = 28800
interactive_timeout = 28800

# 缓冲池
innodb_buffer_pool_size = 1G
innodb_log_file_size = 256M
innodb_log_buffer_size = 16M

# 查询优化
sort_buffer_size = 2M
read_buffer_size = 2M
read_rnd_buffer_size = 8M
join_buffer_size = 2M

# 临时表
tmp_table_size = 64M
max_heap_table_size = 64M

# 慢查询日志
slow_query_log = 1
slow_query_log_file = /var/log/mysql/slow.log
long_query_time = 1
*/

-- 6. 监控查询

-- 查看当前索引使用情况
SELECT 
    table_name,
    index_name,
    cardinality,
    sub_part,
    packed,
    nullable,
    index_type
FROM information_schema.statistics 
WHERE table_schema = 'data' 
AND table_name IN ('original_artworks', 'artists')
ORDER BY table_name, index_name;

-- 查看慢查询
-- SELECT * FROM mysql.slow_log ORDER BY start_time DESC LIMIT 10;

-- 查看表大小
SELECT 
    table_name,
    ROUND(((data_length + index_length) / 1024 / 1024), 2) AS 'Size (MB)',
    table_rows
FROM information_schema.tables 
WHERE table_schema = 'data' 
AND table_name IN ('original_artworks', 'artists');

-- 7. 性能测试查询

-- 测试分页查询性能
-- EXPLAIN SELECT 
--   oa.id, oa.title, oa.year, oa.image, oa.price, oa.is_on_sale, oa.stock, oa.sales, oa.created_at,
--   a.id as artist_id, a.name as artist_name, a.avatar as artist_avatar
-- FROM original_artworks oa 
-- LEFT JOIN artists a ON oa.artist_id = a.id
-- ORDER BY oa.created_at DESC 
-- LIMIT 20 OFFSET 0;

-- 8. 定期维护任务

-- 定期优化表（建议每周执行一次）
-- OPTIMIZE TABLE original_artworks;
-- OPTIMIZE TABLE artists;

-- 定期分析表（建议每天执行一次）
-- ANALYZE TABLE original_artworks;
-- ANALYZE TABLE artists;
