USE data;

SET @dbname = 'data';
SET @tablename = 'digital_artworks';

-- 检查并添加 image_url 列
SET @columnname = 'image_url';
SET @sql = (
    SELECT IF(
        NOT EXISTS(
            SELECT * FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = @dbname
            AND TABLE_NAME = @tablename
            AND COLUMN_NAME = @columnname
        ),
        'ALTER TABLE digital_artworks ADD COLUMN image_url VARCHAR(255) AFTER description',
        'SELECT "image_url column already exists"'
    )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 检查并添加 contract_address 列
SET @columnname = 'contract_address';
SET @sql = (
    SELECT IF(
        NOT EXISTS(
            SELECT * FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = @dbname
            AND TABLE_NAME = @tablename
            AND COLUMN_NAME = @columnname
        ),
        'ALTER TABLE digital_artworks ADD COLUMN contract_address VARCHAR(255) AFTER image_url',
        'SELECT "contract_address column already exists"'
    )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 检查并添加 token_id 列
SET @columnname = 'token_id';
SET @sql = (
    SELECT IF(
        NOT EXISTS(
            SELECT * FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = @dbname
            AND TABLE_NAME = @tablename
            AND COLUMN_NAME = @columnname
        ),
        'ALTER TABLE digital_artworks ADD COLUMN token_id VARCHAR(100) AFTER contract_address',
        'SELECT "token_id column already exists"'
    )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 检查并添加 blockchain 列
SET @columnname = 'blockchain';
SET @sql = (
    SELECT IF(
        NOT EXISTS(
            SELECT * FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = @dbname
            AND TABLE_NAME = @tablename
            AND COLUMN_NAME = @columnname
        ),
        'ALTER TABLE digital_artworks ADD COLUMN blockchain VARCHAR(100) AFTER token_id',
        'SELECT "blockchain column already exists"'
    )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 检查并添加 blockchain_url 列
SET @columnname = 'blockchain_url';
SET @sql = (
    SELECT IF(
        NOT EXISTS(
            SELECT * FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = @dbname
            AND TABLE_NAME = @tablename
            AND COLUMN_NAME = @columnname
        ),
        'ALTER TABLE digital_artworks ADD COLUMN blockchain_url VARCHAR(255) AFTER blockchain',
        'SELECT "blockchain_url column already exists"'
    )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt; 