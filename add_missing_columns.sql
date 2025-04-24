ALTER TABLE original_artworks 
ADD COLUMN year INT AFTER title,
ADD COLUMN background TEXT AFTER description,
ADD COLUMN features TEXT AFTER background,
ADD COLUMN collection_location VARCHAR(255) AFTER features,
ADD COLUMN collection_number VARCHAR(100) AFTER collection_location,
ADD COLUMN collection_size VARCHAR(100) AFTER collection_number,
ADD COLUMN collection_material VARCHAR(100) AFTER collection_size; 