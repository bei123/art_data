-- 修改 type 字段的类型为 ENUM
ALTER TABLE cart_items
MODIFY COLUMN type ENUM('right', 'digital', 'artwork') NOT NULL DEFAULT 'right' COMMENT '商品类型：right-实物商品，digital-数字艺术品，artwork-艺术品'; 