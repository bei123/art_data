const db = require('../db');
const redisClient = require('../utils/redisClient');
const logger = require('../utils/logger');
const { processObjectImages } = require('../utils/image');
const { validatePublicImageUrl: validateImageUrl } = require('../config/publicEnv');

const REDIS_ARTISTS_LIST_KEY = 'artists:list';
const REDIS_ARTIST_DETAIL_KEY_PREFIX = 'artists:detail:';

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body };
}

function parsePositiveIntId(raw) {
  const id = parseInt(String(raw), 10);
  if (Number.isNaN(id) || id <= 0) return null;
  return id;
}

/** 清除全量艺术家列表缓存（GET /api/artists 无 institution_id 时走 Redis `artists:list`） */
async function invalidateArtistsListCache() {
  try {
    await redisClient.del(REDIS_ARTISTS_LIST_KEY);
  } catch (e) {
    logger.error('invalidate_artists_list_cache_failed', { err: e });
  }
}

/**
 * 公开列表：支持 ?institution_id= 或全量（带 Redis 列表缓存）
 * @returns {{ ok: true, status: number, body: object|Array } | { ok: false, status: number, body: { error: string } }}
 */
async function getPublicArtistsList(query) {
  const { institution_id } = query || {};

  if (institution_id) {
    const institutionId = parseInt(institution_id, 10);
    if (Number.isNaN(institutionId) || institutionId <= 0) {
      return adminResult(400, { error: '无效的机构ID' });
    }
    const [institutionRows] = await db.query('SELECT id, name FROM institutions WHERE id = ?', [institutionId]);
    if (!institutionRows.length) {
      return adminResult(404, { error: '机构不存在' });
    }
    const [rows] = await db.query(
      `
        SELECT 
          a.*,
          i.id as institution_id,
          i.name as institution_name,
          i.logo as institution_logo,
          i.description as institution_description
        FROM artists a
        LEFT JOIN institutions i ON a.institution_id = i.id
        WHERE a.institution_id = ?
        ORDER BY a.created_at DESC
      `,
      [institutionId]
    );
    const artistsWithProcessedImages = (rows || []).map((artist) => {
      const processedArtist = processObjectImages(artist, ['avatar', 'banner']);
      return {
        ...processedArtist,
        achievements: artist.achievements ? JSON.parse(artist.achievements) : [],
        institution: artist.institution_id
          ? {
              id: artist.institution_id,
              name: artist.institution_name,
              logo: artist.institution_logo,
              description: artist.institution_description,
            }
          : null,
      };
    });
    return adminResult(200, {
      institution: {
        id: institutionRows[0].id,
        name: institutionRows[0].name,
      },
      artists: artistsWithProcessedImages,
      total: artistsWithProcessedImages.length,
    });
  }

  try {
    const cache = await redisClient.get(REDIS_ARTISTS_LIST_KEY);
    if (cache) {
      return adminResult(200, JSON.parse(cache));
    }
  } catch (e) {
    logger.error('Redis 读取艺术家列表失败', { err: e });
  }

  const [rows] = await db.query(`
    SELECT 
      a.*,
      i.id as institution_id,
      i.name as institution_name,
      i.logo as institution_logo,
      i.description as institution_description
    FROM artists a
    LEFT JOIN institutions i ON a.institution_id = i.id
    ORDER BY a.created_at DESC
  `);

  const artistsWithProcessedImages = (rows || []).map((artist) => {
    const processedArtist = processObjectImages(artist, ['avatar', 'banner']);
    return {
      ...processedArtist,
      achievements: artist.achievements ? JSON.parse(artist.achievements) : [],
      institution: artist.institution_id
        ? {
            id: artist.institution_id,
            name: artist.institution_name,
            logo: artist.institution_logo,
            description: artist.institution_description,
          }
        : null,
    };
  });

  try {
    await redisClient.set(REDIS_ARTISTS_LIST_KEY, JSON.stringify(artistsWithProcessedImages));
  } catch (e) {
    logger.error('Redis 写入艺术家列表失败', { err: e });
  }
  return adminResult(200, artistsWithProcessedImages);
}

