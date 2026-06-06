const db = require('../db');
const redisClient = require('../utils/redisClient');
const logger = require('../utils/logger');
const { processObjectImages } = require('../utils/image');
const { validatePublicImageUrl: validateImageUrl } = require('../config/publicEnv');

const REDIS_INSTITUTIONS_LIST_KEY = 'institutions:list:v2';
const REDIS_INSTITUTION_DETAIL_KEY_PREFIX = 'institutions:detail:';

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body };
}

function parsePositiveIntId(raw) {
  const id = parseInt(String(raw), 10);
  if (Number.isNaN(id) || id <= 0) return null;
  return id;
}

async function invalidateInstitutionListCache() {
  await redisClient.del(REDIS_INSTITUTIONS_LIST_KEY);
  await redisClient.del('institutions:list');
}

function sanitizeInstitutionKeyword(raw) {
  if (raw == null || typeof raw !== 'string') return '';
  const t = raw.trim().slice(0, 100);
  if (!t) return '';
  return t.replace(/[%_\\]/g, '');
}

function wantsInstitutionsPagination(query) {
  if (!query) return false;
  return query.page != null || query.pageSize != null || Boolean(sanitizeInstitutionKeyword(query.keyword));
}

const INSTITUTION_ARTIST_COUNT_SQL = `
  (
    SELECT COUNT(*)
    FROM artists a
    WHERE a.institution_id = i.id AND COALESCE(a.is_public, 1) = 1
  ) AS artist_count
`;

function mapInstitutionRow(row) {
  const processed = processObjectImages(row, ['logo']);
  return {
    ...processed,
    artist_count: Number(row.artist_count) || 0,
  };
}

async function getPublicInstitutionsList(query = {}) {
  const usePagination = wantsInstitutionsPagination(query);
  const pageNum = parseInt(query.page, 10) > 0 ? parseInt(query.page, 10) : 1;
  const sizeNum = Math.min(100, parseInt(query.pageSize, 10) > 0 ? parseInt(query.pageSize, 10) : 20);
  const offset = (pageNum - 1) * sizeNum;
  const keyword = sanitizeInstitutionKeyword(query.keyword);

  try {
    if (!usePagination) {
      const cache = await redisClient.get(REDIS_INSTITUTIONS_LIST_KEY);
      if (cache) {
        return adminResult(200, JSON.parse(cache));
      }
    }

    const whereParts = [];
    const whereParams = [];
    if (keyword) {
      const like = `%${keyword}%`;
      whereParts.push('(i.name LIKE ? OR i.description LIKE ? OR i.address LIKE ?)');
      whereParams.push(like, like, like);
    }
    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    if (usePagination) {
      const [[{ total }]] = await db.query(
        `SELECT COUNT(*) AS total FROM institutions i ${whereSql}`,
        whereParams
      );
      const [rows] = await db.query(
        `
        SELECT i.*, ${INSTITUTION_ARTIST_COUNT_SQL}
        FROM institutions i
        ${whereSql}
        ORDER BY i.sort_order ASC, i.id ASC
        LIMIT ? OFFSET ?
        `,
        [...whereParams, sizeNum, offset]
      );

      return adminResult(200, {
        data: (rows || []).map(mapInstitutionRow),
        pagination: {
          page: pageNum,
          pageSize: sizeNum,
          total: Number(total) || 0,
        },
      });
    }

    const [rows] = await db.query(
      `
      SELECT i.*, ${INSTITUTION_ARTIST_COUNT_SQL}
      FROM institutions i
      ORDER BY i.sort_order ASC, i.id ASC
      `
    );
    const institutionsWithProcessedImages = (rows || []).map(mapInstitutionRow);

    await redisClient.set(REDIS_INSTITUTIONS_LIST_KEY, JSON.stringify(institutionsWithProcessedImages));
    return adminResult(200, institutionsWithProcessedImages);
  } catch (error) {
    logger.error('getPublicInstitutionsList failed', { err: error });
    return adminResult(500, { error: '获取机构列表失败' });
  }
}

async function getPublicInstitutionDetail(rawId) {
  const id = parsePositiveIntId(rawId);
  if (!id) return adminResult(400, { error: '无效的机构ID' });

  try {
    const cache = await redisClient.get(REDIS_INSTITUTION_DETAIL_KEY_PREFIX + id);
    if (cache) {
      return adminResult(200, JSON.parse(cache));
    }

    const [rows] = await db.query(
      `
      SELECT i.*, ${INSTITUTION_ARTIST_COUNT_SQL}
      FROM institutions i
      WHERE i.id = ?
      `,
      [id]
    );

    if (!rows || rows.length === 0) {
      return adminResult(404, { error: '机构不存在' });
    }

    const institution = mapInstitutionRow(rows[0]);
    await redisClient.set(REDIS_INSTITUTION_DETAIL_KEY_PREFIX + id, JSON.stringify(institution));
    return adminResult(200, institution);
  } catch (error) {
    logger.error('getPublicInstitutionDetail failed', { err: error });
    return adminResult(500, { error: '获取机构详情服务暂时不可用' });
  }
}

