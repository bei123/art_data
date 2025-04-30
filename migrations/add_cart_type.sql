-- 添加 type 字段到购物车表
ALTER TABLE cart_items
ADD COLUMN type ENUM('right', 'digital', 'artwork') NOT NULL DEFAULT 'right' COMMENT '商品类型：right-实物商品，digital-数字艺术品，artwork-艺术品';

-- 添加索引
CREATE INDEX idx_cart_type ON cart_items(type); 