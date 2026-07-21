import router from '../router'
import { useUserStore } from '../stores/user'
import { CONFIG } from '../config'

const TOKEN_KEY = 'token'
const TOKEN_EXPIRY_KEY = 'tokenExpiry'
const REFRESH_TOKEN_KEY = 'refreshToken'
const REFRESH_EXPIRY_KEY = 'refreshTokenExpiry'
const USER_KEY = 'user'

export function getAccessToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function saveAuthTokens(data = {}) {
  const token = data.token
  if (!token) return

  localStorage.setItem(TOKEN_KEY, token)

  if (data.expires_at) {
    const expiryMs = new Date(data.expires_at).getTime()
    if (Number.isFinite(expiryMs)) {
      localStorage.setItem(TOKEN_EXPIRY_KEY, String(expiryMs))
    }
  } else if (data.expiresIn != null) {
    const expiresIn = Number(data.expiresIn)
    if (Number.isFinite(expiresIn) && expiresIn > 0) {
      localStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + expiresIn * 1000))
    }
  } else {
    const expiryTime = Date.now() + CONFIG.token.expiryHours * 60 * 60 * 1000
    localStorage.setItem(TOKEN_EXPIRY_KEY, String(expiryTime))
  }

  if (data.refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken)
  }

  if (data.refresh_expires_at) {
    const refreshExpiryMs = new Date(data.refresh_expires_at).getTime()
    if (Number.isFinite(refreshExpiryMs)) {
      localStorage.setItem(REFRESH_EXPIRY_KEY, String(refreshExpiryMs))
    }
  } else if (data.refreshExpiresIn != null) {
    const refreshExpiresIn = Number(data.refreshExpiresIn)
    if (Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0) {
      localStorage.setItem(REFRESH_EXPIRY_KEY, String(Date.now() + refreshExpiresIn * 1000))
    }
  }
}

export function clearAuthStorage() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(TOKEN_EXPIRY_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  localStorage.removeItem(REFRESH_EXPIRY_KEY)
  localStorage.removeItem(USER_KEY)
}

// 检查token是否过期
export const isTokenExpired = () => {
  const token = localStorage.getItem(TOKEN_KEY)
  const tokenExpiry = localStorage.getItem(TOKEN_EXPIRY_KEY)

  if (!token || !tokenExpiry) {
    return true
  }

  const currentTime = Date.now()
  const expiryTime = parseInt(tokenExpiry, 10)

  return currentTime >= expiryTime
}

export function hasUsableRefreshToken() {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false
  const refreshExpiry = localStorage.getItem(REFRESH_EXPIRY_KEY)
  if (!refreshExpiry) return true
  const expiryTime = parseInt(refreshExpiry, 10)
  if (!Number.isFinite(expiryTime)) return true
  return Date.now() < expiryTime
}

// 清除用户数据并跳转到登录页
export const clearUserDataAndRedirect = () => {
  clearAuthStorage()

  const userStore = useUserStore()
  userStore.clearUserInfo()

  if (router.currentRoute.value.path !== '/login') {
    router.push({ path: '/login', query: { reason: 'session_expired' } })
  }
}

// 获取token过期剩余时间（毫秒）
export const getTokenExpiryRemaining = () => {
  const tokenExpiry = localStorage.getItem(TOKEN_EXPIRY_KEY)
  if (!tokenExpiry) {
    return 0
  }

  const currentTime = Date.now()
  const expiryTime = parseInt(tokenExpiry, 10)

  return Math.max(0, expiryTime - currentTime)
}

// 检查并处理token过期（有 refreshToken 时交给请求层刷新，不立即踢出）
export const checkAndHandleTokenExpiry = () => {
  if (!isTokenExpired()) return false
  if (hasUsableRefreshToken()) return false
  clearUserDataAndRedirect()
  return true
}