async function getPublicArtistDetail(rawId) {
  const id = parsePositiveIntId(rawId);
  if (!id) return adminResult(400, { error: '无效的艺术家ID' });
  try {
    const cache = await redisClient.get(REDIS_ARTIST_DETAIL_KEY_PREFIX + id);
    if (cache) {
      return adminResult(200, JSON.parse(cache));
    }
  } catch (e) {
    logger.error('Redis 读取艺术家详情失败', { err: e });
  }

  const [rows] = await db.query(
    `
      SELECT 
        a.*,
        i.id as institution_id,
        i.name as institution_name,
        i.logo as institution_logo,
        i.description as institution_description
      FROM artists a
      LEFT JOIN institutions i ON a.institution_id = i.id
      WHERE a.id = ?
    `,
    [id]
  );

  if (!rows || rows.length === 0) {
    return adminResult(404, { error: '艺术家不存在' });
  }

  const artist = processObjectImages(rows[0], ['avatar', 'banner']);
  const artistWithInstitution = {
    ...artist,
    achievements: artist.achievements ? JSON.parse(artist.achievements) : [],
    institution: artist.institution_id
      ? {
          id: artist.institution_id,
          name: artist.institution_name,
          logo: artist.institution_logo,
          description: artist.institution_description,
        }
      : null,
  };

  try {
    await redisClient.set(REDIS_ARTIST_DETAIL_KEY_PREFIX + id, JSON.stringify(artistWithInstitution));
  } catch (e) {
    logger.error('Redis 写入艺术家详情失败', { err: e });
  }
  return adminResult(200, artistWithInstitution);
}

async function createArtistAdmin(body) {
  const { avatar, name, description, institution_id } = body || {};
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return adminResult(400, { error: '艺术家名称不能为空' });
  }
  if (name.length > 100) {
    return adminResult(400, { error: '艺术家名称长度不能超过100个字符' });
  }
  if (description && description.length > 2000) {
    return adminResult(400, { error: '描述长度不能超过2000个字符' });
  }
  if (institution_id) {
    const institutionId = parseInt(institution_id, 10);
    if (Number.isNaN(institutionId) || institutionId <= 0) {
      return adminResult(400, { error: '无效的机构ID' });
    }
    const [institutionRows] = await db.query('SELECT id FROM institutions WHERE id = ?', [institutionId]);
    if (institutionRows.length === 0) {
      return adminResult(400, { error: '指定的机构不存在' });
    }
  }
  const cleanName = name.trim();
  const cleanDescription = description ? description.trim() : '';
  try {
    const [result] = await db.query(
      'INSERT INTO artists (avatar, name, description, institution_id) VALUES (?, ?, ?, ?)',
      [avatar, cleanName, cleanDescription, institution_id || null]
    );
    await invalidateArtistsListCache();
    return adminResult(200, {
      id: result.insertId,
      name: cleanName,
      description: cleanDescription,
      avatar,
      institution_id: institution_id || null,
    });
  } catch (e) {
    logger.error('createArtistAdmin failed', { err: e });
    return adminResult(500, { error: '创建艺术家服务暂时不可用' });
  }
}

