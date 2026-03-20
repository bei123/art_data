/**
 * orderApi/goods/ver/details 返回的 data 对象 → digital_artworks_external 表字段
 * 嵌套对象（如 prBasicInfo）存 LONGTEXT JSON 字符串，其余为标量列
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

/**
 * @param {object|null|undefined} raw response.data.data
 * @returns {object|null} 与 DETAILS_FIELD_ORDER 键一致；raw 为空返回 null
 */
function extractDetailsFromRawData(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const gv = raw.goodsVer || {};
  const g = raw.goods || {};
  const iss = raw.IssueInfo || raw.issueInfo || {};
  const prb = iss.prBasicInfo || {};
  const wp = raw.goodsWhitePaper || null;

  let issuePrBasicJson = null;
  try {
    if (prb && typeof prb === 'object' && Object.keys(prb).length) {
      issuePrBasicJson = JSON.stringify(prb);
    }
  } catch (_) {
    issuePrBasicJson = null;
  }

  return {
    goods_ver_pk_id: numOrNull(gv.id),
    goods_ver_id: strOrNull(gv.goodsVerId),
    goods_ver_goods_id: strOrNull(gv.goodsId),
    goods_ver_name: strOrNull(gv.goodsVerName),
    goods_ver_cover: strOrNull(gv.goodsVerCover),
    goods_price: strOrNull(gv.goodsPrice),
    goods_ver_des: strOrNull(gv.goodsVerDes),
    goods_ver_pic_des: strOrNull(gv.goodsVerPicDes),
    gv_issue_year: strOrNull(gv.issueYear),
    gv_issue_batch: strOrNull(gv.issueBatch),
    gv_issue_edition: strOrNull(gv.issueEdition),
    gv_shelf_status: strOrNull(gv.shelfStatus),
    gv_goods_ver_status: strOrNull(gv.goodsVerStatus),
    gv_goods_number: numOrNull(gv.goodsNumber),
    gv_total_num: numOrNull(gv.totalNum),
    gv_issue_num: numOrNull(gv.issueNum),
    gv_issue_info: strOrNull(gv.issueInfo),
    works_name: strOrNull(gv.worksName),
    gv_release_time: strOrNull(gv.releaseTime),
    gv_create_time: strOrNull(gv.createTime),
    gv_pay_type: strOrNull(gv.payType),
    gv_tenant_id: strOrNull(gv.tenantId),
    gv_app_type: strOrNull(gv.appType),

    goods_row_pk_id: numOrNull(g.id),
    goods_name_wespace: strOrNull(g.goodsName),
    goods_cover_wespace: strOrNull(g.goodsCover),
    goods_des_wespace: strOrNull(g.goodsDes),
    goods_type: numOrNull(g.goodsType),
    total_issue_count: numOrNull(g.totalIssueCount),
    goods_issue_time: strOrNull(g.issueTime),
    goods_basic_info: strOrNull(g.basicInfo),
    goods_pr_batch: numOrNull(g.prBatch),
    goods_space_token: strOrNull(g.spaceToken),
    goods_sale_name: strOrNull(g.saleName),
    goods_market_value: strOrNull(g.marketValue),
    goods_tenant_id: strOrNull(g.tenantId),

    issue_node_name: strOrNull(iss.nodeName),
    pr_issue_id: strOrNull(iss.prIssueId),
    pr_basic_id: strOrNull(iss.prBasicId),
    pr_issue_name: strOrNull(iss.prIssueName),
    pr_issue_cover: strOrNull(iss.prIssueCover),
    pr_price: strOrNull(iss.prPrice),
    pr_num: numOrNull(iss.prNum),
    pr_batch: strOrNull(iss.prBatch),
    pr_edition: strOrNull(iss.prEdition),
    pr_issue_content: strOrNull(iss.prIssueContent),
    pr_issue_content_pic: strOrNull(iss.prIssueContentPic),
    pr_issue_info: strOrNull(iss.prIssueInfo),
    pr_qr_code_info: strOrNull(iss.prQrCodeInfo),
    assets_content_file: strOrNull(iss.assetsContentFile),
    assets_content_file_hash: strOrNull(iss.assetsContentFileHash),
    issue_project_code: strOrNull(iss.projectCode),
    issue_pr_basic_info: issuePrBasicJson,

    white_paper_id: wp ? numOrNull(wp.id) : null,
    white_paper_url: wp ? strOrNull(wp.url) : null,
    white_paper_version: wp ? numOrNull(wp.version) : null,
    white_paper_version_name: wp ? strOrNull(wp.versionName) : null,
    white_paper_create_time: wp ? strOrNull(wp.createTime) : null
  };
}

