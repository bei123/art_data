const db = require('../db')
const logger = require('./logger')
const {
  blocksFromLegacyIntroSteps,
} = require('./digitalClaimCopyBlocks')

let ensured = false

const DEFAULT_LIST_BLOCKS = blocksFromLegacyIntroSteps(
  '请使用「{platform}」官方 App 扫码领取。如尚未安装，可在应用商店搜索「{platform}」下载。',
  [
    '在应用商店搜索并安装「{platform}」',
    '打开「{platform}」并登录账号（建议与购买时使用的手机号一致）',
    '点击「查看领取码」，保存或截图二维码（也可用另一台手机展示）',
    '在 App 内找到「扫码领取」「典藏领取」或类似入口，扫描领取二维码',
    '领取成功后，藏品将出现在您的账号藏品库中',
  ]
)

const DEFAULT_SHEET_BLOCKS = [
  { type: 'text', content: '点击二维码可放大保存，打开「{platform}」扫码领取' },
  ...DEFAULT_LIST_BLOCKS,
]

const DEFAULT_DIGITAL_CLAIM_COPY = {
  list_visible: false,
  sheet_guide_visible: false,
  guide_title: '数字藏品领取说明',
  list_blocks: DEFAULT_LIST_BLOCKS,
  sheet_blocks: DEFAULT_SHEET_BLOCKS,
}

async function hasColumn(tableName, columnName) {
  const [rows] = await db.query(
    `SELECT 1
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  )
  return rows.length > 0
}

async function ensureColumn(tableName, columnName, ddl) {
  try {
    if (await hasColumn(tableName, columnName)) return
    await db.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${ddl}`)
    logger.info('digital_claim_copy column added', { column: columnName })
  } catch (err) {
    logger.warn('digital_claim_copy ensure column failed', { column: columnName, err: err.message })
  }
}

async function ensureDigitalClaimCopyTable() {
  if (ensured) return

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS digital_claim_copy (
        id TINYINT NOT NULL PRIMARY KEY DEFAULT 1,
        list_visible TINYINT(1) NOT NULL DEFAULT 0,
        sheet_guide_visible TINYINT(1) NOT NULL DEFAULT 0,
        guide_title VARCHAR(64) NOT NULL DEFAULT '',
        guide_intro TEXT NULL,
        guide_steps JSON NULL,
        sheet_tip VARCHAR(512) NOT NULL DEFAULT '',
        list_blocks JSON NULL,
        sheet_blocks JSON NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    await ensureColumn('digital_claim_copy', 'list_blocks', 'JSON NULL')
    await ensureColumn('digital_claim_copy', 'sheet_blocks', 'JSON NULL')

    const [rows] = await db.query('SELECT id FROM digital_claim_copy WHERE id = 1 LIMIT 1')
    if (!rows.length) {
      await db.query(
        `INSERT INTO digital_claim_copy
          (id, list_visible, sheet_guide_visible, guide_title, guide_intro, guide_steps, sheet_tip, list_blocks, sheet_blocks)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_DIGITAL_CLAIM_COPY.list_visible ? 1 : 0,
          DEFAULT_DIGITAL_CLAIM_COPY.sheet_guide_visible ? 1 : 0,
          DEFAULT_DIGITAL_CLAIM_COPY.guide_title,
          DEFAULT_LIST_BLOCKS[0]?.content || '',
          JSON.stringify(DEFAULT_LIST_BLOCKS.slice(1).map((item) => item.content)),
          DEFAULT_SHEET_BLOCKS[0]?.content || '',
          JSON.stringify(DEFAULT_DIGITAL_CLAIM_COPY.list_blocks),
          JSON.stringify(DEFAULT_DIGITAL_CLAIM_COPY.sheet_blocks),
        ]
      )
    }
  } catch (err) {
    logger.warn('ensureDigitalClaimCopyTable failed', { err: err.message })
  }

  ensured = true
}

module.exports = {
  DEFAULT_DIGITAL_CLAIM_COPY,
  ensureDigitalClaimCopyTable,
}
