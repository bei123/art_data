import axiosLib from 'axios'
import { getApiClientBaseUrl, CONFIG } from '../config'
import { applyApiSignToAxiosConfig } from './apiSign'
import {
  getRefreshToken,
  saveAuthTokens,
  clearUserDataAndRedirect,
  hasUsableRefreshToken,
} from './tokenManager'
import { resetTokenExpiryNotifications } from './tokenExpiryReminder'

let refreshInFlight = null

const refreshClient = axiosLib.create({
  baseURL: getApiClientBaseUrl(),
  timeout: CONFIG.api.timeout,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
})

/**
 * POST /auth/refresh，轮换 access + refresh
 * @returns {Promise<string>} 新的 access token
 */
export async function refreshAdminAccessToken() {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken()
    if (!refreshToken || !hasUsableRefreshToken()) {
      throw new Error('缺少 refreshToken')
    }

    const config = {
      method: 'post',
      url: '/auth/refresh',
      data: { refreshToken },
      headers: { 'Content-Type': 'application/json' },
    }
    await applyApiSignToAxiosConfig(config)

    const response = await refreshClient.request(config)
    const body = response.data
    const data = body?.data || body
    if (!data?.token) {
      throw new Error(body?.error || '刷新 token 失败')
    }

    saveAuthTokens(data)
    resetTokenExpiryNotifications()
    return data.token
  })()

  try {
    return await refreshInFlight
  } catch (error) {
    clearUserDataAndRedirect()
    throw error
  } finally {
    refreshInFlight = null
  }
}
