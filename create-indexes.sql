-- 手动创建索引脚本
-- 在表创建完成后单独执行此脚本来添加额外的索引

-- 为users表创建复合索引（如果不存在）
-- 如果执行失败，说明索引已存在，可以忽略错误

-- 为用户名和邮箱创建复合索引
CREATE INDEX `idx_users_username_email` ON `users` (`username`, `email`);

-- 为user_sessions表创建复合索引
CREATE INDEX `idx_sessions_user_expires` ON `user_sessions` (`user_id`, `expires_at`);
CREATE INDEX `idx_sessions_token_expires` ON `user_sessions` (`token`, `expires_at`);

-- 显示结果
SELECT 'Indexes created successfully!' AS status;
