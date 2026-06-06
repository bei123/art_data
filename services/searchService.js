const db = require('../db');
const logger = require('../utils/logger');
const { processObjectImages } = require('../utils/image');
const { PUBLIC_API_BASE_URL: BASE_URL } = require('../config/publicEnv');
const { attachAdminWmsImageFields } = require('./wmsArtworkImageService');

const DIGITAL_ARTWORKS_EXTERNAL_TABLE = 'digital_artworks_external';
const DIGITAL_PUBLIC_WHERE = `(dae.is_hidden = 0 OR dae.is_hidden IS NULL)`;
const ARTIST_PUBLIC_WHERE = 'COALESCE(a.is_public, 1) = 1';
function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body };
}

function digitalMatchWhere(alias = 'dae') {
  return `(
    ${alias}.title LIKE ? OR ${alias}.description LIKE ?
    OR a.name LIKE ? OR ${alias}.artist_name LIKE ?
  )`;
}

/** @returns {{ ok: true, keyword: string, pageNum: number, limitNum: number } | { ok: false, error: string }} */
function parseSearchQuery(query) {
  const { keyword, page = 1, limit = 10 } = query || {};

  if (!keyword || typeof keyword !== 'string') {
    return { ok: false, error: '请输入有效的搜索关键词' };
  }

  const cleanKeyword = keyword.trim();
  if (cleanKeyword.length < 1 || cleanKeyword.length > 100) {
    return { ok: false, error: '搜索关键词长度必须在1-100个字符之间' };
  }

  if (/[<>'"&]/.test(cleanKeyword)) {
    return { ok: false, error: '搜索关键词包含无效字符' };
  }

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
    return { ok: false, error: '分页参数无效，page必须大于0，limit必须在1-100之间' };
  }

  return { ok: true, keyword: cleanKeyword, pageNum, limitNum };
}

