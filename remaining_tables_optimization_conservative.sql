-- 剩余表优化脚本（保守版本）
-- 跳过所有可能已存在的索引，只创建确定缺失的索引

USE data;

-- 1. 为digital_artworks表添加索引（基于代码分析）

-- 主要查询模式：ORDER BY created_at DESC（分页查询）
-- CREATE INDEX idx_digital_artworks_created_at ON digital_artworks(created_at DESC);

-- 复合索引：artist_id + created_at（按艺术家和时间排序）
-- CREATE INDEX idx_digital_artworks_artist_created ON digital_artworks(artist_id, created_at DESC);

-- 复合索引：title + created_at（搜索优化）
CREATE INDEX idx_digital_artworks_title_created ON digital_artworks(title, created_at DESC);

-- 复合索引：description + created_at（搜索优化）
CREATE INDEX idx_digital_artworks_desc_created ON digital_artworks(description(255), created_at DESC);

-- 全文索引：用于搜索优化
CREATE FULLTEXT INDEX ft_digital_artworks_search ON digital_artworks(title, description);

-- 2. 为wx_users表添加索引（基于代码分析）

-- 复合索引：openid + updated_at（登录时更新session_key）
CREATE INDEX idx_wx_users_openid_updated ON wx_users(openid, updated_at);

-- 复合索引：id + updated_at（用户信息更新）
CREATE INDEX idx_wx_users_id_updated ON wx_users(id, updated_at);

-- 复合索引：phone + id（手机号查询）
CREATE INDEX idx_wx_users_phone_id ON wx_users(phone, id);

-- 复合索引：nickname + id（昵称查询）
CREATE INDEX idx_wx_users_nickname_id ON wx_users(nickname, id);

-- 全文索引：用于搜索优化
CREATE FULLTEXT INDEX ft_wx_users_search ON wx_users(nickname, phone);

-- 3. 为artists表添加索引（基于代码分析）

-- 主要查询模式：ORDER BY created_at DESC（列表查询）
CREATE INDEX idx_artists_created_at ON artists(created_at DESC);

-- 复合索引：institution_id + created_at（按机构和时间排序）
CREATE INDEX idx_artists_institution_created ON artists(institution_id, created_at DESC);

-- 复合索引：name + created_at（搜索优化）
CREATE INDEX idx_artists_name_created ON artists(name, created_at DESC);

-- 复合索引：id + institution_id（详情查询）
CREATE INDEX idx_artists_id_institution ON artists(id, institution_id);

-- 全文索引：用于搜索优化
CREATE FULLTEXT INDEX ft_artists_search ON artists(name, description);

-- 4. 为user_sessions表添加索引（基于代码分析）

-- 复合索引：user_id + created_at（按用户和时间排序）
CREATE INDEX idx_user_sessions_user_created ON user_sessions(user_id, created_at DESC);

-- 复合索引：user_id + id（按用户和ID排序）
CREATE INDEX idx_user_sessions_user_id_order ON user_sessions(user_id, id);

-- 全文索引：用于搜索优化
CREATE FULLTEXT INDEX ft_user_sessions_search ON user_sessions(session_data);

-- 5. 为institutions表添加索引（基于代码分析）

-- 主要查询模式：ORDER BY created_at DESC（列表查询）
CREATE INDEX idx_institutions_created_at ON institutions(created_at DESC);

-- 复合索引：name + created_at（搜索优化）
CREATE INDEX idx_institutions_name_created ON institutions(name, created_at DESC);

-- 复合索引：id + name（详情查询）
CREATE INDEX idx_institutions_id_name ON institutions(id, name);

-- 全文索引：用于搜索优化
CREATE FULLTEXT INDEX ft_institutions_search ON institutions(name, description);

-- 6. 为physical_categories表添加索引（基于代码分析）

-- 主要查询模式：ORDER BY created_at DESC（列表查询）
CREATE INDEX idx_physical_categories_created_at ON physical_categories(created_at DESC);

-- 复合索引：title + created_at（搜索优化）
CREATE INDEX idx_physical_categories_title_created ON physical_categories(title, created_at DESC);