/** @type {readonly { name: string; ddl: string }[]} */
const DETAILS_SCHEMA = [
  { name: 'goods_ver_pk_id', ddl: 'INT NULL' },
  { name: 'goods_ver_id', ddl: 'VARCHAR(64) NULL' },
  { name: 'goods_ver_goods_id', ddl: 'VARCHAR(64) NULL' },
  { name: 'goods_ver_name', ddl: 'VARCHAR(512) NULL' },
  { name: 'goods_ver_cover', ddl: 'TEXT NULL' },
  { name: 'goods_price', ddl: 'VARCHAR(32) NULL' },
  { name: 'goods_ver_des', ddl: 'MEDIUMTEXT NULL' },
  { name: 'goods_ver_pic_des', ddl: 'TEXT NULL' },
  { name: 'gv_issue_year', ddl: 'VARCHAR(16) NULL' },
  { name: 'gv_issue_batch', ddl: 'VARCHAR(32) NULL' },
  { name: 'gv_issue_edition', ddl: 'VARCHAR(32) NULL' },
  { name: 'gv_shelf_status', ddl: 'VARCHAR(16) NULL' },
  { name: 'gv_goods_ver_status', ddl: 'VARCHAR(16) NULL' },
  { name: 'gv_goods_number', ddl: 'INT NULL' },
  { name: 'gv_total_num', ddl: 'INT NULL' },
  { name: 'gv_issue_num', ddl: 'INT NULL' },
  { name: 'gv_issue_info', ddl: 'LONGTEXT NULL' },
  { name: 'works_name', ddl: 'VARCHAR(512) NULL' },
  { name: 'gv_release_time', ddl: 'VARCHAR(32) NULL' },
  { name: 'gv_create_time', ddl: 'VARCHAR(32) NULL' },
  { name: 'gv_pay_type', ddl: 'VARCHAR(32) NULL' },
  { name: 'gv_tenant_id', ddl: 'VARCHAR(64) NULL' },
  { name: 'gv_app_type', ddl: 'VARCHAR(16) NULL' },

  { name: 'goods_row_pk_id', ddl: 'INT NULL' },
  { name: 'goods_name_wespace', ddl: 'VARCHAR(512) NULL' },
  { name: 'goods_cover_wespace', ddl: 'TEXT NULL' },
  { name: 'goods_des_wespace', ddl: 'MEDIUMTEXT NULL' },
  { name: 'goods_type', ddl: 'INT NULL' },
  { name: 'total_issue_count', ddl: 'INT NULL' },
  { name: 'goods_issue_time', ddl: 'VARCHAR(32) NULL' },
  { name: 'goods_basic_info', ddl: 'LONGTEXT NULL' },
  { name: 'goods_pr_batch', ddl: 'INT NULL' },
  { name: 'goods_space_token', ddl: 'VARCHAR(128) NULL' },
  { name: 'goods_sale_name', ddl: 'VARCHAR(512) NULL' },
  { name: 'goods_market_value', ddl: 'VARCHAR(32) NULL' },
  { name: 'goods_tenant_id', ddl: 'VARCHAR(64) NULL' },

  { name: 'issue_node_name', ddl: 'VARCHAR(255) NULL' },
  { name: 'pr_issue_id', ddl: 'VARCHAR(64) NULL' },
  { name: 'pr_basic_id', ddl: 'VARCHAR(64) NULL' },
  { name: 'pr_issue_name', ddl: 'VARCHAR(512) NULL' },
  { name: 'pr_issue_cover', ddl: 'TEXT NULL' },
  { name: 'pr_price', ddl: 'VARCHAR(32) NULL' },
  { name: 'pr_num', ddl: 'INT NULL' },
  { name: 'pr_batch', ddl: 'VARCHAR(32) NULL' },
  { name: 'pr_edition', ddl: 'VARCHAR(32) NULL' },
  { name: 'pr_issue_content', ddl: 'MEDIUMTEXT NULL' },
  { name: 'pr_issue_content_pic', ddl: 'TEXT NULL' },
  { name: 'pr_issue_info', ddl: 'LONGTEXT NULL' },
  { name: 'pr_qr_code_info', ddl: 'TEXT NULL' },
  { name: 'assets_content_file', ddl: 'TEXT NULL' },
  { name: 'assets_content_file_hash', ddl: 'VARCHAR(128) NULL' },
  { name: 'issue_project_code', ddl: 'VARCHAR(64) NULL' },
  { name: 'issue_pr_basic_info', ddl: 'LONGTEXT NULL' },

  { name: 'white_paper_id', ddl: 'INT NULL' },
  { name: 'white_paper_url', ddl: 'TEXT NULL' },
  { name: 'white_paper_version', ddl: 'INT NULL' },
  { name: 'white_paper_version_name', ddl: 'VARCHAR(64) NULL' },
  { name: 'white_paper_create_time', ddl: 'VARCHAR(32) NULL' }
];

