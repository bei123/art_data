-- 为 external_users 表添加缺失的字段
ALTER TABLE `external_users`
ADD COLUMN `token` TEXT DEFAULT NULL COMMENT '用户token（来自user.token）' AFTER `refresh_token`,
ADD COLUMN `ws_stoken` VARCHAR(255) DEFAULT NULL COMMENT 'WebSocket stoken（来自user.wsStoken）' AFTER `ws_token`,
ADD COLUMN `client_id` VARCHAR(50) DEFAULT NULL COMMENT '客户端ID' AFTER `channel`,
ADD COLUMN `privileges` TEXT DEFAULT NULL COMMENT '用户权限列表（JSON数组）' AFTER `client_id`,
ADD COLUMN `expire` VARCHAR(20) DEFAULT NULL COMMENT 'token过期时间（秒）' AFTER `access_token`,
ADD COLUMN `app_type` VARCHAR(10) DEFAULT NULL COMMENT '应用类型' AFTER `expire`,
ADD COLUMN `app_type_name` VARCHAR(50) DEFAULT NULL COMMENT '应用类型名称' AFTER `app_type`,
ADD COLUMN `set_password` TINYINT(1) DEFAULT 0 COMMENT '是否已设置密码' AFTER `app_type_name`;

