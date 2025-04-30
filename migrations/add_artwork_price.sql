-- 为艺术品表添加价格字段
ALTER TABLE original_artworks
ADD COLUMN original_price DECIMAL(10,2) DEFAULT 0.00 COMMENT '艺术品原价',
ADD COLUMN discount_price DECIMAL(10,2) DEFAULT 0.00 COMMENT '艺术品折扣价',
ADD COLUMN is_on_sale TINYINT(1) DEFAULT 1 COMMENT '是否在售：1-在售，0-下架',
ADD COLUMN stock INT DEFAULT 0 COMMENT '库存数量',
ADD COLUMN sales INT DEFAULT 0 COMMENT '销量';

-- 添加索引
CREATE INDEX idx_artwork_price ON original_artworks(price);
CREATE INDEX idx_artwork_sale ON original_artworks(is_on_sale); 