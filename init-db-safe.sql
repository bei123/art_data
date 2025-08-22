-- 安全的数据库初始化脚本
-- 创建用户认证相关的表结构

-- 角色表
CREATE TABLE IF NOT EXISTS `roles` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL COMMENT '角色名称',
  `description` varchar(255) DEFAULT NULL COMMENT '角色描述',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户角色表';

-- 用户表
CREATE TABLE IF NOT EXISTS `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL COMMENT '用户名',
  `email` varchar(100) NOT NULL COMMENT '邮箱',
  `password_hash` varchar(255) NOT NULL COMMENT '密码哈希',
  `role_id` int(11) NOT NULL COMMENT '角色ID',
  `status` enum('active','inactive','banned') NOT NULL DEFAULT 'active' COMMENT '用户状态',
  `last_login` timestamp NULL DEFAULT NULL COMMENT '最后登录时间',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`),
  UNIQUE KEY `uk_email` (`email`),
  KEY `idx_role_id` (`role_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `fk_users_role_id` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

-- 用户会话表
CREATE TABLE IF NOT EXISTS `user_sessions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL COMMENT '用户ID',
  `token` varchar(500) NOT NULL COMMENT 'JWT token',
  `expires_at` timestamp NOT NULL COMMENT '过期时间',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_token` (`token`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_expires_at` (`expires_at`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `fk_sessions_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户会话表';

-- 插入默认角色
INSERT IGNORE INTO `roles` (`name`, `description`) VALUES
('user', '普通用户'),
('admin', '管理员'),
('super_admin', '超级管理员');

-- 插入默认超级管理员用户（密码: admin123）
-- 注意：在实际部署时应该修改这个密码
INSERT IGNORE INTO `users` (`username`, `email`, `password_hash`, `role_id`, `status`) VALUES
('admin', 'admin@example.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj3bp.gS.Oi.', 3, 'active');

-- 创建存储过程来安全地创建索引
DELIMITER $$

CREATE PROCEDURE CreateIndexIfNotExists(
    IN tableName VARCHAR(64),
    IN indexName VARCHAR(64),
    IN indexColumns VARCHAR(255)
)
BEGIN
    DECLARE indexExists INT DEFAULT 0;
    
    -- 检查索引是否存在
    SELECT COUNT(1) INTO indexExists
    FROM information_schema.statistics 
    WHERE table_schema = DATABASE()
    AND table_name = tableName
    AND index_name = indexName;
    
    -- 如果索引不存在，则创建
    IF indexExists = 0 THEN
        SET @sql = CONCAT('CREATE INDEX `', indexName, '` ON `', tableName, '` (', indexColumns, ')');
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
        SELECT CONCAT('Index ', indexName, ' created successfully') AS result;
    ELSE
        SELECT CONCAT('Index ', indexName, ' already exists') AS result;
    END IF;
END$$

DELIMITER ;

-- 使用存储过程创建索引
CALL CreateIndexIfNotExists('users', 'idx_users_username_email', '`username`, `email`');
CALL CreateIndexIfNotExists('user_sessions', 'idx_sessions_user_expires', '`user_id`, `expires_at`');
CALL CreateIndexIfNotExists('user_sessions', 'idx_sessions_token_expires', '`token`, `expires_at`');

-- 删除存储过程
DROP PROCEDURE IF EXISTS CreateIndexIfNotExists;

-- 显示创建结果
SELECT 'Database initialization completed successfully!' AS status;
