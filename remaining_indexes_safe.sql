-- 为剩余的全表扫描表添加精确索引（安全版本）
-- 跳过已存在的索引，只创建缺失的索引

USE data;

-- 1. 为real_name_registrations表添加索引

-- 检查并创建索引（如果不存在）
-- 主要查询模式：WHERE user_id = ? (用于查询用户实名认证信息)
-- CREATE INDEX idx_real_name_registrations_user_id ON real_name_registrations(user_id);

-- 复合索引：user_id + is_verified (用于按用户和验证状态查询)
CREATE INDEX idx_real_name_registrations_user_verified ON real_name_registrations(user_id, is_verified);

-- 复合索引：is_verified + created_at (用于按验证状态和时间排序)
CREATE INDEX idx_real_name_registrations_verified_created ON real_name_registrations(is_verified, created_at DESC);

-- 复合索引：type + created_at (用于按类型和时间排序)
CREATE INDEX idx_real_name_registrations_type_created ON real_name_registrations(type, created_at DESC);

-- 2. 为merchant_images表添加索引

-- 复合索引：merchant_id + sort_order (用于按商家ID和排序查询)
CREATE INDEX idx_merchant_images_merchant_sort ON merchant_images(merchant_id, sort_order);

-- 复合索引：merchant_id + created_at (用于按商家ID和时间排序)
CREATE INDEX idx_merchant_images_merchant_created ON merchant_images(merchant_id, created_at DESC);

-- 3. 为merchants表添加索引

-- 主要查询模式：WHERE status = 'active' (用于查询活跃商家)
CREATE INDEX idx_merchants_status ON merchants(status);

-- 复合索引：status + sort_order (用于按状态和排序查询)
CREATE INDEX idx_merchants_status_sort ON merchants(status, sort_order);

-- 复合索引：status + created_at (用于按状态和时间排序)
CREATE INDEX idx_merchants_status_created ON merchants(status, created_at DESC);

-- 复合索引：status + updated_at (用于按状态和更新时间排序)
CREATE INDEX idx_merchants_status_updated ON merchants(status, updated_at DESC);

-- 复合索引：name + status (用于按名称和状态查询)
CREATE INDEX idx_merchants_name_status ON merchants(name, status);

-- 复合索引：phone + status (用于按电话和状态查询)
CREATE INDEX idx_merchants_phone_status ON merchants(phone, status);

-- 复合索引：id + status (用于按ID和状态查询)
CREATE INDEX idx_merchants_id_status ON merchants(id, status);

-- 4. 为refund_requests表添加索引

-- 复合索引：status + created_at (用于按状态和时间排序)
CREATE INDEX idx_refund_requests_status_created ON refund_requests(status, created_at DESC);

-- 复合索引：status + id (用于按状态和ID查询)
CREATE INDEX idx_refund_requests_status_id ON refund_requests(status, id);

-- 复合索引：out_trade_no + status (用于按订单号和状态查询)
CREATE INDEX idx_refund_requests_trade_status ON refund_requests(out_trade_no, status);

-- 复合索引：out_refund_no + status (用于按退款号和状态查询)
CREATE INDEX idx_refund_requests_refund_status ON refund_requests(out_refund_no, status);

-- 5. 为wx_user_addresses表添加索引

-- 复合索引：user_id + is_default (用于查询用户默认地址)
CREATE INDEX idx_wx_user_addresses_user_default ON wx_user_addresses(user_id, is_default);

-- 复合索引：user_id + created_at (用于按用户和时间排序)
CREATE INDEX idx_wx_user_addresses_user_created ON wx_user_addresses(user_id, created_at DESC);

-- 复合索引：user_id + id (用于按用户和ID查询)
CREATE INDEX idx_wx_user_addresses_user_id_order ON wx_user_addresses(user_id, id);

-- 6. 分析表统计信息
ANALYZE TABLE real_name_registrations;
ANALYZE TABLE merchant_images;
ANALYZE TABLE merchants;
ANALYZE TABLE refund_requests;
ANALYZE TABLE wx_user_addresses;

-- 7. 检查索引创建结果
SELECT 
    table_name,
    index_name,
    column_name,
    seq_in_index,
    index_type
FROM information_schema.statistics 
WHERE table_schema = 'data' 
AND table_name IN ('real_name_registrations', 'merchant_images', 'merchants', 'refund_requests', 'wx_user_addresses')
ORDER BY table_name, index_name, seq_in_index;

-- 8. 测试实际查询性能
-- 测试merchants查询：WHERE status = 'active'
EXPLAIN SELECT id, name, logo, description, address, phone, status, created_at, updated_at 
FROM merchants 
WHERE status = 'active'
ORDER BY created_at DESC
LIMIT 20 OFFSET 0;

-- 测试merchant_images查询：WHERE merchant_id IN (?)
EXPLAIN SELECT merchant_id, image_url 
FROM merchant_images 
WHERE merchant_id IN (1,2,3);

-- 测试refund_requests查询：WHERE status = ?
EXPLAIN SELECT * FROM refund_requests 
WHERE status = 'PENDING'
ORDER BY created_at DESC
LIMIT 20 OFFSET 0;

-- 测试wx_user_addresses查询：WHERE user_id = ?
EXPLAIN SELECT * FROM wx_user_addresses 
WHERE user_id = 1;

-- 测试real_name_registrations查询：WHERE user_id = ?
EXPLAIN SELECT * FROM real_name_registrations 
WHERE user_id = 1;

-- 9. 检查当前全表扫描情况
SELECT 
    OBJECT_NAME as table_name,
    COUNT_STAR as full_table_scans,
    SUM_TIMER_WAIT as total_wait_time,
    AVG_TIMER_WAIT as avg_wait_time
FROM performance_schema.table_io_waits_summary_by_index_usage 
WHERE index_name IS NULL 
AND count_star > 0 
AND object_schema = 'data'
AND OBJECT_NAME IN ('real_name_registrations', 'merchant_images', 'merchants', 'refund_requests', 'wx_user_addresses')
ORDER BY count_star DESC;

-- 10. 检查索引使用情况
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
AND OBJECT_NAME IN ('real_name_registrations', 'merchant_images', 'merchants', 'refund_requests', 'wx_user_addresses')
ORDER BY count_star DESC;
