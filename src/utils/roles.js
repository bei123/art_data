/**
 * @param {Record<string, unknown> | null | undefined} userInfo
 * @param {string} role
 */
export function userMatchesRole(userInfo, role) {
  const target = String(role || '').toLowerCase()
  if (!userInfo) return false
  if (Array.isArray(userInfo.roles)) {
    return userInfo.roles.some((r) => String(r || '').toLowerCase() === target)
  }
  if (typeof userInfo.role === 'string') {
    return String(userInfo.role || '').toLowerCase() === target
  }
  return false
}

/**
 * @param {Record<string, unknown> | null | undefined} userInfo
 * @param {string[] | undefined} roles
 */
export function userHasAnyRole(userInfo, roles) {
  if (!Array.isArray(roles) || roles.length === 0) return true
  return roles.some((r) => userMatchesRole(userInfo, r))
}
