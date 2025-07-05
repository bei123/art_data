-- 创建微信小程序用户表
CREATE TABLE IF NOT EXISTS wx_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  openid VARCHAR(100) NOT NULL UNIQUE COMMENT '微信openid',
  session_key VARCHAR(255) COMMENT '微信session_key',
  nickname VARCHAR(100) COMMENT '用户昵称',
  avatar VARCHAR(255) COMMENT '用户头像',
  phone VARCHAR(20) COMMENT '手机号',
  password_hash VARCHAR(255) COMMENT '密码哈希',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_openid (openid),
  INDEX idx_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='微信小程序用户表'; 