-- 修改order_items表的type字段为ENUM类型
ALTER TABLE order_items
MODIFY COLUMN type ENUM('right', 'digital', 'artwork') NOT NULL DEFAULT 'right' COMMENT '商品类型：right-实物商品，digital-数字艺术品，artwork-艺术品'; 