const axios = require('axios');
const db = require('../db');
const {
  extractDetailsFromRawData,
  detailValuesArray,
  buildCreateTableDetailsFragment,
  buildInsertDetailsColumnsSql,
  buildOnDuplicateDetailsSql,
  DETAILS_SCHEMA
} = require('./digitalArtworksDetailsFields');
const {
  extractListV3Fields,
  listV3ValuesArray,
  buildCreateTableListV3Fragment,
  buildInsertListV3ColumnsSql,
  buildOnDuplicateListV3Sql,
  LIST_V3_SCHEMA
} = require('./digitalArtworksListV3Fields');

const DIGITAL_ARTWORKS_EXTERNAL_TABLE = 'digital_artworks_external';

// 外部API配置
const EXTERNAL_API_CONFIG = {
  VERIFICATION_CODE_BASE_URL: 'https://node.wespace.cn'
};

function getExternalAuthorization() {
  // 外部API统一使用测试token（与 routes/digital-artworks.js 保持一致）
  const testToken = process.env.EXTERNAL_BEARER_TOKEN ||
    'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c24iOiI0MWY4ZDY4MzE2NTcxMmFmM2FlYzMzZTFjODQwODk4ZmU0YmRlYzlmNjM3ZWFmNjY0MmQwNzc0ZTJlODFmYjNiIiwiYWNjb3VudF90eXBlIjoiYWRtaW4iLCJ1c2VyX25hbWUiOiI0MWY4ZDY4MzE2NTcxMmFmM2FlYzMzZTFjODQwODk4ZmU0YmRlYzlmNjM3ZWFmNjY0MmQwNzc0ZTJlODFmYjNiIiwic2NvcGUiOlsiYWxsIl0sImlkIjoxODE0NTAsImV4cCI6MTc2NDc2MDU3NiwianRpIjoiYjEzNzI4NTUtNmU0Zi00ZWViLThiYTctMmE5YTkwOGYzMWNmIiwiY2xpZW50X2lkIjoid2VzcGFjZSJ9.ombbQ9GWbtJT-S1qm_FEG1GgkBccvsS8Vk1T26VoIHQo-XDm61jWA3bhdf29nqSOX-cFD_pVKTw8jUhJw8YlrsR0mTw-rpnBYAIlRDI2NVK7M7q6pdBbiBhZYETOhouDUOYCyPIv4CVw68VWULVWbdosktnQtFDi8KK54dnEX3Q';
  return `Bearer ${testToken}`;
}

function extractUsnFromBearerAuthorization(authorization) {
  if (!authorization || typeof authorization !== 'string') return null;
  if (!authorization.startsWith('Bearer ')) return null;

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length < 2) return null;

  try {
    const payloadPart = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payloadJson = Buffer.from(payloadPart, 'base64').toString('utf8');
    const payload = JSON.parse(payloadJson);
    return payload?.usn || payload?.buyerUsn || payload?.user_usn || null;
  } catch (e) {
    return null;
  }
}

