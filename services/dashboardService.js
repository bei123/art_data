const db = require('../db');
const logger = require('../utils/logger');
const { processObjectImages } = require('../utils/image');

const DIGITAL_ARTWORKS_EXTERNAL_TABLE = 'digital_artworks_external';
const RECENT_LIMIT = 5;

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body };
}

function mapOriginalRow(row) {
  const processed = processObjectImages(row, ['image', 'artist_avatar']);
  return {
    id: processed.id,
    title: processed.title,
    created_at: processed.created_at,
    artist: {
      id: processed.artist_id,
      name: processed.artist_name || '未知艺术家',
      avatar: processed.artist_avatar || '',
    },
  };
}

function mapDigitalRow(row) {
  const processed = processObjectImages(row, ['artist_avatar']);
  return {
    id: processed.id,
    title: processed.title,
    created_at: processed.created_at,
    artist: {
      id: processed.artist_id,
      name: processed.artist_display_name || '未知艺术家',
      avatar: processed.artist_avatar || '',
    },
  };
}

async function getDashboardOverview() {
  try {
    const [
      [[{ originalArtworks }]],
      [[{ digitalArtworks }]],
      [[{ physicalCategories }]],
      [recentOriginalRows],
      [recentDigitalRows],
    ] = await Promise.all([
      db.query('SELECT COUNT(*) AS originalArtworks FROM original_artworks'),
      db.query(`SELECT COUNT(*) AS digitalArtworks FROM ${DIGITAL_ARTWORKS_EXTERNAL_TABLE}`),
      db.query('SELECT COUNT(*) AS physicalCategories FROM physical_categories'),
      db.query(
        `
        SELECT
          oa.id, oa.title, oa.created_at,
          a.id AS artist_id, a.name AS artist_name, a.avatar AS artist_avatar
        FROM original_artworks oa
        LEFT JOIN artists a ON oa.artist_id = a.id
        ORDER BY oa.created_at DESC
        LIMIT ?
      `,
        [RECENT_LIMIT]
      ),
      db.query(
        `
        SELECT
          dae.id, dae.title, dae.created_at, dae.artist_id,
          COALESCE(a.name, dae.artist_name) AS artist_display_name,
          a.avatar AS artist_avatar
        FROM ${DIGITAL_ARTWORKS_EXTERNAL_TABLE} dae
        LEFT JOIN artists a ON a.id = dae.artist_id
        ORDER BY dae.created_at DESC
        LIMIT ?
      `,
        [RECENT_LIMIT]
      ),
    ]);

    return adminResult(200, {
      counts: {
        originalArtworks: Number(originalArtworks) || 0,
        digitalArtworks: Number(digitalArtworks) || 0,
        physicalCategories: Number(physicalCategories) || 0,
      },
      recentOriginalArtworks: (recentOriginalRows || []).map(mapOriginalRow),
      recentDigitalArtworks: (recentDigitalRows || []).map(mapDigitalRow),
    });
  } catch (error) {
    logger.error('getDashboardOverview failed', { err: error });
    return adminResult(500, { error: '获取仪表盘概览失败' });
  }
}

module.exports = {
  getDashboardOverview,
};
