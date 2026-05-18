import axios from './axios'
import { resetTokenExpiryNotifications } from './tokenExpiryReminder'
import { clearUserDataAndRedirect } from './tokenManager'

/** 调用服务端注销会话并清除本地登录态 */
export async function logoutCurrentUser() {
  try {
    await axios.post('/auth/logout')
  } catch {
    /* 网络异常时仍清除本地，避免无法退出 */
  }
  resetTokenExpiryNotifications()
  clearUserDataAndRedirect()
}