function toMysqlDate(value) {
  if (!value) return null;
  // 支持类似 "2025-03-14 19:59:28" 的时间格式
  let normalized = value;
  if (typeof normalized === 'string') {
    normalized = normalized.replace(' ', 'T');
  }
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function resolveExternalImageUrl(item) {
  if (!item) return '';
  return (
    item.image_url ||
    item.imageUrl ||
    item.cover_img ||
    item.coverImg ||
    item.cover ||
    item.img_url ||
    item.imgUrl ||
    item.goodsImg ||
    item.goods_img ||
    ''
  );
}

async function ensureTable() {
  const detailsFragment = buildCreateTableDetailsFragment();
  const listV3Fragment = buildCreateTableListV3Fragment();
  const sql = `
    CREATE TABLE IF NOT EXISTS ${DIGITAL_ARTWORKS_EXTERNAL_TABLE} (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      image_url TEXT NULL,
      description TEXT NULL,
      price DECIMAL(10, 2) NOT NULL DEFAULT 0,
      created_at DATETIME NULL,
      artist_id BIGINT NULL,
      artist_name VARCHAR(255) NULL,
      is_hidden TINYINT(1) NOT NULL DEFAULT 0,
${detailsFragment},
${listV3Fragment},
      fetched_at DATETIME NULL,
      wespace_details_json LONGTEXT NULL COMMENT '已废弃：改用语义化字段，仅兼容旧数据',
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await db.query(sql, []);
}

/**
 * 当前库中表已有列名（小写），用于避免对已存在的列重复 ALTER（否则会触发 ER_DUP_FIELDNAME，
 * 且 db.query 会先打 error 日志刷屏）。
 */
async function fetchExistingColumnNamesSet() {
  const [rows] = await db.query(
    `
    SELECT COLUMN_NAME AS cn
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
    `,
    [DIGITAL_ARTWORKS_EXTERNAL_TABLE]
  );
  return new Set(rows.map((r) => String(r.cn).toLowerCase()));
}

function isDuplicateColumnError(e) {
  return e && (e.code === 'ER_DUP_FIELDNAME' || e.errno === 1060);
}

/** 已有库补列：details 拆分的各字段 */
async function ensureDetailsFieldColumns(existingCols) {
  for (const { name, ddl } of DETAILS_SCHEMA) {
    const key = name.toLowerCase();
    if (existingCols.has(key)) continue;
    try {
      await db.query(
        `ALTER TABLE ${DIGITAL_ARTWORKS_EXTERNAL_TABLE} ADD COLUMN ${name} ${ddl}`
      );
      existingCols.add(key);
    } catch (e) {
      if (isDuplicateColumnError(e)) {
        existingCols.add(key);
        continue;
      }
      console.warn(`[digitalArtworksSync] add column ${name}:`, e.message);
    }
  }
}

/** 已有库补列：goods/ver/list/v3 拆分的各字段 */
async function ensureListV3FieldColumns(existingCols) {
  for (const { name, ddl } of LIST_V3_SCHEMA) {
    const key = name.toLowerCase();
    if (existingCols.has(key)) continue;
    try {
      await db.query(
        `ALTER TABLE ${DIGITAL_ARTWORKS_EXTERNAL_TABLE} ADD COLUMN ${name} ${ddl}`
      );
      existingCols.add(key);
    } catch (e) {
      if (isDuplicateColumnError(e)) {
        existingCols.add(key);
        continue;
      }
      console.warn(`[digitalArtworksSync] add list/v3 column ${name}:`, e.message);
    }
  }
}

/** 兼容旧库：整包 JSON 列（不再写入） */
async function ensureLegacyDetailsJsonColumn(existingCols) {
  const name = 'wespace_details_json';
  const key = name.toLowerCase();
  if (existingCols.has(key)) return;
  try {
    await db.query(
      `ALTER TABLE ${DIGITAL_ARTWORKS_EXTERNAL_TABLE} ADD COLUMN ${name} LONGTEXT NULL COMMENT '已废弃'`
    );
    existingCols.add(key);
  } catch (e) {
    if (isDuplicateColumnError(e)) {
      existingCols.add(key);
      return;
    }
    console.warn('[digitalArtworksSync] wespace_details_json:', e.message);
  }
}

async function fetchGoodsVerListFirst(goodsId, buyerUsn) {
  const authorization = getExternalAuthorization();
  const goodsListUrl = `${EXTERNAL_API_CONFIG.VERIFICATION_CODE_BASE_URL}/orderApi/goods/ver/list/v3`;

  const goodsParam = JSON.stringify({
    goodsId: String(goodsId),
    buyerUsn: buyerUsn ? String(buyerUsn) : '',
    issueBatch: '1',
    pageSize: '20',
    currentPage: 1
  });

  const formData = new URLSearchParams();
  formData.append('goods', goodsParam);

  const response = await axios.post(goodsListUrl, formData.toString(), {
    headers: {
      'pragma': 'no-cache',
      'cache-control': 'no-cache',
      'authorization': authorization,
      'apptype': '16',
      'tenantid': 'wespace',
      'content-type': 'application/x-www-form-urlencoded',
      'origin': 'https://m.wespace.cn',
      'sec-fetch-site': 'same-site',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      'referer': 'https://m.wespace.cn/',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'priority': 'u=1, i'
    },
    timeout: 15000
  });

  if (response?.data?.code === 200 && response?.data?.status === true && response?.data?.data?.list) {
    const envelope = response.data.data;
    const list = envelope.list || [];
    if (list.length === 0) return null;
    // 不能盲取 list[0]：同一 goodsId 可能有多条版本，需优先「在售/上架」且时间较新的一条
    const preferred = list.filter((row) => {
      const shelfOk = row?.shelfStatus === '1' || row?.shelfStatus === 1 || row?.shelfStatus === undefined;
      const verOk = row?.goodsVerStatus === '1' || row?.goodsVerStatus === 1 || row?.goodsVerStatus === undefined;
      return shelfOk && verOk;
    });
    const pool = preferred.length > 0 ? preferred : list;
    pool.sort((a, b) => {
      const ta = new Date((a?.createTime || a?.create_time || '').replace(' ', 'T')).getTime();
      const tb = new Date((b?.createTime || b?.create_time || '').replace(' ', 'T')).getTime();
      return (isNaN(tb) ? 0 : tb) - (isNaN(ta) ? 0 : ta);
    });
    return { row: pool[0], data: envelope };
  }

  return null;
}

/**
 * 首页 V2 列表中的 qgList：数字艺术品 goods_id 来源（与线上一致）
 * @param {string} usn 用户链上标识，与 curl 中 query 一致
 * @returns {Promise<object[]>}
 */
async function fetchQgListFromIndexV2(usn) {
  if (!usn || String(usn).trim() === '') return [];
  const authorization = getExternalAuthorization();
  const url = `${EXTERNAL_API_CONFIG.VERIFICATION_CODE_BASE_URL}/orderApi/wespace/index/list/V2`;
  const response = await axios.get(url, {
    params: {
      newsPageSize: 5,
      publicityPageSize: 5,
      activityPageSize: 6,
      usn: String(usn).trim()
    },
    headers: {
      'pragma': 'no-cache',
      'cache-control': 'no-cache',
      'authorization': authorization,
      'apptype': '16',
      'tenantid': 'wespace',
      'content-type': 'application/x-www-form-urlencoded',
      'origin': 'https://m.wespace.cn',
      'sec-fetch-site': 'same-site',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      'referer': 'https://m.wespace.cn/',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'priority': 'u=1, i'
    },
    timeout: 15000
  });

  if (response?.data?.code === 200 && response?.data?.status === true && response?.data?.data) {
    const raw = response.data.data.qgList || response.data.data.qg_list;
    return Array.isArray(raw) ? raw : [];
  }
  return [];
}

/**
 * 用 goodsVerId 拉详情（与线上一致，比 list 单条更准）
 * 返回 rawData = 接口 data 全文（goodsVer、IssueInfo、goods、goodsWhitePaper 等），便于落库
 */
async function fetchGoodsVerDetails(goodsVerId) {
  if (!goodsVerId) return null;
  const authorization = getExternalAuthorization();
  const url = `${EXTERNAL_API_CONFIG.VERIFICATION_CODE_BASE_URL}/orderApi/goods/ver/details`;
  const form = new URLSearchParams();
  form.append('goods', JSON.stringify({ goodsVerId: String(goodsVerId) }));

  const response = await axios.post(url, form.toString(), {
    headers: {
      'pragma': 'no-cache',
      'cache-control': 'no-cache',
      'authorization': authorization,
      'apptype': '16',
      'tenantid': 'wespace',
      'content-type': 'application/x-www-form-urlencoded',
      'origin': 'https://m.wespace.cn',
      'sec-fetch-site': 'same-site',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      'referer': 'https://m.wespace.cn/',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'priority': 'u=1, i'
    },
    timeout: 15000
  });

  if (response?.data?.code === 200 && response?.data?.status === true && response?.data?.data?.goodsVer) {
    const data = response.data.data;
    return {
      rawData: data,
      goodsVer: data.goodsVer,
      goods: data.goods || null,
      issueInfo: data.IssueInfo || data.issueInfo || null
    };
  }
  return null;
}

async function syncDigitalArtworksOnce() {
  await ensureTable();
  const existingCols = await fetchExistingColumnNamesSet();
  await ensureDetailsFieldColumns(existingCols);
  await ensureListV3FieldColumns(existingCols);
  await ensureLegacyDetailsJsonColumn(existingCols);

  const authorization = getExternalAuthorization();
  // 数字艺术品 goods_id：来自 GET orderApi/wespace/index/list/V2 的 data.qgList[].goods_id（与 curl 一致需传 usn）
  const buyerUsn =
    process.env.DIGITAL_ARTWORKS_SYNC_BUYER_USN ||
    extractUsnFromBearerAuthorization(authorization);
  if (!buyerUsn) {
    console.warn('[digitalArtworksSync] 缺少 usn（请配置 DIGITAL_ARTWORKS_SYNC_BUYER_USN 或使用含 usn 的 Bearer），无法拉取 qgList');
    return { synced: 0 };
  }

  const externalList = await fetchQgListFromIndexV2(buyerUsn);
  if (!Array.isArray(externalList) || externalList.length === 0) return { synced: 0 };

  // 为了避免一次同步拉太多 goodsId，做一个上限（可用 env 调大）
  const maxItems = parseInt(process.env.DIGITAL_ARTWORKS_SYNC_MAX_ITEMS || '200', 10);
  const items = externalList.slice(0, maxItems);

  const fetchedAt = new Date();
  const rows = [];

  for (const item of items) {
    const goodsId = item?.goods_id ?? item?.goodsId ?? null;
    if (!goodsId) continue;

    const id = String(goodsId);

    // qgList：name / 封面等；再用 goods/ver/list/v3 与 ver/details 补齐
    const coverUrl = resolveExternalImageUrl(item) || item?.cover || item?.coverUrl || '';
    const createdAtFromBanner = toMysqlDate(item?.createTime || item?.create_time || item?.created_at);

    const isShowRaw = item?.isShow ?? item?.is_show;
    // 你确认：0 = 展示。缺省字段时不要当成「隐藏」，否则公开列表会漏数据或只剩错误条数
    let is_hidden = 0;
    if (isShowRaw !== undefined && isShowRaw !== null && String(isShowRaw) !== '') {
      if (isShowRaw === '0' || isShowRaw === 0) is_hidden = 0;
      else is_hidden = 1;
    }

    // 先用 qgList 兜底，再用 goods/ver/list/v3 补齐标题/价格/描述/封面
    let title = item?.name || item?.goodsName || item?.coverName || '';
    let imageUrl = coverUrl;
    let description = null;
    let price = 0;
    let createdAt = createdAtFromBanner || toMysqlDate(fetchedAt);
    /** details 接口拆成的列（见 digitalArtworksDetailsFields.js） */
    let extractedDetails = null;
    /** list/v3 接口拆成的列（见 digitalArtworksListV3Fields.js） */
    let extractedListV3 = null;

    try {
      const listPack = await fetchGoodsVerListFirst(goodsId, buyerUsn);
      const firstGoodsVer = listPack?.row;
      const listV3Envelope = listPack?.data;
      if (firstGoodsVer) {
        extractedListV3 = extractListV3Fields(listV3Envelope, firstGoodsVer);

        title = firstGoodsVer?.goodsVerName || firstGoodsVer?.goodsName || title;
        imageUrl = firstGoodsVer?.goodsVerCover || firstGoodsVer?.goodsVerCoverUrl || imageUrl;
        description = firstGoodsVer?.goodsVerDes || firstGoodsVer?.goodsVerDesc || null;

        const priceRaw = firstGoodsVer?.goodsPrice ?? firstGoodsVer?.originalPrice ?? firstGoodsVer?.price;
        const parsedPrice = typeof priceRaw === 'number' ? priceRaw : Number(priceRaw);
        price = Number.isFinite(parsedPrice) ? parsedPrice : 0;

        createdAt = toMysqlDate(firstGoodsVer?.createTime || firstGoodsVer?.created_at) || createdAt;

        const gvId = firstGoodsVer?.goodsVerId;
        if (gvId) {
          const detailPack = await fetchGoodsVerDetails(gvId);
          if (detailPack?.goodsVer) {
            if (detailPack.rawData) {
              extractedDetails = extractDetailsFromRawData(detailPack.rawData);
            }
            const detail = detailPack.goodsVer;
            const g = detailPack.goods;
            const iss = detailPack.issueInfo;
            const descFromIssue =
              iss?.prBasicInfo?.prContent ||
              iss?.prIssueContent ||
              null;
            title =
              detail.goodsVerName ||
              g?.goodsName ||
              detail.worksName ||
              title;
            imageUrl = detail.goodsVerCover || g?.goodsCover || imageUrl;
            description =
              detail.goodsVerDes ||
              g?.goodsDes ||
              g?.goods_des ||
              descFromIssue ||
              description;
            const pr =
              detail.goodsPrice ??
              g?.discountPrice ??
              g?.goodsPrice ??
              detail.originalPrice ??
              detail.price;
            const p2 = typeof pr === 'number' ? pr : Number(pr);
            if (Number.isFinite(p2)) price = p2;
            createdAt =
              toMysqlDate(detail.createTime || detail.created_at) ||
              toMysqlDate(g?.createTime) ||
              createdAt;
          }
        }
      }
    } catch (e) {
      // 不中断整个同步：当前 goodsId 用 qgList 兜底写入
    }

    const detailVals = detailValuesArray(extractedDetails);
    const listV3Vals = listV3ValuesArray(extractedListV3);
    rows.push([
      id,
      title || String(goodsId), // title 不允许为空
      imageUrl,
      description,
      price,
      createdAt,
      null, // artist_id
      null, // artist_name
      is_hidden,
      ...detailVals,
      ...listV3Vals,
      toMysqlDate(fetchedAt)
    ]);
  }

  if (rows.length === 0) return { synced: 0 };

  const detailsInsertCols = buildInsertDetailsColumnsSql();
  const detailsDup = buildOnDuplicateDetailsSql();
  const listV3InsertCols = buildInsertListV3ColumnsSql();
  const listV3Dup = buildOnDuplicateListV3Sql();
  const sql = `
    INSERT INTO ${DIGITAL_ARTWORKS_EXTERNAL_TABLE}
      (id, title, image_url, description, price, created_at, artist_id, artist_name, is_hidden, ${detailsInsertCols}, ${listV3InsertCols}, fetched_at)
    VALUES ?
    ON DUPLICATE KEY UPDATE
      title = VALUES(title),
      image_url = VALUES(image_url),
      description = VALUES(description),
      price = VALUES(price),
      created_at = VALUES(created_at),
    ${detailsDup},
    ${listV3Dup},
      fetched_at = VALUES(fetched_at)
  `;

  // mysql2: VALUES ? 传入一个二维数组
  await db.query(sql, [rows]);

  return { synced: rows.length };
}

function startDigitalArtworksSync() {
  const intervalMs = parseInt(process.env.DIGITAL_ARTWORKS_SYNC_INTERVAL_MS || String(60 * 60 * 1000), 10);
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const result = await syncDigitalArtworksOnce();
      console.log('[digital-artworks-sync] done:', result);
    } catch (e) {
      console.error('[digital-artworks-sync] failed:', e?.message || e);
    } finally {
      running = false;
    }
  }

  // 启动即同步一次
  tick().catch(() => {});
  setInterval(() => {
    tick().catch(() => {});
  }, intervalMs);
}

module.exports = {
  startDigitalArtworksSync,
  syncDigitalArtworksOnce
};