async function updateArtistAdmin(rawId, body) {
  const artistRowId = parsePositiveIntId(rawId);
  if (!artistRowId) return adminResult(400, { error: '无效的艺术家ID' });

  const { name, era, avatar, banner, description, biography, journey, institution_id, achievements } = body || {};
  const updateData = {};
  if (name !== undefined && name !== null) updateData.name = name;
  if (era !== undefined && era !== null) updateData.era = era;
  if (avatar !== undefined && avatar !== null) updateData.avatar = avatar;
  if (banner !== undefined && banner !== null) updateData.banner = banner;
  if (description !== undefined && description !== null) updateData.description = description;
  if (biography !== undefined && biography !== null) updateData.biography = biography;
  if (journey !== undefined && journey !== null) updateData.journey = journey;
  if (institution_id !== undefined && institution_id !== null) updateData.institution_id = institution_id;
  if (achievements !== undefined && achievements !== null) updateData.achievements = achievements;

  if (avatar && !validateImageUrl(avatar)) {
    return adminResult(400, { error: '无效的头像URL' });
  }
  if (banner && !validateImageUrl(banner)) {
    return adminResult(400, { error: '无效的背景图URL' });
  }
  if (institution_id) {
    const institutionId = parseInt(institution_id, 10);
    if (Number.isNaN(institutionId) || institutionId <= 0) {
      return adminResult(400, { error: '无效的机构ID' });
    }
    const [institutionRows] = await db.query('SELECT id FROM institutions WHERE id = ?', [institutionId]);
    if (institutionRows.length === 0) {
      return adminResult(400, { error: '指定的机构不存在' });
    }
  }

  const updateFields = [];
  const updateValues = [];
  if (updateData.name !== undefined) {
    updateFields.push('name = ?');
    updateValues.push(updateData.name);
  }
  if (updateData.era !== undefined) {
    updateFields.push('era = ?');
    updateValues.push(updateData.era);
  }
  if (updateData.avatar !== undefined) {
    updateFields.push('avatar = ?');
    updateValues.push(updateData.avatar);
  }
  if (updateData.banner !== undefined) {
    updateFields.push('banner = ?');
    updateValues.push(updateData.banner);
  }
  if (updateData.description !== undefined) {
    updateFields.push('description = ?');
    updateValues.push(updateData.description);
  }
  if (updateData.biography !== undefined) {
    updateFields.push('biography = ?');
    updateValues.push(updateData.biography);
  }
  if (updateData.journey !== undefined) {
    updateFields.push('journey = ?');
    updateValues.push(updateData.journey);
  }
  if (updateData.institution_id !== undefined) {
    updateFields.push('institution_id = ?');
    updateValues.push(updateData.institution_id);
  }
  if (updateData.achievements !== undefined) {
    updateFields.push('achievements = ?');
    updateValues.push(updateData.achievements ? JSON.stringify(updateData.achievements) : null);
  }

  try {
    if (updateFields.length > 0) {
      updateValues.push(artistRowId);
      await db.query(`UPDATE artists SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);
    }
    await invalidateArtistsListCache();
    await redisClient.del(REDIS_ARTIST_DETAIL_KEY_PREFIX + artistRowId);

    const [artists] = await db.query(
      `
      SELECT 
        a.*,
        i.id as institution_id,
        i.name as institution_name,
        i.logo as institution_logo,
        i.description as institution_description
      FROM artists a
      LEFT JOIN institutions i ON a.institution_id = i.id
      WHERE a.id = ?
    `,
      [artistRowId]
    );

    if (artists.length === 0) {
      return adminResult(404, { error: '艺术家不存在' });
    }

    const artist = artists[0];
    const artistWithFullUrls = {
      ...artist,
      avatar: artist.avatar || '',
      banner: artist.banner || '',
      achievements: artist.achievements ? JSON.parse(artist.achievements) : [],
      institution: artist.institution_id
        ? {
            id: artist.institution_id,
            name: artist.institution_name,
            logo: artist.institution_logo,
            description: artist.institution_description,
          }
        : null,
    };
    return adminResult(200, artistWithFullUrls);
  } catch (e) {
    logger.error('updateArtistAdmin failed', { err: e });
    return adminResult(500, { error: '更新失败' });
  }
}

async function deleteArtistAdmin(rawId) {
  const id = parsePositiveIntId(rawId);
  if (!id) return adminResult(400, { error: '无效的艺术家ID' });
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM original_artworks WHERE artist_id = ?', [id]);
    await connection.query('DELETE FROM artist_featured_artworks WHERE artist_id = ?', [id]);
    await connection.query('DELETE FROM artists WHERE id = ?', [id]);
    await connection.commit();
    await invalidateArtistsListCache();
    await redisClient.del(REDIS_ARTIST_DETAIL_KEY_PREFIX + id);
    return adminResult(200, { message: '删除成功' });
  } catch (e) {
    await connection.rollback();
    logger.error('deleteArtistAdmin failed', { err: e });
    return adminResult(500, { error: '删除失败' });
  } finally {
    connection.release();
  }
}

async function setFeaturedArtworksAdmin(rawId, body) {
  const artistId = parsePositiveIntId(rawId);
  if (!artistId) return adminResult(400, { error: '无效的艺术家ID' });

  let artworkIds = body && body.artwork_ids;
  if (!artworkIds) {
    return adminResult(400, { error: '缺少作品ID列表 artwork_ids' });
  }
  if (typeof artworkIds === 'string') {
    artworkIds = artworkIds.split(',');
  }
  if (!Array.isArray(artworkIds)) {
    return adminResult(400, { error: 'artwork_ids 参数必须为数组或逗号分隔字符串' });
  }
  let parsedIds = artworkIds
    .map((id) => parseInt(String(id).trim(), 10))
    .filter((id) => !Number.isNaN(id) && id > 0);
  parsedIds = Array.from(new Set(parsedIds));
  if (parsedIds.length === 0) {
    return adminResult(400, { error: '作品ID列表为空或无效' });
  }
  if (parsedIds.length > 200) {
    return adminResult(400, { error: '一次最多指定200个作品ID' });
  }

  const [artistRows] = await db.query('SELECT id FROM artists WHERE id = ?', [artistId]);
  if (artistRows.length === 0) {
    return adminResult(404, { error: '艺术家不存在' });
  }

  const placeholders = parsedIds.map(() => '?').join(',');
  const [rows] = await db.query(
    `SELECT id FROM original_artworks WHERE artist_id = ? AND id IN (${placeholders})`,
    [artistId, ...parsedIds]
  );
  const validIdsSet = new Set(rows.map((r) => r.id));
  const invalidIds = parsedIds.filter((id) => !validIdsSet.has(id));
  if (invalidIds.length > 0) {
    return adminResult(400, { error: '存在不属于该艺术家的作品ID', invalid_ids: invalidIds });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM artist_featured_artworks WHERE artist_id = ?', [artistId]);
    const values = parsedIds.map((artworkId, idx) => [artistId, artworkId, idx + 1]);
    await connection.query('INSERT INTO artist_featured_artworks (artist_id, artwork_id, sort_order) VALUES ?', [
      values,
    ]);
    await connection.commit();
    try {
      await redisClient.del(REDIS_ARTIST_DETAIL_KEY_PREFIX + artistId);
    } catch (e) {
      /* ignore */
    }
    return adminResult(200, { message: '代表作品已保存', artist_id: artistId, artwork_ids: parsedIds });
  } catch (e) {
    await connection.rollback();
    logger.error('setFeaturedArtworksAdmin failed', { err: e });
    return adminResult(500, { error: '设置代表作品失败' });
  } finally {
    connection.release();
  }
}

async function getPublicFeaturedArtworks(rawId) {
  const artistId = parsePositiveIntId(rawId);
  if (!artistId) return adminResult(400, { error: '无效的艺术家ID' });
  try {
    const [rows] = await db.query(
      `
      SELECT 
        oa.id, oa.title, oa.year, oa.image, oa.price, oa.is_on_sale, oa.stock, oa.sales, oa.created_at,
        a.id as artist_id, a.name as artist_name, a.avatar as artist_avatar
      FROM artist_featured_artworks afa
      INNER JOIN original_artworks oa ON oa.id = afa.artwork_id
      INNER JOIN artists a ON a.id = oa.artist_id
      WHERE afa.artist_id = ?
      ORDER BY afa.sort_order ASC
    `,
      [artistId]
    );

    const data = (rows || []).map((artwork) => {
      const processed = processObjectImages(artwork, ['image', 'avatar']);
      return {
        ...processed,
        artist: {
          id: artwork.artist_id,
          name: artwork.artist_name,
          avatar: processed.artist_avatar || '',
        },
      };
    });
    return adminResult(200, { artist_id: artistId, data, total: data.length });
  } catch (e) {
    logger.error('getPublicFeaturedArtworks failed', { err: e });
    return adminResult(500, { error: '获取代表作品失败' });
  }
}

module.exports = {
  REDIS_ARTISTS_LIST_KEY,
  REDIS_ARTIST_DETAIL_KEY_PREFIX,
  getPublicArtistsList,
  getPublicArtistDetail,
  createArtistAdmin,
  updateArtistAdmin,
  deleteArtistAdmin,
  setFeaturedArtworksAdmin,
  getPublicFeaturedArtworks,
  invalidateArtistsListCache,
};
