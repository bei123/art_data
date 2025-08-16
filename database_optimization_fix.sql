-- 数据库性能优化修复脚本
-- 执行这些SQL语句来修复全表扫描问题

USE data;

-- 1. 为orders表添加缺失的索引
CREATE INDEX IF NOT EXISTS idx_orders_trade_state ON orders(trade_state);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_user_state ON orders(user_id, trade_state);
CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC);

-- 2. 为artists表添加搜索索引
CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name);

-- 3. 为digital_artworks表添加索引（如果不存在）
CREATE INDEX IF NOT EXISTS idx_digital_artworks_artist_id ON digital_artworks(artist_id);
CREATE INDEX IF NOT EXISTS idx_digital_artworks_title ON digital_artworks(title(255));
CREATE INDEX IF NOT EXISTS idx_digital_artworks_description ON digital_artworks(description(255));

-- 4. 为rights表添加索引（如果不存在）
CREATE INDEX IF NOT EXISTS idx_rights_status ON rights(status);
CREATE INDEX IF NOT EXISTS idx_rights_category_id ON rights(category_id);
CREATE INDEX IF NOT EXISTS idx_rights_title ON rights(title(255));

-- 5. 为order_items表添加索引（如果不存在）
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_type ON order_items(type);
CREATE INDEX IF NOT EXISTS idx_order_items_right_id ON order_items(right_id);
CREATE INDEX IF NOT EXISTS idx_order_items_digital_id ON order_items(digital_artwork_id);
CREATE INDEX IF NOT EXISTS idx_order_items_artwork_id ON order_items(artwork_id);

-- 6. 为wx_users表添加索引（如果不存在）
CREATE INDEX IF NOT EXISTS idx_wx_users_openid ON wx_users(openid);
CREATE INDEX IF NOT EXISTS idx_wx_users_unionid ON wx_users(unionid);

-- 7. 为其他相关表添加索引
CREATE INDEX IF NOT EXISTS idx_right_images_right_id ON right_images(right_id);
CREATE INDEX IF NOT EXISTS idx_wx_user_addresses_user_id ON wx_user_addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_merchant_images_merchant_id ON merchant_images(merchant_id);

-- 8. 分析表统计信息
ANALYZE TABLE original_artworks;
ANALYZE TABLE orders;
ANALYZE TABLE cart_items;
ANALYZE TABLE artists;
ANALYZE TABLE digital_artworks;
ANALYZE TABLE rights;
ANALYZE TABLE order_items;
ANALYZE TABLE wx_users;

-- 9. 检查索引创建结果
SELECT 
    table_name,
    index_name,
    column_name,
    index_type
FROM information_schema.statistics 
WHERE table_schema = 'data' 
AND table_name IN ('original_artworks', 'orders', 'cart_items', 'artists', 'digital_artworks', 'rights', 'order_items', 'wx_users')
ORDER BY table_name, index_name;

-- 10. 性能测试查询
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
