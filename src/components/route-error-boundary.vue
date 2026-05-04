<template>
  <div class="route-error-boundary">
    <div
      v-if="capturedMessage"
      class="route-error-boundary__fallback"
      role="alert"
      aria-live="assertive"
    >
      <el-result
        icon="error"
        title="页面渲染出现异常"
        :sub-title="capturedMessage"
      >
        <template #extra>
          <el-button type="primary" @click="handleRetry">重新加载当前页</el-button>
          <el-button @click="handleGoHome">返回首页</el-button>
        </template>
      </el-result>
    </div>
    <div v-else :key="contentKey" class="route-error-boundary__content">
      <slot />
    </div>
  </div>
</template>

<script setup>
import { ref, onErrorCaptured } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const capturedMessage = ref('')
const contentKey = ref(0)

onErrorCaptured((err) => {
  capturedMessage.value =
    err instanceof Error ? err.message : String(err || '未知错误')
  console.error('[route-error-boundary]', err)
  return false
})

function handleRetry() {
  capturedMessage.value = ''
  contentKey.value += 1
}

function handleGoHome() {
  capturedMessage.value = ''
  contentKey.value += 1
  router.push({ path: '/' })
}
</script>

<style scoped>
.route-error-boundary__fallback {
  padding: 24px 16px;
}

.route-error-boundary__content {
  min-height: 80px;
}
</style>
