-- 已执行过旧版 001（无 add_source / wx_appid）时出现 Unknown column 'add_source'，请在本库执行一次：
-- mysql -u... -p... your_db < sql/migrations/002_order_shipments_add_source_wx_appid.sql
--
-- 若某列已存在会报 Duplicate column，可忽略该条或注释掉对应 ALTER 后重跑。

ALTER TABLE order_shipments
  ADD COLUMN add_source TINYINT NOT NULL DEFAULT 0
  COMMENT '0=小程序 openid；2=wx_appid（与下单 add_source 一致）'
  AFTER insured_value_fen;

ALTER TABLE order_shipments
  ADD COLUMN wx_appid VARCHAR(64) NULL
  COMMENT 'add_source=2 时下单所用 wx_appid，查轨迹时需带回'
  AFTER add_source;
