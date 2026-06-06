const db = require('../db');
const redisClient = require('../utils/redisClient');
const logger = require('../utils/logger');
const { processObjectImages } = require('../utils/image');
const { ensureArtistSchemaReady, invalidateArtistsListCache } = require('./artistsService');
const { invalidateInstitutionListCache } = require('./institutionsService');

const REDIS_SHOWCASE_LIST_KEY = 'showcase:list:v1';
const INSTITUTIONS_TABLE = 'institutions';
const ARTISTS_TABLE = 'artists';
const INDEPENDENT_PUBLIC_ARTIST_SQL = 'COALESCE(a.is_public, 1) = 1 AND a.institution_id IS NULL';

let showcaseSchemaReadyPromise = null;

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body };
}

function parsePositiveIntId(raw) {
  const id = parseInt(String(raw), 10);
  if (Number.isNaN(id) || id <= 0) return null;
  return id;
}

function parseShowcaseItemsList(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  if (raw.length > 500) return null;
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const type = item?.type === 'institution' || item?.type === 'artist' ? item.type : null;
    const id = parsePositiveIntId(item?.id);
    if (!type || !id) return null;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, id });
  }
  if (!out.length) return null;
  return out;
}

async function invalidateShowcaseCache() {
  try {
    await redisClient.del(REDIS_SHOWCASE_LIST_KEY);
  } catch (e) {
    logger.error('invalidate_showcase_cache_failed', { err: e });
  }
  await invalidateArtistsListCache();
  await invalidateInstitutionListCache();
}

async function ensureInstitutionSortOrderColumn(connection) {
  const [cols] = await connection.query(
    `SELECT COUNT(*) AS cnt
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = 'sort_order'`,
    [INSTITUTIONS_TABLE]
  );
  const exists = cols && cols[0] && Number(cols[0].cnt) > 0;
  if (!exists) {
    await connection.query(
      `ALTER TABLE ${INSTITUTIONS_TABLE} ADD COLUMN sort_order INT NOT NULL DEFAULT 0`
    );
    return true;
  }
  return false;
}

async function backfillUnifiedShowcaseOrder(connection) {
  const [instRows] = await connection.query(
    `SELECT id, created_at FROM ${INSTITUTIONS_TABLE} ORDER BY created_at DESC, id DESC`
  );
  const [artistRows] = await connection.query(
    `SELECT id, created_at FROM ${ARTISTS_TABLE}
     WHERE COALESCE(is_public, 1) = 1 AND institution_id IS NULL
     ORDER BY created_at DESC, id DESC`
  );
  const merged = [
    ...(instRows || []).map((r) => ({ kind: 'institution', id: r.id, created_at: r.created_at })),
    ...(artistRows || []).map((r) => ({ kind: 'artist', id: r.id, created_at: r.created_at })),
  ].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (tb !== ta) return tb - ta;
    if (a.kind !== b.kind) return a.kind === 'institution' ? -1 : 1;
    return b.id - a.id;
  });

  for (let i = 0; i < merged.length; i += 1) {
    const entry = merged[i];
    const sortOrder = i + 1;
    if (entry.kind === 'institution') {
      await connection.query(`UPDATE ${INSTITUTIONS_TABLE} SET sort_order = ? WHERE id = ?`, [
        sortOrder,
        entry.id,
      ]);
    } else {
      await connection.query(`UPDATE ${ARTISTS_TABLE} SET sort_order = ? WHERE id = ?`, [
        sortOrder,
        entry.id,
      ]);
    }
  }
}

async function ensureShowcaseSchema() {
  await ensureArtistSchemaReady();
  const connection = await db.getConnection();
  try {
    const addedColumn = await ensureInstitutionSortOrderColumn(connection);
    if (addedColumn) {
      await backfillUnifiedShowcaseOrder(connection);
      return;
    }
    const [[{ instCount }]] = await connection.query(
      `SELECT COUNT(*) AS instCount FROM ${INSTITUTIONS_TABLE}`
    );
    const [[{ instMax }]] = await connection.query(
      `SELECT COALESCE(MAX(sort_order), 0) AS instMax FROM ${INSTITUTIONS_TABLE}`
    );
    if (Number(instCount) > 0 && Number(instMax) === 0) {
      await backfillUnifiedShowcaseOrder(connection);
    }
  } catch (e) {
    logger.error('ensureShowcaseSchema failed', { err: e });
    throw e;
  } finally {
    connection.release();
  }
}

async function ensureShowcaseSchemaReady() {
  if (!showcaseSchemaReadyPromise) {
    showcaseSchemaReadyPromise = ensureShowcaseSchema().catch((e) => {
      showcaseSchemaReadyPromise = null;
      throw e;
    });
  }
  await showcaseSchemaReadyPromise;
}

async function getNextShowcaseSortOrder(connection) {
  const runner = connection || db;
  const [[row]] = await runner.query(
    `SELECT GREATEST(
      COALESCE((SELECT MAX(sort_order) FROM ${INSTITUTIONS_TABLE}), 0),
      COALESCE((SELECT MAX(sort_order) FROM ${ARTISTS_TABLE}
        WHERE ${INDEPENDENT_PUBLIC_ARTIST_SQL.replace(/a\./g, '')}), 0)
    ) AS m`
  );
  return (Number(row?.m) || 0) + 1;
}

