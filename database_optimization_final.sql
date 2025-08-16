-- 最终数据库优化脚本
-- 直接执行剩余的索引创建

USE data;

-- 继续创建剩余的索引（跳过已存在的）
-- 为digital_artworks表添加索引
CREATE INDEX idx_digital_artworks_title ON digital_artworks(title);
CREATE INDEX idx_digital_artworks_description ON digital_artworks(description);

-- 为rights表添加索引
CREATE INDEX idx_rights_status ON rights(status);
CREATE INDEX idx_rights_category_id ON rights(category_id);
CREATE INDEX idx_rights_title ON rights(title);

-- 为order_items表添加索引
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_type ON order_items(type);
CREATE INDEX idx_order_items_right_id ON order_items(right_id);
CREATE INDEX idx_order_items_digital_id ON order_items(digital_artwork_id);
CREATE INDEX idx_order_items_artwork_id ON order_items(artwork_id);

-- 为wx_users表添加索引
CREATE INDEX idx_wx_users_openid ON wx_users(openid);
CREATE INDEX idx_wx_users_unionid ON wx_users(unionid);

-- 为其他相关表添加索引
CREATE INDEX idx_right_images_right_id ON right_images(right_id);
CREATE INDEX idx_wx_user_addresses_user_id ON wx_user_addresses(user_id);
CREATE INDEX idx_merchant_images_merchant_id ON merchant_images(merchant_id);

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
