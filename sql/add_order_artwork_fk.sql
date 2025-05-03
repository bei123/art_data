-- 为order_items表的artwork_id添加外键约束
ALTER TABLE order_items
ADD FOREIGN KEY (artwork_id) REFERENCES original_artworks(id) ON DELETE CASCADE;

-- 添加索引
CREATE INDEX idx_order_artwork ON order_items(artwork_id); 