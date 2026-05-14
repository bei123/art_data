<template>
  <route-error-boundary>
    <router-view />
  </route-error-boundary>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import RouteErrorBoundary from '@/components/route-error-boundary.vue'
import { useUserStore } from '@/stores/user'
import { checkAndHandleTokenExpiry, getTokenExpiryRemaining } from '@/utils/tokenManager'
import { ElMessage } from 'element-plus'
import { CONFIG } from '@/config'

let tokenCheckInterval = null
let tokenWarningInterval = null

onMounted(() => {
  const userStore = useUserStore()
  const user = localStorage.getItem('user')
  if (user) {
    userStore.setUserInfo(JSON.parse(user))
  }
  startTokenExpiryCheck()
})

onUnmounted(() => {
  if (tokenCheckInterval) clearInterval(tokenCheckInterval)
  if (tokenWarningInterval) clearInterval(tokenWarningInterval)
})

const startTokenExpiryCheck = () => {
  checkAndHandleTokenExpiry()

  const checkIntervalMs = CONFIG.token.checkIntervalSeconds * 1000
  tokenCheckInterval = setInterval(() => {
    checkAndHandleTokenExpiry()
  }, checkIntervalMs)

  const checkExpiryWarning = () => {
    const remainingTime = getTokenExpiryRemaining()
    const warningTime = CONFIG.token.warningMinutes * 60 * 1000

    if (
      remainingTime > 0 &&
      remainingTime <= warningTime &&
      remainingTime > warningTime - checkIntervalMs
    ) {
      const minutes = Math.ceil(remainingTime / 60000)
      ElMessage.warning(`您的登录将在${minutes}分钟后过期，请及时保存工作`)
    }
  }

  const warningCheckIntervalMs = CONFIG.token.warningCheckIntervalSeconds * 1000
  tokenWarningInterval = setInterval(checkExpiryWarning, warningCheckIntervalMs)
}
</script>

<style>
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
}

#app {
  min-height: 100%;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
</style>
