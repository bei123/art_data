-- 继续执行数据库优化脚本
-- 从上次停止的地方继续

USE data;

-- 创建存储过程来安全地添加索引
DELIMITER //
CREATE PROCEDURE AddIndexIfNotExists(
    IN tableName VARCHAR(64),
    IN indexName VARCHAR(64),
    IN indexDefinition TEXT
)
BEGIN
    DECLARE indexExists INT DEFAULT 0;
    
    -- 检查索引是否存在
    SELECT COUNT(*) INTO indexExists 
    FROM information_schema.statistics 
    WHERE table_schema = 'data' 
    AND table_name = tableName 
    AND index_name = indexName;
    
    -- 如果索引不存在，则创建
    IF indexExists = 0 THEN
        SET @sql = CONCAT('CREATE INDEX ', indexName, ' ON ', tableName, '(', indexDefinition, ')');
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
        SELECT CONCAT('Created index: ', indexName, ' on table: ', tableName) AS result;
    ELSE
        SELECT CONCAT('Index already exists: ', indexName, ' on table: ', tableName) AS result;
    END IF;
END //
DELIMITER ;

-- 继续创建剩余的索引
CALL AddIndexIfNotExists('digital_artworks', 'idx_digital_artworks_title', 'title');
CALL AddIndexIfNotExists('digital_artworks', 'idx_digital_artworks_description', 'description');

-- 为rights表添加索引
CALL AddIndexIfNotExists('rights', 'idx_rights_status', 'status');
CALL AddIndexIfNotExists('rights', 'idx_rights_category_id', 'category_id');
CALL AddIndexIfNotExists('rights', 'idx_rights_title', 'title');

-- 为order_items表添加索引
CALL AddIndexIfNotExists('order_items', 'idx_order_items_order_id', 'order_id');
CALL AddIndexIfNotExists('order_items', 'idx_order_items_type', 'type');
CALL AddIndexIfNotExists('order_items', 'idx_order_items_right_id', 'right_id');
CALL AddIndexIfNotExists('order_items', 'idx_order_items_digital_id', 'digital_artwork_id');
CALL AddIndexIfNotExists('order_items', 'idx_order_items_artwork_id', 'artwork_id');

-- 为wx_users表添加索引
CALL AddIndexIfNotExists('wx_users', 'idx_wx_users_openid', 'openid');
CALL AddIndexIfNotExists('wx_users', 'idx_wx_users_unionid', 'unionid');

-- 为其他相关表添加索引
CALL AddIndexIfNotExists('right_images', 'idx_right_images_right_id', 'right_id');
CALL AddIndexIfNotExists('wx_user_addresses', 'idx_wx_user_addresses_user_id', 'user_id');
CALL AddIndexIfNotExists('merchant_images', 'idx_merchant_images_merchant_id', 'merchant_id');

-- 删除存储过程
DROP PROCEDURE IF EXISTS AddIndexIfNotExists;

-- 分析表统计信息
ANALYZE TABLE original_artworks;
ANALYZE TABLE orders;
ANALYZE TABLE cart_items;
ANALYZE TABLE artists;
ANALYZE TABLE digital_artworks;
ANALYZE TABLE rights;
ANALYZE TABLE order_items;
ANALYZE TABLE wx_users;

-- 检查索引创建结果
SELECT 
    table_name,
    index_name,
    column_name,
    index_type
FROM information_schema.statistics 
WHERE table_schema = 'data' 
AND table_name IN ('original_artworks', 'orders', 'cart_items', 'artists', 'digital_artworks', 'rights', 'order_items', 'wx_users')
ORDER BY table_name, index_name;

-- 性能测试查询
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
