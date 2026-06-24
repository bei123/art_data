const db = require('../db')
const logger = require('../utils/logger')
const { ensureCommissionSchema } = require('../utils/commissionSchema')
const { ensureVipEarlyAccessSchema } = require('../utils/vipEarlyAccessSchema')
const { USER_TIERS, setUserTier, getUserTierProfile } = require('./userTierService')

const DEFAULT_MIN_ADVISOR_RATE = parseFloat(process.env.ART_ADVISOR_MIN_RATE || '0.15')
const DEFAULT_MAX_ADVISOR_RATE = parseFloat(process.env.ART_ADVISOR_MAX_RATE || '0.25')

const PROFESSION_OPTIONS = [
  '室内设计师',
  '软装设计师',
  '酒店采购',
  '企业采购',
  '礼品公司',
  '艺术机构',
  '其他',
]

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body }
}

function normalizePhone(phone) {
  return String(phone || '').trim().replace(/\s+/g, '')
}

function validateApplicationInput(body) {
  const realName = String(body?.real_name || '').trim()
  const phone = normalizePhone(body?.phone)
  const companyName = String(body?.company_name || '').trim()
  const profession = String(body?.profession || '').trim()

  if (!realName || realName.length > 64) {
    return { error: '请填写真实姓名' }
  }
  if (!/^1\d{10}$/.test(phone)) {
    return { error: '请填写有效手机号' }
  }
  if (!companyName || companyName.length > 128) {
    return { error: '请填写公司名称' }
  }
  if (!profession || profession.length > 64) {
    return { error: '请选择或填写职业信息' }
  }

  return { realName, phone, companyName, profession }
}

function parseCommissionRate(raw) {
  const rate = parseFloat(raw)
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1) return null
  if (rate < DEFAULT_MIN_ADVISOR_RATE || rate > DEFAULT_MAX_ADVISOR_RATE) return null
  return Math.round(rate * 10000) / 10000
}

