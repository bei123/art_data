import api from '@/utils/axios'

/**
 * 返回带拦截器的共享 HTTP 客户端（配置见 @/utils/axios）。
 * 在 `<script setup>` 中优先使用本组合式函数或 `import api from '@/utils/axios'`，勿使用已移除的全局 `$axios`。
 */
export function useApi() {
  return { api }
}
