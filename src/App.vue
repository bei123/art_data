<template>
  <route-error-boundary>
    <router-view />
  </route-error-boundary>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import RouteErrorBoundary from '@/components/route-error-boundary.vue'
import { useUserStore } from '@/stores/user'
import { checkAndHandleTokenExpiry } from '@/utils/tokenManager'
import { checkAndNotifyTokenExpiryToast } from '@/utils/tokenExpiryReminder'
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
  if (tokenCheckInterval) clearInterval(tokenCheckInterval)
})

const startTokenExpiryCheck = () => {
  checkAndHandleTokenExpiry()

  const checkIntervalMs = CONFIG.token.checkIntervalSeconds * 1000
  tokenCheckInterval = setInterval(() => {
    if (checkAndHandleTokenExpiry()) return
    checkAndNotifyTokenExpiryToast()
  }, checkIntervalMs)

  checkAndNotifyTokenExpiryToast()
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
