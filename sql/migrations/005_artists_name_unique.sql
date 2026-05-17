-- 艺术家姓名唯一，防止 WMS 并发同步或重复提交插入同名记录
-- 若执行失败（已有重名），请先合并重复行再执行；示例见下方注释

-- 合并原作上的 artist_id 到每组同名里最小的 id
UPDATE original_artworks oa
INNER JOIN artists a ON a.id = oa.artist_id
INNER JOIN (
  SELECT name, MIN(id) AS keep_id
  FROM artists
  GROUP BY name
  HAVING COUNT(*) > 1
) keeper ON keeper.name = a.name AND a.id <> keeper.keep_id
SET oa.artist_id = keeper.keep_id;

UPDATE artist_featured_artworks afa
INNER JOIN artists a ON a.id = afa.artist_id
INNER JOIN (
  SELECT name, MIN(id) AS keep_id
  FROM artists
  GROUP BY name
  HAVING COUNT(*) > 1
) keeper ON keeper.name = a.name AND a.id <> keeper.keep_id
SET afa.artist_id = keeper.keep_id;

DELETE a FROM artists a
INNER JOIN (
  SELECT name, MIN(id) AS keep_id
  FROM artists
  GROUP BY name
  HAVING COUNT(*) > 1
) keeper ON keeper.name = a.name AND a.id <> keeper.keep_id;

ALTER TABLE artists ADD UNIQUE INDEX uk_artists_name (name);
