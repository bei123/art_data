-- 微信物流下单成功后写入；管理端订单详情联查；取消运单时 status=cancelled
-- 执行：mysql -u... -p... your_db < sql/migrations/001_order_shipments.sql
-- 若表早已建好但缺 add_source / wx_appid，另执行：002_order_shipments_add_source_wx_appid.sql

CREATE TABLE IF NOT EXISTS order_shipments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL COMMENT 'orders.id',
  delivery_id VARCHAR(64) NOT NULL COMMENT '快递公司编码，如 SF',
  waybill_id VARCHAR(128) NOT NULL COMMENT '运单号',
  wechat_order_id VARCHAR(512) NULL COMMENT '微信物流 order_id（下单传入或微信返回）',
  biz_id VARCHAR(64) NULL,
  service_type INT NULL,
  service_name VARCHAR(128) NULL,
  use_insured TINYINT(1) NOT NULL DEFAULT 0,
  insured_value_fen INT NOT NULL DEFAULT 0 COMMENT '保价金额（分），与下单 insured.insured_value 一致',
  add_source TINYINT NOT NULL DEFAULT 0 COMMENT '0=小程序 openid；2=wx_appid（与下单 add_source 一致）',
  wx_appid VARCHAR(64) NULL COMMENT 'add_source=2 时下单所用 wx_appid，查轨迹时需带回',
  waybill_data_json JSON NULL COMMENT '微信返回 waybill_data 子单等',
  company_name VARCHAR(128) NULL COMMENT '可选：快递公司展示名',
  status VARCHAR(24) NOT NULL DEFAULT 'active' COMMENT 'active | cancelled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_order_shipments_order (order_id),
  KEY idx_order_shipments_status (order_id, status),
  KEY idx_order_shipments_waybill (delivery_id, waybill_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
