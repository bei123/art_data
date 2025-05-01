-- 选择数据库
USE art_data;

-- 创建收藏表
CREATE TABLE IF NOT EXISTS favorites (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    item_id INT NOT NULL,
    item_type ENUM('artwork', 'digital_art', 'copyright_item') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES wx_users(id) ON DELETE CASCADE,
    -- 添加唯一索引，防止重复收藏
    UNIQUE KEY unique_favorite (user_id, item_id, item_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 添加索引以提高查询性能
CREATE INDEX idx_user_id ON favorites(user_id);
CREATE INDEX idx_item_id_type ON favorites(item_id, item_type); 