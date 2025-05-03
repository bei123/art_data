-- 添加artwork_id字段到order_items表
ALTER TABLE order_items
ADD COLUMN artwork_id INT DEFAULT NULL COMMENT '艺术品ID',
ADD FOREIGN KEY (artwork_id) REFERENCES original_artworks(id) ON DELETE CASCADE;

-- 添加索引
CREATE INDEX idx_order_artwork ON order_items(artwork_id); 