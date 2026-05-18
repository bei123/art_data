<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AlertCircle } from 'lucide-vue-next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { CONFIG } from '@/config'
import {
  checkAndNotifyTokenExpiryToast,
  getTokenExpiryReminderState,
} from '@/utils/tokenExpiryReminder'
import { logoutCurrentUser } from '@/utils/sessionLogout'

const router = useRouter()
const tick = ref(0)
let timer = null

const state = computed(() => {
  tick.value
  return getTokenExpiryReminderState()
})

const isLoginRoute = computed(() => router.currentRoute.value.path === '/login')

const showBanner = computed(() => state.value.active && !isLoginRoute.value)

function refresh() {
  tick.value += 1
  checkAndNotifyTokenExpiryToast()
}

async function handleReLogin() {
  await logoutCurrentUser()
}

onMounted(() => {
  refresh()
  const intervalMs = Math.max(
    15_000,
    (CONFIG.token.warningCheckIntervalSeconds ?? 30) * 1000
  )
  timer = setInterval(refresh, intervalMs)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <Alert
    v-if="showBanner"
    variant="default"
    class="mx-4 mb-0 mt-3 border-amber-500/40 bg-amber-500/10 text-foreground"
    role="status"
  >
    <AlertCircle class="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
    <AlertTitle class="text-amber-900 dark:text-amber-100">登录即将过期</AlertTitle>
    <AlertDescription class="flex flex-wrap items-center gap-x-3 gap-y-2 text-amber-950/90 dark:text-amber-50/90">
      <span>
        约 {{ state.minutesLeft }} 分钟后需重新登录，请先保存未提交的内容。
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        class="h-8 border-amber-600/50 bg-background/80"
        @click="handleReLogin"
      >
        重新登录
      </Button>
    </AlertDescription>
  </Alert>
</template>
