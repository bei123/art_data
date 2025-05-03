-- 添加购物车表新字段
ALTER TABLE cart_items
ADD COLUMN price DECIMAL(10,2) DEFAULT 0.00 COMMENT '商品价格',
ADD COLUMN artwork_id INT DEFAULT NULL COMMENT '艺术品ID',
ADD FOREIGN KEY (artwork_id) REFERENCES original_artworks(id) ON DELETE CASCADE;

-- 添加索引
CREATE INDEX idx_cart_artwork ON cart_items(artwork_id);
CREATE INDEX idx_cart_user_type ON cart_items(user_id, type); 