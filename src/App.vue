<template>
  <router-view></router-view>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useUserStore } from '@/stores/user'
import { checkAndHandleTokenExpiry, getTokenExpiryRemaining } from '@/utils/tokenManager'
import { ElMessage } from 'element-plus'
import { CONFIG } from '@/config'

let tokenCheckInterval = null

onMounted(() => {
  const userStore = useUserStore()
  const user = localStorage.getItem('user')
  if (user) {
    userStore.setUserInfo(JSON.parse(user))
  }
  startTokenExpiryCheck()
})

onUnmounted(() => {
  if (tokenCheckInterval) {
    clearInterval(tokenCheckInterval)
  }
})

// 启动token过期检查
const startTokenExpiryCheck = () => {
  // 立即检查一次
  checkAndHandleTokenExpiry()
  
  // 使用配置文件中的检查间隔
  const checkIntervalMs = CONFIG.token.checkIntervalSeconds * 1000
  tokenCheckInterval = setInterval(() => {
    checkAndHandleTokenExpiry()
  }, checkIntervalMs)
  
  // 额外：在token即将过期前提醒用户
  const checkExpiryWarning = () => {
    const remainingTime = getTokenExpiryRemaining()
    const warningTime = CONFIG.token.warningMinutes * 60 * 1000 // 转换为毫秒
    
    if (remainingTime > 0 && remainingTime <= warningTime && remainingTime > (warningTime - checkIntervalMs)) {
      // 只在警告时间到警告时间减去检查间隔之间显示一次提醒
      const minutes = Math.ceil(remainingTime / 60000)
      ElMessage.warning(`您的登录将在${minutes}分钟后过期，请及时保存工作`)
    }
  }
  
  // 使用配置文件中的警告检查间隔
  const warningCheckIntervalMs = CONFIG.token.warningCheckIntervalSeconds * 1000
  setInterval(checkExpiryWarning, warningCheckIntervalMs)
}
</script>

<style>
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
}

#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  height: 100%;
}
</style> 