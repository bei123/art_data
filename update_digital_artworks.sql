ALTER TABLE digital_artworks
DROP COLUMN copyright,
ADD COLUMN contract_address VARCHAR(255) AFTER image_url,
ADD COLUMN token_id VARCHAR(100) AFTER contract_address,
ADD COLUMN blockchain VARCHAR(100) AFTER token_id,
ADD COLUMN blockchain_url VARCHAR(255) AFTER blockchain; 