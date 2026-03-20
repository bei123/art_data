/**
 * orderApi/goods/ver/list/v3 响应 data：顶层 + 当前选用的 list 行 → 表字段（前缀 lv3_）
 */

function numOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v);
  return s === '' ? null : s;
}

function bool01OrNull(v) {
  if (v === true || v === 1 || v === '1') return 1;
  if (v === false || v === 0 || v === '0') return 0;
  return null;
}

/**
 * @param {object|null|undefined} dataEnvelope response.data.data（含 list、shopId、page 等）
 * @param {object|null|undefined} listRow 选用的 list 条目
 */
function extractListV3Fields(dataEnvelope, listRow) {
  if (!listRow && !dataEnvelope) return null;
  const d = dataEnvelope || {};
  const r = listRow || {};

  let pageJson = null;
  try {
    if (d.page != null) pageJson = JSON.stringify(d.page);
  } catch (_) {
    pageJson = null;
  }

  return {
    lv3_shop_id: strOrNull(d.shopId),
    lv3_data_is_sell: numOrNull(d.isSell),
    lv3_data_discount: numOrNull(d.discount),
    lv3_page_json: pageJson,

    lv3_row_pk_id: numOrNull(r.id),
    lv3_goods_ver_id: strOrNull(r.goodsVerId),
    lv3_goods_id_row: strOrNull(r.goodsId),
    lv3_goods_ver_name: strOrNull(r.goodsVerName),
    lv3_goods_ver_cover: strOrNull(r.goodsVerCover),
    lv3_supplement_order: strOrNull(r.supplementOrder),
    lv3_goods_number: numOrNull(r.goodsNumber),
    lv3_goods_ver_status: strOrNull(r.goodsVerStatus),
    lv3_goods_price: strOrNull(r.goodsPrice),
    lv3_goods_ver_des: strOrNull(r.goodsVerDes),
    lv3_goods_ver_pic_des: strOrNull(r.goodsVerPicDes),
    lv3_row_create_time: strOrNull(r.createTime),
    lv3_issue_year: strOrNull(r.issueYear),
    lv3_issue_batch: strOrNull(r.issueBatch),
    lv3_issue_edition: strOrNull(r.issueEdition),
    lv3_shelf_status: strOrNull(r.shelfStatus),
    lv3_issue_info: strOrNull(r.issueInfo),
    lv3_pay_type: strOrNull(r.payType),
    lv3_release_time: strOrNull(r.releaseTime),
    lv3_min_buy_num: numOrNull(r.minBuyNum),
    lv3_add_num: numOrNull(r.addNum),
    lv3_lock_num: numOrNull(r.lockNum),
    lv3_total_num: numOrNull(r.totalNum),
    lv3_max_buy_num: numOrNull(r.maxBuyNum),
    lv3_max_once_buy_num: numOrNull(r.maxOnceBuyNum),
    lv3_goods_ver_type: strOrNull(r.goodsVerType),
    lv3_max_buy_frequency: numOrNull(r.maxBuyFrequency),
    lv3_rights_type: strOrNull(r.rightsType),
    lv3_row_is_sell: numOrNull(r.isSell),
    lv3_purchase_eligibility: bool01OrNull(r.purchaseEligibility),
    lv3_can_be_composited: bool01OrNull(r.canBeComposited),
    lv3_issue_status: bool01OrNull(r.issueStatus),
    lv3_original_price: strOrNull(r.originalPrice)
  };
}