async function fetchShowcaseEntriesFromDb() {
  const [instRows] = await db.query(
    `
      SELECT
        i.id,
        i.name,
        i.logo,
        i.description,
        i.sort_order,
        (
          SELECT COUNT(*)
          FROM ${ARTISTS_TABLE} a
          WHERE a.institution_id = i.id AND COALESCE(a.is_public, 1) = 1
        ) AS artist_count
      FROM ${INSTITUTIONS_TABLE} i
      ORDER BY i.sort_order ASC, i.id ASC
    `
  );
  const [artistRows] = await db.query(
    `
      SELECT a.id, a.name, a.avatar, a.era, a.description, a.sort_order
      FROM ${ARTISTS_TABLE} a
      WHERE ${INDEPENDENT_PUBLIC_ARTIST_SQL}
      ORDER BY a.sort_order ASC, a.id ASC
    `
  );

  const entries = [
    ...(instRows || []).map((row) => {
      const processed = processObjectImages(row, ['logo']);
      return {
        type: 'institution',
        id: processed.id,
        name: processed.name,
        logo: processed.logo || '',
        description: processed.description || '',
        artist_count: Number(processed.artist_count) || 0,
        sort_order: processed.sort_order,
      };
    }),
    ...(artistRows || []).map((row) => {
      const processed = processObjectImages(row, ['avatar']);
      return {
        type: 'artist',
        id: processed.id,
        name: processed.name,
        avatar: processed.avatar || '',
        era: processed.era || '',
        description: processed.description || '',
        sort_order: processed.sort_order,
      };
    }),
  ];

  entries.sort((a, b) => {
    const sa = Number(a.sort_order) || 0;
    const sb = Number(b.sort_order) || 0;
    if (sa !== sb) return sa - sb;
    if (a.type !== b.type) return a.type === 'institution' ? -1 : 1;
    return a.id - b.id;
  });

  return entries;
}

function mapPublicShowcaseItem(entry) {
  if (entry.type === 'institution') {
    return {
      type: 'institution',
      id: entry.id,
      name: entry.name,
      logo: entry.logo,
      description: entry.description,
      artist_count: entry.artist_count,
    };
  }
  return {
    type: 'artist',
    id: entry.id,
    name: entry.name,
    avatar: entry.avatar,
    era: entry.era,
    description: entry.description,
  };
}

async function getPublicShowcaseList() {
  await ensureShowcaseSchemaReady();
  try {
    const cache = await redisClient.get(REDIS_SHOWCASE_LIST_KEY);
    if (cache) return adminResult(200, JSON.parse(cache));
  } catch (e) {
    logger.error('Redis 读取 showcase 列表失败', { err: e });
  }

  const entries = await fetchShowcaseEntriesFromDb();
  const body = {
    items: entries.map(mapPublicShowcaseItem),
    total: entries.length,
  };

  try {
    await redisClient.set(REDIS_SHOWCASE_LIST_KEY, JSON.stringify(body));
  } catch (e) {
    logger.error('Redis 写入 showcase 列表失败', { err: e });
  }
  return adminResult(200, body);
}

async function getShowcaseForSortAdmin() {
  await ensureShowcaseSchemaReady();
  const entries = await fetchShowcaseEntriesFromDb();
  return adminResult(200, {
    items: entries,
    item_keys: entries.map((e) => ({ type: e.type, id: e.id })),
    total: entries.length,
  });
}

async function applyShowcaseSortOrder(items) {
  const connection = await db.getConnection();
  await connection.beginTransaction();
  try {
    for (let i = 0; i < items.length; i += 1) {
      const sortOrder = i + 1;
      const item = items[i];
      if (item.type === 'institution') {
        await connection.query(`UPDATE ${INSTITUTIONS_TABLE} SET sort_order = ? WHERE id = ?`, [
          sortOrder,
          item.id,
        ]);
      } else {
        await connection.query(
          `UPDATE ${ARTISTS_TABLE} SET sort_order = ? WHERE id = ? AND institution_id IS NULL AND COALESCE(is_public, 1) = 1`,
          [sortOrder, item.id]
        );
      }
    }
    await connection.commit();
    connection.release();
  } catch (e) {
    await connection.rollback();
    connection.release();
    throw e;
  }
  await invalidateShowcaseCache();
}

async function reorderShowcaseAdmin(body) {
  await ensureShowcaseSchemaReady();

  const items = parseShowcaseItemsList(body?.items);
  if (!items) {
    return adminResult(400, {
      error: 'items 必须为非空数组，每项含 type(institution|artist) 与 id，且不可超过 500 项',
    });
  }

  const currentEntries = await fetchShowcaseEntriesFromDb();
  const currentKeySet = new Set(currentEntries.map((e) => `${e.type}:${e.id}`));
  if (items.length !== currentEntries.length) {
    return adminResult(400, {
      error: 'items 必须包含全部展示项（机构 + 独立公开艺术家）',
      expected: currentEntries.length,
      received: items.length,
    });
  }
  for (const item of items) {
    if (!currentKeySet.has(`${item.type}:${item.id}`)) {
      return adminResult(400, { error: 'items 包含无效或非展示项', item });
    }
  }

  try {
    await applyShowcaseSortOrder(items);
  } catch (e) {
    logger.error('reorderShowcaseAdmin failed', { err: e });
    return adminResult(500, { error: '更新展示顺序失败' });
  }

  const sortList = await getShowcaseForSortAdmin();
  return adminResult(200, {
    message: '展示顺序已更新',
    ...sortList.body,
  });
}

module.exports = {
  REDIS_SHOWCASE_LIST_KEY,
  ensureShowcaseSchemaReady,
  getNextShowcaseSortOrder,
  getPublicShowcaseList,
  getShowcaseForSortAdmin,
  reorderShowcaseAdmin,
  invalidateShowcaseCache,
};
