USE data;

-- 删除不需要的列
ALTER TABLE digital_artworks
DROP COLUMN contract_address,
DROP COLUMN token_id,
DROP COLUMN blockchain,
DROP COLUMN blockchain_url,
DROP COLUMN copyright;

-- 添加新的列
ALTER TABLE digital_artworks
ADD COLUMN registration_certificate VARCHAR(255) AFTER description,
ADD COLUMN license_rights TEXT AFTER registration_certificate,
ADD COLUMN license_period VARCHAR(100) AFTER license_rights,
ADD COLUMN owner_rights TEXT AFTER license_period,
ADD COLUMN license_items TEXT AFTER owner_rights,
ADD COLUMN project_name VARCHAR(200) AFTER license_items,
ADD COLUMN product_name VARCHAR(200) AFTER project_name,
ADD COLUMN project_owner VARCHAR(200) AFTER product_name,
ADD COLUMN issuer VARCHAR(200) AFTER project_owner,
ADD COLUMN issue_batch VARCHAR(100) AFTER issuer,
ADD COLUMN issue_year INT AFTER issue_batch,
ADD COLUMN batch_quantity INT AFTER issue_year; 