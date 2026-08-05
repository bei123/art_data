const db = require('../db')

async function resolveWxUserUsn(userId) {
  if (!userId) return null
  const [rows] = await db.query(
    'SELECT usn FROM external_users WHERE wx_user_id = ? LIMIT 1',
    [userId]
  )
  const usn = rows?.[0]?.usn
  if (!usn || typeof usn !== 'string') return null
  const trimmed = usn.trim()
  return trimmed || null
}

function isWespaceUsnBindingEnforced() {
  const raw = process.env.ENFORCE_WESPACE_USN_BINDING
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return process.env.NODE_ENV === 'production'
  }
  return String(raw).toLowerCase() === 'true' || raw === '1'
}

async function assertUsnOwnedByWxUser(userId, usn, { force = false } = {}) {
  const requested = String(usn || '').trim()
  if (!requested) {
    return {
      ok: false,
      status: 400,
      body: { code: 400, status: false, message: 'usn参数不能为空' },
    }
  }

  if (!force && !isWespaceUsnBindingEnforced()) {
    return { ok: true, usn: requested }
  }

  const ownerUsn = await resolveWxUserUsn(userId)
  if (!ownerUsn) {
    return {
      ok: false,
      status: 403,
      body: {
        code: 403,
        status: false,
        message: '当前账号未绑定 Wespace，无法访问该接口',
      },
    }
  }

  if (ownerUsn !== requested) {
    return {
      ok: false,
      status: 403,
      body: {
        code: 403,
        status: false,
        message: 'usn 与当前登录用户不匹配',
      },
    }
  }

  return { ok: true, usn: requested }
}

module.exports = {
  resolveWxUserUsn,
  isWespaceUsnBindingEnforced,
  assertUsnOwnedByWxUser,
}
