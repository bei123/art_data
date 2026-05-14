-- 控制艺术家与原作是否在公开接口展示（默认展示；管理员仍可在后台查看与编辑）
ALTER TABLE artists ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE original_artworks ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 1;