-- 复合索引：id + title（详情查询）
CREATE INDEX idx_physical_categories_id_title ON physical_categories(id, title);

-- 全文索引：用于搜索优化
CREATE FULLTEXT INDEX ft_physical_categories_search ON physical_categories(title, description);

-- 7. 为banners表添加索引（基于代码分析）

-- 主要查询模式：ORDER BY sort_order ASC（轮播图排序）
CREATE INDEX idx_banners_sort_order ON banners(sort_order ASC);

-- 复合索引：status + sort_order（按状态和排序）
CREATE INDEX idx_banners_status_sort ON banners(status, sort_order ASC);

-- 复合索引：created_at + sort_order（按时间和排序）
CREATE INDEX idx_banners_created_sort ON banners(created_at DESC, sort_order ASC);

-- 全文索引：用于搜索优化
CREATE FULLTEXT INDEX ft_banners_search ON banners(title, description);

-- 8. 为favorites表添加索引（基于代码分析）

-- 复合索引：user_id + created_at（按用户和时间排序）
CREATE INDEX idx_favorites_user_created ON favorites(user_id, created_at DESC);

-- 复合索引：user_id + item_id + type（收藏项查询）
CREATE INDEX idx_favorites_user_item_type ON favorites(user_id, item_id, type);

-- 复合索引：item_id + type + user_id（反向查询）
CREATE INDEX idx_favorites_item_type_user ON favorites(item_id, type, user_id);

-- 全文索引：用于搜索优化
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

-- 10. 检查索引创建结果
SELECT 
    table_name,
    index_name,
    column_name,
    seq_in_index,
    index_type
FROM information_schema.statistics 
WHERE table_schema = 'data' 
AND table_name IN ('digital_artworks', 'wx_users', 'artists', 'user_sessions', 'institutions', 'physical_categories', 'banners', 'favorites')
ORDER BY table_name, index_name, seq_in_index;

-- 11. 测试实际查询性能
-- 测试digital_artworks查询：ORDER BY created_at DESC
EXPLAIN SELECT 
    da.id, da.title, da.image_url, da.description, da.price, da.created_at,
    a.id as artist_id, a.name as artist_name, a.avatar as artist_avatar
FROM digital_artworks da FORCE INDEX (idx_digital_artworks_created_at)
LEFT JOIN artists a ON da.artist_id = a.id
ORDER BY da.created_at DESC 
LIMIT 20 OFFSET 0;

-- 测试wx_users查询：WHERE openid = ?
EXPLAIN SELECT id, openid, nickname, avatar, phone, created_at, updated_at 
FROM wx_users FORCE INDEX (openid)
WHERE openid = 'test_openid';

-- 测试artists查询：ORDER BY created_at DESC
EXPLAIN SELECT 
    a.*,
    i.id as institution_id,
    i.name as institution_name,
    i.logo as institution_logo,
    i.description as institution_description
FROM artists a FORCE INDEX (idx_artists_created_at)
LEFT JOIN institutions i ON a.institution_id = i.id
ORDER BY a.created_at DESC;

-- 测试user_sessions查询：WHERE user_id = ?
EXPLAIN SELECT * FROM user_sessions FORCE INDEX (user_id)
WHERE user_id = 1;

-- 测试institutions查询：ORDER BY created_at DESC
EXPLAIN SELECT * FROM institutions FORCE INDEX (idx_institutions_created_at)
ORDER BY created_at DESC;

-- 测试physical_categories查询：ORDER BY created_at DESC
EXPLAIN SELECT * FROM physical_categories FORCE INDEX (idx_physical_categories_created_at)
ORDER BY created_at DESC;

-- 测试banners查询：ORDER BY sort_order ASC
EXPLAIN SELECT * FROM banners FORCE INDEX (idx_banners_sort_order)
ORDER BY sort_order ASC;

-- 测试favorites查询：WHERE user_id = ?
EXPLAIN SELECT * FROM favorites FORCE INDEX (idx_user_id)
WHERE user_id = 1;

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