function mapArtistSearchRows(rows) {
  return (rows || []).map((artist) => {
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
}

function buildArtistSearchClause(includeHidden, institutionId, keyword) {
  const whereParts = [];
  const params = [];
  if (!includeHidden) {
    whereParts.push(ARTIST_PUBLIC_WHERE);
  }
  if (institutionId) {
    whereParts.push('a.institution_id = ?');
    params.push(institutionId);
  }
  const searchTerm = `%${keyword}%`;
  whereParts.push(
    `(a.name LIKE ? OR a.description LIKE ? OR a.era LIKE ? OR a.journey LIKE ? OR a.biography LIKE ? OR i.name LIKE ?)`
  );
  params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
  return {
    whereSql: `WHERE ${whereParts.join(' AND ')}`,
    params,
  };
}

/** 原作搜索：管理员 includeHidden 时不限 is_public，并扩展藏品号/年份等字段 */
function buildOriginalArtworkSearchClause(includeHidden, keyword) {
  const whereParts = [];
  const params = [];
  if (!includeHidden) {
    whereParts.push('COALESCE(oa.is_public, 1) = 1 AND COALESCE(a.is_public, 1) = 1');
  }
  const searchTerm = `%${keyword}%`;
  const matchSql = [
    'oa.title LIKE ?',
    'oa.description LIKE ?',
    'oa.long_description LIKE ?',
    'oa.collection_number LIKE ?',
    'CAST(oa.year AS CHAR) LIKE ?',
    'a.name LIKE ?',
  ];
  const matchParams = [searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm];
  if (includeHidden) {
    matchSql.push('CAST(oa.wms_record_id AS CHAR) LIKE ?');
    matchParams.push(searchTerm);
  }
  whereParts.push(`(${matchSql.join(' OR ')})`);
  params.push(...matchParams);
  return {
    whereSql: `WHERE ${whereParts.join(' AND ')}`,
    params,
  };
}

const ORIGINAL_ARTWORK_SEARCH_SELECT = `
  SELECT
    oa.id, oa.title, oa.year, oa.image, oa.price, oa.original_price, oa.discount_price,
    oa.is_on_sale, oa.stock, oa.sales, oa.created_at, oa.is_public, oa.wms_image_paths,
    oa.description, oa.long_description, oa.collection_number,
    a.id as artist_id, a.name as artist_name, a.avatar as artist_avatar,
    'original_artwork' as type
  FROM original_artworks oa
  LEFT JOIN artists a ON oa.artist_id = a.id
`;

function mapOriginalArtworkSearchRows(rows, includeHidden) {
  return (rows || []).map((row) => {
    let item = {
      ...row,
      image: row.image ? (row.image.startsWith('http') ? row.image : `${BASE_URL}${row.image}`) : '',
      artist_avatar: row.artist_avatar
        ? row.artist_avatar.startsWith('http')
          ? row.artist_avatar
          : `${BASE_URL}${row.artist_avatar}`
        : '',
    };
    if (includeHidden) item = attachAdminWmsImageFields(item);
    return item;
  });
}

/**
 * 艺术家搜索（管理端 / 公开端共用；管理员 token 下 includeHidden 可搜仅后台艺术家）
 */
async function searchArtists(query, includeHidden = false) {
  const parsed = parseSearchQuery(query);
  if (!parsed.ok) return adminResult(400, { error: parsed.error });

  const { keyword, pageNum, limitNum } = parsed;
  const offset = (pageNum - 1) * limitNum;

  let institutionId = null;
  if (query.institution_id != null && query.institution_id !== '') {
    institutionId = parseInt(query.institution_id, 10);
    if (Number.isNaN(institutionId) || institutionId <= 0) {
      return adminResult(400, { error: '无效的机构ID' });
    }
    const [institutionRows] = await db.query('SELECT id FROM institutions WHERE id = ?', [institutionId]);
    if (!institutionRows.length) {
      return adminResult(404, { error: '机构不存在' });
    }
  }

  const { whereSql, params } = buildArtistSearchClause(includeHidden, institutionId, keyword);

  const [countRows] = await db.query(
    `SELECT COUNT(*) as total
       FROM artists a
       LEFT JOIN institutions i ON a.institution_id = i.id
       ${whereSql}`,
    params
  );
  const totalCount = countRows[0]?.total ?? 0;

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
      ${whereSql}
      ORDER BY a.sort_order ASC, a.id ASC
      LIMIT ? OFFSET ?
    `,
    [...params, limitNum, offset]
  );

  const totalPages = Math.ceil(totalCount / limitNum) || 0;
  return adminResult(200, {
    data: mapArtistSearchRows(rows),
    pagination: {
      current_page: pageNum,
      page_size: limitNum,
      total_count: totalCount,
      total_pages: totalPages,
      has_next: pageNum < totalPages,
      has_prev: pageNum > 1,
    },
  });
}

async function getSearchResults(query, includeHidden = false) {
  const { type } = query || {};
  const parsed = parseSearchQuery(query);
  if (!parsed.ok) return adminResult(400, { error: parsed.error });

  const { keyword, pageNum, limitNum } = parsed;
  const offset = (pageNum - 1) * limitNum;
  const searchTerm = `%${keyword}%`;
  const digitalLikeParams = [searchTerm, searchTerm, searchTerm, searchTerm];
  let results = [];
  let totalCount = 0;

  try {
    if (type === 'artist') {
      return searchArtists(query, includeHidden);
    }

    if (!type || type === 'all') {
      const { whereSql: artistWhere, params: artistParams } = buildArtistSearchClause(
        includeHidden,
        null,
        keyword
      );
      const { whereSql: oaWhere, params: oaParams } = buildOriginalArtworkSearchClause(
        includeHidden,
        keyword
      );

      const [artistCount] = await db.query(
        `SELECT COUNT(*) as count FROM artists a
           LEFT JOIN institutions i ON a.institution_id = i.id
           ${artistWhere}`,
        artistParams
      );
      const [artworkCount] = await db.query(
        `SELECT COUNT(*) as count FROM original_artworks oa
           LEFT JOIN artists a ON a.id = oa.artist_id
           ${oaWhere}`,
        oaParams
      );
      const [digitalCount] = await db.query(
        `SELECT COUNT(*) as count
           FROM ${DIGITAL_ARTWORKS_EXTERNAL_TABLE} dae
           LEFT JOIN artists a ON a.id = dae.artist_id
           WHERE ${DIGITAL_PUBLIC_WHERE}
             AND ${digitalMatchWhere('dae')}`,
        digitalLikeParams
      );
      totalCount = artistCount[0].count + artworkCount[0].count + digitalCount[0].count;

      const [artistRows] = await db.query(
        `SELECT a.id, a.name, a.avatar, a.description, 'artist' as type
           FROM artists a
           LEFT JOIN institutions i ON a.institution_id = i.id
           ${artistWhere}
           LIMIT ? OFFSET ?`,
        [...artistParams, limitNum, offset]
      );
      const [artworkRows] = await db.query(
        `${ORIGINAL_ARTWORK_SEARCH_SELECT}
           ${oaWhere}
           ORDER BY oa.created_at DESC
           LIMIT ? OFFSET ?`,
        [...oaParams, limitNum, offset]
      );
      const [digitalRows] = await db.query(
        `SELECT dae.id, dae.title, dae.image_url as image, dae.description, 'digital_artwork' as type
           FROM ${DIGITAL_ARTWORKS_EXTERNAL_TABLE} dae
           LEFT JOIN artists a ON a.id = dae.artist_id
           WHERE ${DIGITAL_PUBLIC_WHERE}
             AND ${digitalMatchWhere('dae')}
           LIMIT ? OFFSET ?`,
        [...digitalLikeParams, limitNum, offset]
      );
      results = [
        ...artistRows.map((item) => ({
          ...item,
          avatar: item.avatar ? (item.avatar.startsWith('http') ? item.avatar : `${BASE_URL}${item.avatar}`) : '',
        })),
        ...mapOriginalArtworkSearchRows(artworkRows, includeHidden),
        ...digitalRows.map((item) => ({
          ...item,
          image: item.image ? (item.image.startsWith('http') ? item.image : `${BASE_URL}${item.image}`) : '',
        })),
      ];
    } else if (type === 'original_artwork') {
      const { whereSql: oaWhere, params: oaParams } = buildOriginalArtworkSearchClause(
        includeHidden,
        keyword
      );

      const [countResult] = await db.query(
        `SELECT COUNT(*) as count
           FROM original_artworks oa
           LEFT JOIN artists a ON oa.artist_id = a.id
           ${oaWhere}`,
        oaParams
      );
      totalCount = countResult[0].count;

      const [artworkRows] = await db.query(
        `${ORIGINAL_ARTWORK_SEARCH_SELECT}
           ${oaWhere}
           ORDER BY oa.created_at DESC
           LIMIT ? OFFSET ?`,
        [...oaParams, limitNum, offset]
      );
      results = mapOriginalArtworkSearchRows(artworkRows, includeHidden);
    } else if (type === 'digital_artwork') {
      const [countResult] = await db.query(
        `SELECT COUNT(*) as count
           FROM ${DIGITAL_ARTWORKS_EXTERNAL_TABLE} dae
           LEFT JOIN artists a ON a.id = dae.artist_id
           WHERE ${DIGITAL_PUBLIC_WHERE}
             AND ${digitalMatchWhere('dae')}`,
        digitalLikeParams
      );
      totalCount = countResult[0].count;

      const [digitalRows] = await db.query(
        `SELECT dae.id, dae.title, dae.image_url as image, dae.description, dae.artist_id, a.name as artist_name, a.avatar as artist_avatar, 'digital_artwork' as type
           FROM ${DIGITAL_ARTWORKS_EXTERNAL_TABLE} dae
           LEFT JOIN artists a ON a.id = dae.artist_id
           WHERE ${DIGITAL_PUBLIC_WHERE}
             AND ${digitalMatchWhere('dae')}
           LIMIT ? OFFSET ?`,
        [...digitalLikeParams, limitNum, offset]
      );
      results = digitalRows.map((item) => ({
        ...item,
        image: item.image ? (item.image.startsWith('http') ? item.image : `${BASE_URL}${item.image}`) : '',
        artist_avatar: item.artist_avatar
          ? item.artist_avatar.startsWith('http')
            ? item.artist_avatar
            : `${BASE_URL}${item.artist_avatar}`
          : '',
      }));
    } else {
      return adminResult(400, { error: '不支持的type类型' });
    }

    const totalPages = Math.ceil(totalCount / limitNum);
    const hasNext = pageNum < totalPages;
    const hasPrev = pageNum > 1;

    return adminResult(200, {
      data: results,
      pagination: {
        current_page: pageNum,
        page_size: limitNum,
        total_count: totalCount,
        total_pages: totalPages,
        has_next: hasNext,
        has_prev: hasPrev,
      },
    });
  } catch (error) {
    logger.error('getSearchResults failed', { err: error });
    return adminResult(500, { error: '搜索服务暂时不可用，请稍后再试' });
  }
}

module.exports = {
  getSearchResults,
  searchArtists,
  buildOriginalArtworkSearchClause,
};