async function getLatestApplication(userId, connection = db) {
  const [rows] = await connection.query(
    `SELECT id, user_id, real_name, phone, company_name, profession,
            status, commission_rate, reject_reason, reviewed_at, created_at, updated_at
     FROM art_advisor_applications
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [userId]
  )
  return rows[0] || null
}

async function submitArtAdvisorApplication(userId, body) {
  await ensureCommissionSchema()
  await ensureVipEarlyAccessSchema()

  const input = validateApplicationInput(body)
  if (input.error) return adminResult(400, { error: input.error })

  const tier = await getUserTierProfile(userId)
  if (!tier) return adminResult(404, { error: '用户不存在' })
  if (tier.tier === USER_TIERS.ART_ADVISOR) {
    return adminResult(409, { error: '您已是艺术顾问' })
  }

  const latest = await getLatestApplication(userId)
  if (latest && latest.status === 'pending') {
    return adminResult(409, { error: '申请审核中，请耐心等待' })
  }
  if (latest && latest.status === 'approved') {
    return adminResult(409, { error: '您已是艺术顾问' })
  }

  const [result] = await db.query(
    `INSERT INTO art_advisor_applications
     (user_id, real_name, phone, company_name, profession, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [userId, input.realName, input.phone, input.companyName, input.profession]
  )

  logger.info('art advisor application submitted', { userId, applicationId: result.insertId })
  return adminResult(200, {
    success: true,
    application_id: result.insertId,
    status: 'pending',
  })
}

async function getArtAdvisorApplicationStatus(userId) {
  await ensureCommissionSchema()

  const tier = await getUserTierProfile(userId)
  const application = await getLatestApplication(userId)

  return adminResult(200, {
    tier,
    is_art_advisor: tier?.tier === USER_TIERS.ART_ADVISOR,
    application: application
      ? {
        id: application.id,
        status: application.status,
        real_name: application.real_name,
        phone: application.phone,
        company_name: application.company_name,
        profession: application.profession,
        commission_rate: application.commission_rate,
        reject_reason: application.reject_reason,
        reviewed_at: application.reviewed_at,
        created_at: application.created_at,
      }
      : null,
    profession_options: PROFESSION_OPTIONS,
  })
}

async function listAdminArtAdvisorApplications({
  page = 1,
  pageSize = 20,
  status,
} = {}) {
  await ensureCommissionSchema()

  const limit = Math.max(1, Math.min(pageSize, 100))
  const offset = (Math.max(1, page) - 1) * limit
  const filters = []
  const params = []

  if (status) {
    filters.push('aa.status = ?')
    params.push(status)
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''

  const [rows] = await db.query(
    `SELECT aa.*, wu.nickname, wu.user_tier
     FROM art_advisor_applications aa
     LEFT JOIN wx_users wu ON wu.id = aa.user_id
     ${where}
     ORDER BY aa.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total FROM art_advisor_applications aa ${where}`,
    params
  )

  return {
    items: rows || [],
    total: Number(countRows[0]?.total || 0),
    page: Math.max(1, page),
    pageSize: limit,
    rate_range: {
      min: DEFAULT_MIN_ADVISOR_RATE,
      max: DEFAULT_MAX_ADVISOR_RATE,
    },
  }
}

async function approveArtAdvisorApplication(applicationId, { commissionRate, reviewedBy } = {}) {
  await ensureCommissionSchema()

  const rate = parseCommissionRate(commissionRate)
  if (rate == null) {
    return adminResult(400, {
      error: `佣金比例须在 ${DEFAULT_MIN_ADVISOR_RATE * 100}% ~ ${DEFAULT_MAX_ADVISOR_RATE * 100}% 之间`,
    })
  }

  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()

    const [rows] = await connection.query(
      `SELECT id, user_id, status FROM art_advisor_applications WHERE id = ? FOR UPDATE`,
      [applicationId]
    )
    const row = rows[0]
    if (!row) {
      await connection.rollback()
      return adminResult(404, { error: '申请不存在' })
    }
    if (row.status === 'approved') {
      await connection.commit()
      return adminResult(200, { success: true, alreadyDone: true })
    }
    if (row.status !== 'pending') {
      await connection.rollback()
      return adminResult(400, { error: '当前状态不可审批通过' })
    }

    await connection.query(
      `UPDATE art_advisor_applications
       SET status = 'approved',
           commission_rate = ?,
           reject_reason = NULL,
           reviewed_by = ?,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = ?`,
      [rate, reviewedBy || null, applicationId]
    )

    await setUserTier(row.user_id, USER_TIERS.ART_ADVISOR, connection)
    const { ensureReferralCode } = require('./referralService')
    await ensureReferralCode(row.user_id, connection)

    await connection.commit()
    logger.info('art advisor application approved', { applicationId, userId: row.user_id, rate })
    return adminResult(200, { success: true, commission_rate: rate })
  } catch (err) {
    await connection.rollback()
    throw err
  } finally {
    connection.release()
  }
}

async function rejectArtAdvisorApplication(applicationId, { reason, reviewedBy } = {}) {
  await ensureCommissionSchema()

  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()

    const [rows] = await connection.query(
      `SELECT id, status FROM art_advisor_applications WHERE id = ? FOR UPDATE`,
      [applicationId]
    )
    const row = rows[0]
    if (!row) {
      await connection.rollback()
      return adminResult(404, { error: '申请不存在' })
    }
    if (row.status !== 'pending') {
      await connection.rollback()
      return adminResult(400, { error: '当前状态不可驳回' })
    }

    await connection.query(
      `UPDATE art_advisor_applications
       SET status = 'rejected',
           reject_reason = ?,
           reviewed_by = ?,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = ?`,
      [String(reason || '未通过审核').slice(0, 255), reviewedBy || null, applicationId]
    )

    await connection.commit()
    return adminResult(200, { success: true })
  } catch (err) {
    await connection.rollback()
    throw err
  } finally {
    connection.release()
  }
}

module.exports = {
  adminResult,
  PROFESSION_OPTIONS,
  submitArtAdvisorApplication,
  getArtAdvisorApplicationStatus,
  listAdminArtAdvisorApplications,
  approveArtAdvisorApplication,
  rejectArtAdvisorApplication,
}