function detailFieldKeys() {
  return DETAILS_SCHEMA.map((c) => c.name);
}

/**
 * @param {object|null} extracted extractDetailsFromRawData 结果
 * @returns {any[]} 与 detailFieldKeys 顺序一致
 */
function detailValuesArray(extracted) {
  const keys = detailFieldKeys();
  if (!extracted) return keys.map(() => null);
  return keys.map((k) => (Object.prototype.hasOwnProperty.call(extracted, k) ? extracted[k] : null));
}

function buildCreateTableDetailsFragment() {
  return DETAILS_SCHEMA.map((c) => `      ${c.name} ${c.ddl}`).join(',\n');
}

function buildInsertDetailsColumnsSql() {
  return DETAILS_SCHEMA.map((c) => c.name).join(', ');
}

function buildOnDuplicateDetailsSql() {
  return DETAILS_SCHEMA.map((c) => `${c.name} = IFNULL(VALUES(${c.name}), ${c.name})`).join(',\n    ');
}

/**
 * 将库行（字段名与 DETAILS_SCHEMA 一致）组装回接近 API data 的结构
 * @param {object} row
 */
function assembleWespaceDetailsFromRow(row) {
  if (!row) return null;
  const keys = detailFieldKeys();
  const hasAny = keys.some((k) => row[k] != null && row[k] !== '');
  if (!hasAny) return null;

  let prBasicInfo = null;
  if (row.issue_pr_basic_info) {
    try {
      prBasicInfo = JSON.parse(row.issue_pr_basic_info);
    } catch (_) {
      prBasicInfo = null;
    }
  }

  const goodsVer = {
    id: row.goods_ver_pk_id,
    goodsVerId: row.goods_ver_id,
    goodsId: row.goods_ver_goods_id,
    goodsVerName: row.goods_ver_name,
    goodsVerCover: row.goods_ver_cover,
    goodsPrice: row.goods_price,
    goodsVerDes: row.goods_ver_des,
    goodsVerPicDes: row.goods_ver_pic_des,
    issueYear: row.gv_issue_year,
    issueBatch: row.gv_issue_batch,
    issueEdition: row.gv_issue_edition,
    shelfStatus: row.gv_shelf_status,
    goodsVerStatus: row.gv_goods_ver_status,
    goodsNumber: row.gv_goods_number,
    totalNum: row.gv_total_num,
    issueNum: row.gv_issue_num,
    issueInfo: row.gv_issue_info,
    worksName: row.works_name,
    releaseTime: row.gv_release_time,
    createTime: row.gv_create_time,
    payType: row.gv_pay_type,
    tenantId: row.gv_tenant_id,
    appType: row.gv_app_type
  };

  const goods = {
    id: row.goods_row_pk_id,
    goodsName: row.goods_name_wespace,
    goodsCover: row.goods_cover_wespace,
    goodsDes: row.goods_des_wespace,
    goodsType: row.goods_type,
    totalIssueCount: row.total_issue_count,
    issueTime: row.goods_issue_time,
    basicInfo: row.goods_basic_info,
    prBatch: row.goods_pr_batch,
    spaceToken: row.goods_space_token,
    saleName: row.goods_sale_name,
    marketValue: row.goods_market_value,
    tenantId: row.goods_tenant_id
  };

  const IssueInfo = {
    nodeName: row.issue_node_name,
    prIssueId: row.pr_issue_id,
    prBasicId: row.pr_basic_id,
    prIssueName: row.pr_issue_name,
    prIssueCover: row.pr_issue_cover,
    prPrice: row.pr_price,
    prNum: row.pr_num,
    prBatch: row.pr_batch,
    prEdition: row.pr_edition,
    prIssueContent: row.pr_issue_content,
    prIssueContentPic: row.pr_issue_content_pic,
    prIssueInfo: row.pr_issue_info,
    prQrCodeInfo: row.pr_qr_code_info,
    assetsContentFile: row.assets_content_file,
    assetsContentFileHash: row.assets_content_file_hash,
    projectCode: row.issue_project_code,
    prBasicInfo
  };

  const goodsWhitePaper =
    row.white_paper_id != null || row.white_paper_url
      ? {
          id: row.white_paper_id,
          url: row.white_paper_url,
          version: row.white_paper_version,
          versionName: row.white_paper_version_name,
          createTime: row.white_paper_create_time
        }
      : null;

  return {
    goodsVer,
    goods,
    IssueInfo,
    goodsWhitePaper
  };
}

module.exports = {
  DETAILS_SCHEMA,
  extractDetailsFromRawData,
  detailFieldKeys,
  detailValuesArray,
  buildCreateTableDetailsFragment,
  buildInsertDetailsColumnsSql,
  buildOnDuplicateDetailsSql,
  assembleWespaceDetailsFromRow
};
