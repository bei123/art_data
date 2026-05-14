-- WMS 同步：作品与 REBUILD Product 记录幂等关联、增量游标
-- 执行：mysql -h... -u... -p... your_db < sql/migrations/003_original_artworks_wms.sql
-- 若列或索引已存在会报错，可拆行单独执行或忽略重复错误

ALTER TABLE original_artworks
  ADD COLUMN wms_record_id VARCHAR(64) NULL COMMENT 'WMS Product recordId，如 988-019cc33420f40333',
  ADD COLUMN wms_last_modified BIGINT UNSIGNED NULL COMMENT 'WMS view-model data.lastModified（毫秒）',
  ADD UNIQUE KEY uk_original_artworks_wms_record_id (wms_record_id);
