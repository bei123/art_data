import router from '../router'
import { ElMessage } from 'element-plus'
import { useUserStore } from '../stores/user'

// 检查token是否过期
export const isTokenExpired = () => {
  const token = localStorage.getItem('token')
  const tokenExpiry = localStorage.getItem('tokenExpiry')
  
  if (!token || !tokenExpiry) {
    return true
  }
  
  const currentTime = Date.now()
  const expiryTime = parseInt(tokenExpiry)
  
  return currentTime >= expiryTime
}

// 清除用户数据并跳转到登录页
export const clearUserDataAndRedirect = () => {
  // 清理localStorage
  localStorage.removeItem('token')
  localStorage.removeItem('tokenExpiry')
  localStorage.removeItem('user')
  
  // 清理pinia store中的用户状态
  const userStore = useUserStore()
  userStore.clearUserInfo()
  
  // 如果当前不在登录页，则跳转
  if (router.currentRoute.value.path !== '/login') {
    router.push('/login')
    ElMessage.error('登录已过期，请重新登录')
  }
}

// 获取token过期剩余时间（毫秒）
export const getTokenExpiryRemaining = () => {
  const tokenExpiry = localStorage.getItem('tokenExpiry')
  if (!tokenExpiry) {
    return 0
  }
  
  const currentTime = Date.now()
  const expiryTime = parseInt(tokenExpiry)
  
  return Math.max(0, expiryTime - currentTime)
}

// 检查并处理token过期
export const checkAndHandleTokenExpiry = () => {
  if (isTokenExpired()) {
    clearUserDataAndRedirect()
    return true
  }
  return false
}
