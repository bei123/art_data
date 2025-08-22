import { defineStore } from 'pinia'
import { getCurrentUserFromStorage, isAuthenticated, logout } from '../utils/auth'

export const useUserStore = defineStore('user', {
  state: () => ({
    userInfo: getCurrentUserFromStorage() || {},
    isAuthenticated: isAuthenticated()
  }),
  
  getters: {
    // 获取用户信息
    getUserInfo: (state) => state.userInfo,
    
    // 检查是否已认证
    getIsAuthenticated: (state) => state.isAuthenticated,
    
    // 检查是否为管理员
    isAdmin: (state) => {
      return state.userInfo.role && ['admin', 'super_admin'].includes(state.userInfo.role)
    },
    
    // 检查是否为超级管理员
    isSuperAdmin: (state) => {
      return state.userInfo.role === 'super_admin'
    },
    
    // 检查用户权限
    hasRole: (state) => (requiredRoles) => {
      if (!state.userInfo.role) return false
      
      if (Array.isArray(requiredRoles)) {
        return requiredRoles.includes(state.userInfo.role)
      }
      
      return state.userInfo.role === requiredRoles
    }
  },
  
  actions: {
    // 设置用户信息
    setUserInfo(info) {
      this.userInfo = info
      this.isAuthenticated = true
    },
    
    // 清除用户信息
    clearUserInfo() {
      this.userInfo = {}
      this.isAuthenticated = false
    },
    
    // 用户登出
    async userLogout() {
      try {
        await logout()
        this.clearUserInfo()
        return { success: true }
      } catch (error) {
        console.error('登出失败:', error)
        // 即使API调用失败，也要清除本地状态
        this.clearUserInfo()
        return { success: false, error }
      }
    },
    
    // 初始化用户状态
    initUserState() {
      const userInfo = getCurrentUserFromStorage()
      if (userInfo) {
        this.userInfo = userInfo
        this.isAuthenticated = true
      } else {
        this.clearUserInfo()
      }
    }
  }
}) 