/** @type {readonly { name: string; ddl: string }[]} */
const LIST_V3_SCHEMA = [
  { name: 'lv3_shop_id', ddl: 'VARCHAR(64) NULL' },
  { name: 'lv3_data_is_sell', ddl: 'INT NULL' },
  { name: 'lv3_data_discount', ddl: 'DECIMAL(12, 4) NULL' },
  { name: 'lv3_page_json', ddl: 'TEXT NULL' },

  { name: 'lv3_row_pk_id', ddl: 'INT NULL' },
  { name: 'lv3_goods_ver_id', ddl: 'VARCHAR(64) NULL' },
  { name: 'lv3_goods_id_row', ddl: 'VARCHAR(64) NULL' },
  { name: 'lv3_goods_ver_name', ddl: 'VARCHAR(512) NULL' },
  { name: 'lv3_goods_ver_cover', ddl: 'TEXT NULL' },
  { name: 'lv3_supplement_order', ddl: 'VARCHAR(32) NULL' },
  { name: 'lv3_goods_number', ddl: 'INT NULL' },
  { name: 'lv3_goods_ver_status', ddl: 'VARCHAR(16) NULL' },
  { name: 'lv3_goods_price', ddl: 'VARCHAR(32) NULL' },
  { name: 'lv3_goods_ver_des', ddl: 'MEDIUMTEXT NULL' },
  { name: 'lv3_goods_ver_pic_des', ddl: 'TEXT NULL' },
  { name: 'lv3_row_create_time', ddl: 'VARCHAR(32) NULL' },
  { name: 'lv3_issue_year', ddl: 'VARCHAR(16) NULL' },
  { name: 'lv3_issue_batch', ddl: 'VARCHAR(32) NULL' },
  { name: 'lv3_issue_edition', ddl: 'VARCHAR(32) NULL' },
  { name: 'lv3_shelf_status', ddl: 'VARCHAR(16) NULL' },
  { name: 'lv3_issue_info', ddl: 'LONGTEXT NULL' },
  { name: 'lv3_pay_type', ddl: 'VARCHAR(32) NULL' },
  { name: 'lv3_release_time', ddl: 'VARCHAR(32) NULL' },
  { name: 'lv3_min_buy_num', ddl: 'INT NULL' },
  { name: 'lv3_add_num', ddl: 'INT NULL' },
  { name: 'lv3_lock_num', ddl: 'INT NULL' },
  { name: 'lv3_total_num', ddl: 'INT NULL' },
  { name: 'lv3_max_buy_num', ddl: 'INT NULL' },
  { name: 'lv3_max_once_buy_num', ddl: 'INT NULL' },
  { name: 'lv3_goods_ver_type', ddl: 'VARCHAR(16) NULL' },
  { name: 'lv3_max_buy_frequency', ddl: 'INT NULL' },
  { name: 'lv3_rights_type', ddl: 'VARCHAR(16) NULL' },
  { name: 'lv3_row_is_sell', ddl: 'INT NULL' },
  { name: 'lv3_purchase_eligibility', ddl: 'TINYINT(1) NULL' },
  { name: 'lv3_can_be_composited', ddl: 'TINYINT(1) NULL' },
  { name: 'lv3_issue_status', ddl: 'TINYINT(1) NULL' },
  { name: 'lv3_original_price', ddl: 'VARCHAR(32) NULL' }
];

function listV3FieldKeys() {
  return LIST_V3_SCHEMA.map((c) => c.name);
}

function listV3ValuesArray(extracted) {
  const keys = listV3FieldKeys();
  if (!extracted) return keys.map(() => null);
  return keys.map((k) =>
    Object.prototype.hasOwnProperty.call(extracted, k) ? extracted[k] : null
  );
}

function buildCreateTableListV3Fragment() {
  return LIST_V3_SCHEMA.map((c) => `      ${c.name} ${c.ddl}`).join(',\n');
}

function buildInsertListV3ColumnsSql() {
  return LIST_V3_SCHEMA.map((c) => c.name).join(', ');
}

function buildOnDuplicateListV3Sql() {
  return LIST_V3_SCHEMA.map((c) => `${c.name} = IFNULL(VALUES(${c.name}), ${c.name})`).join(',\n    ');
}

module.exports = {
  LIST_V3_SCHEMA,
  extractListV3Fields,
  listV3FieldKeys,
  listV3ValuesArray,
  buildCreateTableListV3Fragment,
  buildInsertListV3ColumnsSql,
  buildOnDuplicateListV3Sql
};