async function getInstitutionArtists(rawInstitutionId) {
  const id = parsePositiveIntId(rawInstitutionId);
  if (!id) return adminResult(400, { error: '无效的机构ID' });

  try {
    const [institutionRows] = await db.query('SELECT id, name FROM institutions WHERE id = ?', [id]);
    if (institutionRows.length === 0) {
      return adminResult(404, { error: '机构不存在' });
    }

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
      WHERE a.institution_id = ? AND COALESCE(a.is_public, 1) = 1
      ORDER BY a.sort_order ASC, a.id ASC
    `,
      [id]
    );

    const artistsWithProcessedImages = (artists || []).map((artist) => {
      const processedArtist = processObjectImages(artist, ['avatar', 'banner']);
      return {
        ...processedArtist,
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
  } catch (error) {
    logger.error('getInstitutionArtists failed', { err: error });
    return adminResult(500, { error: '获取机构艺术家列表失败' });
  }
}

async function createInstitutionAdmin(body) {
  const { name, logo, description, address, phone, website } = body || {};

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return adminResult(400, { error: '机构名称不能为空' });
  }
  if (name.length > 100) {
    return adminResult(400, { error: '机构名称长度不能超过100个字符' });
  }
  if (description && description.length > 2000) {
    return adminResult(400, { error: '描述长度不能超过2000个字符' });
  }

  const cleanName = name.trim();
  const cleanDescription = description ? description.trim() : '';

  try {
    const { getNextShowcaseSortOrder, invalidateShowcaseCache } = require('./showcaseService');
    const sort_order = await getNextShowcaseSortOrder();
    const [result] = await db.query(
      'INSERT INTO institutions (name, logo, description, address, phone, website, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [cleanName, logo, cleanDescription, address, phone, website, sort_order]
    );

    await invalidateShowcaseCache();
    return adminResult(200, {
      id: result.insertId,
      name: cleanName,
      description: cleanDescription,
      logo,
      address,
      phone,
      website,
    });
  } catch (error) {
    logger.error('createInstitutionAdmin failed', { err: error });
    return adminResult(500, { error: '创建机构服务暂时不可用' });
  }
}

async function updateInstitutionAdmin(rawId, body) {
  const id = parsePositiveIntId(rawId);
  if (!id) return adminResult(400, { error: '无效的机构ID' });

  const { name, logo, description, address, phone, website } = body || {};

  if (logo && !validateImageUrl(logo)) {
    return adminResult(400, { error: '无效的Logo URL' });
  }

  try {
    await db.query(
      'UPDATE institutions SET name = ?, logo = ?, description = ?, address = ?, phone = ?, website = ? WHERE id = ?',
      [name, logo, description, address, phone, website, id]
    );

    const { invalidateShowcaseCache } = require('./showcaseService');
    await invalidateShowcaseCache();
    await redisClient.del(REDIS_INSTITUTION_DETAIL_KEY_PREFIX + id);

    const [institutions] = await db.query('SELECT * FROM institutions WHERE id = ?', [id]);
    if (institutions.length === 0) {
      return adminResult(404, { error: '机构不存在' });
    }

    const institution = institutions[0];
    const institutionWithFullUrls = {
      ...institution,
      logo: institution.logo || '',
    };

    return adminResult(200, institutionWithFullUrls);
  } catch (error) {
    logger.error('updateInstitutionAdmin failed', { err: error });
    return adminResult(500, { error: '更新失败' });
  }
}

async function deleteInstitutionAdmin(rawId) {
  const id = parsePositiveIntId(rawId);
  if (!id) return adminResult(400, { error: '无效的机构ID' });

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [artists] = await connection.query('SELECT COUNT(*) as count FROM artists WHERE institution_id = ?', [id]);
    if (artists[0].count > 0) {
      await connection.rollback();
      return adminResult(400, { error: '无法删除机构，还有艺术家关联此机构' });
    }

    await connection.query('DELETE FROM institutions WHERE id = ?', [id]);

    await connection.commit();
    const { invalidateShowcaseCache } = require('./showcaseService');
    await invalidateShowcaseCache();
    await redisClient.del(REDIS_INSTITUTION_DETAIL_KEY_PREFIX + id);
    return adminResult(200, { message: '删除成功' });
  } catch (error) {
    await connection.rollback();
    logger.error('deleteInstitutionAdmin failed', { err: error });
    return adminResult(500, { error: '删除失败' });
  } finally {
    connection.release();
  }
}

module.exports = {
  getPublicInstitutionsList,
  getPublicInstitutionDetail,
  getInstitutionArtists,
  createInstitutionAdmin,
  updateInstitutionAdmin,
  deleteInstitutionAdmin,
  invalidateInstitutionListCache,
};
