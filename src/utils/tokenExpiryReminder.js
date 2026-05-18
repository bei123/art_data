import { ElMessage } from 'element-plus'
import { CONFIG } from '@/config'
import { getTokenExpiryRemaining, isTokenExpired } from './tokenManager'

const STORAGE_PREFIX = 'token_expiry_notified_'

function warningMs() {
  return CONFIG.token.warningMinutes * 60 * 1000
}

/** @returns {{ active: boolean, minutesLeft: number, remainingMs: number }} */
export function getTokenExpiryReminderState() {
  if (isTokenExpired()) {
    return { active: false, minutesLeft: 0, remainingMs: 0 }
  }
  const remainingMs = getTokenExpiryRemaining()
  if (!remainingMs || remainingMs > warningMs()) {
    return { active: false, minutesLeft: 0, remainingMs: remainingMs || 0 }
  }
  const minutesLeft = Math.max(1, Math.ceil(remainingMs / 60000))
  return { active: true, minutesLeft, remainingMs }
}

function notifyKey(thresholdMinutes) {
  return `${STORAGE_PREFIX}${thresholdMinutes}`
}

function hasNotified(thresholdMinutes) {
  return sessionStorage.getItem(notifyKey(thresholdMinutes)) === '1'
}

function markNotified(thresholdMinutes) {
  sessionStorage.setItem(notifyKey(thresholdMinutes), '1')
}

/** 登录成功或重新登录后调用，以便下次过期再提醒 */
export function resetTokenExpiryNotifications() {
  const keys = []
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const k = sessionStorage.key(i)
    if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k)
  }
  keys.forEach((k) => sessionStorage.removeItem(k))
}

/**
 * 在 warningMinutes 窗口内，按阈值弹 Toast（每个阈值本会话只弹一次）
 * 默认在 ≤5 分钟、≤1 分钟各提醒一次
 */
export function checkAndNotifyTokenExpiryToast() {
  const state = getTokenExpiryReminderState()
  if (!state.active) return

  const thresholds = [CONFIG.token.warningMinutes, 1].filter(
    (v, i, arr) => arr.indexOf(v) === i
  )
  thresholds.sort((a, b) => b - a)

  for (const threshold of thresholds) {
    if (state.minutesLeft > threshold) continue
    if (hasNotified(threshold)) continue
    markNotified(threshold)
    const label =
      threshold <= 1
        ? '不足 1 分钟'
        : `约 ${state.minutesLeft} 分钟`
    ElMessage.warning({
      message: `您的登录将在${label}后过期，请及时保存工作并重新登录`,
      duration: 8000,
      showClose: true,
    })
  }
}
