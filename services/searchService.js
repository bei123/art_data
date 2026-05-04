const db = require('../db');
const logger = require('../utils/logger');
const { PUBLIC_API_BASE_URL: BASE_URL } = require('../config/publicEnv');

const DIGITAL_ARTWORKS_EXTERNAL_TABLE = 'digital_artworks_external';
const DIGITAL_PUBLIC_WHERE = `(dae.is_hidden = 0 OR dae.is_hidden IS NULL)`;

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body };
}

function digitalMatchWhere(alias = 'dae') {
  return `(
    ${alias}.title LIKE ? OR ${alias}.description LIKE ?
    OR a.name LIKE ? OR ${alias}.artist_name LIKE ?
  )`;
}

async function getSearchResults(query) {
  const { keyword, type, page = 1, limit = 10 } = query || {};

  if (!keyword || typeof keyword !== 'string') {
    return adminResult(400, { error: '请输入有效的搜索关键词' });
  }

  const cleanKeyword = keyword.trim();
  if (cleanKeyword.length < 1 || cleanKeyword.length > 100) {
    return adminResult(400, { error: '搜索关键词长度必须在1-100个字符之间' });
  }

  const dangerousChars = /[<>'"&]/;
  if (dangerousChars.test(cleanKeyword)) {
    return adminResult(400, { error: '搜索关键词包含无效字符' });
  }

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
    return adminResult(400, { error: '分页参数无效，page必须大于0，limit必须在1-100之间' });
  }

  const offset = (pageNum - 1) * limitNum;
  const searchTerm = `%${cleanKeyword}%`;
  const digitalLikeParams = [searchTerm, searchTerm, searchTerm, searchTerm];
  let results = [];
  let totalCount = 0;

  try {
    if (!type || type === 'all') {
      const [artistCount] = await db.query(
        `SELECT COUNT(*) as count FROM artists WHERE name LIKE ? OR description LIKE ?`,
        [searchTerm, searchTerm]
      );
      const [artworkCount] = await db.query(
        `SELECT COUNT(*) as count FROM original_artworks WHERE title LIKE ? OR description LIKE ?`,
        [searchTerm, searchTerm]
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
        `SELECT id, name, avatar, description, 'artist' as type 
           FROM artists 
           WHERE name LIKE ? OR description LIKE ?
           LIMIT ? OFFSET ?`,
        [searchTerm, searchTerm, limitNum, offset]
      );
      const [artworkRows] = await db.query(
        `SELECT id, title, image, description, 'original_artwork' as type 
           FROM original_artworks 
           WHERE title LIKE ? OR description LIKE ?
           LIMIT ? OFFSET ?`,
        [searchTerm, searchTerm, limitNum, offset]
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
        ...artworkRows.map((item) => ({
          ...item,
          image: item.image ? (item.image.startsWith('http') ? item.image : `${BASE_URL}${item.image}`) : '',
        })),
        ...digitalRows.map((item) => ({
          ...item,
          image: item.image ? (item.image.startsWith('http') ? item.image : `${BASE_URL}${item.image}`) : '',
        })),
      ];
    } else if (type === 'artist') {
      const [countResult] = await db.query(
        `SELECT COUNT(*) as count FROM artists WHERE name LIKE ? OR description LIKE ?`,
        [searchTerm, searchTerm]
      );
      totalCount = countResult[0].count;

      const [artistRows] = await db.query(
        `SELECT id, name, avatar, description, 'artist' as type 
           FROM artists 
           WHERE name LIKE ? OR description LIKE ?
           LIMIT ? OFFSET ?`,
        [searchTerm, searchTerm, limitNum, offset]
      );
      results = artistRows.map((item) => ({
        ...item,
        avatar: item.avatar ? (item.avatar.startsWith('http') ? item.avatar : `${BASE_URL}${item.avatar}`) : '',
      }));
    } else if (type === 'original_artwork') {
      const [countResult] = await db.query(
        `SELECT COUNT(*) as count 
           FROM original_artworks oa
           LEFT JOIN artists a ON oa.artist_id = a.id
           WHERE oa.title LIKE ? OR oa.description LIKE ? OR a.name LIKE ?`,
        [searchTerm, searchTerm, searchTerm]
      );
      totalCount = countResult[0].count;

      const [artworkRows] = await db.query(
        `SELECT oa.id, oa.title, oa.image, oa.description, oa.artist_id, a.name as artist_name, a.avatar as artist_avatar, 'original_artwork' as type 
           FROM original_artworks oa
           LEFT JOIN artists a ON oa.artist_id = a.id
           WHERE oa.title LIKE ? OR oa.description LIKE ? OR a.name LIKE ?
           LIMIT ? OFFSET ?`,
        [searchTerm, searchTerm, searchTerm, limitNum, offset]
      );
      results = artworkRows.map((item) => ({
        ...item,
        image: item.image ? (item.image.startsWith('http') ? item.image : `${BASE_URL}${item.image}`) : '',
        artist_avatar: item.artist_avatar
          ? item.artist_avatar.startsWith('http')
            ? item.artist_avatar
            : `${BASE_URL}${item.artist_avatar}`
          : '',
      }));
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
};
