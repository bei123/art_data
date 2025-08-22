import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
import axios from './utils/axios'
import { initAuth } from './utils/auth'
import { useUserStore } from './stores/user'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(ElementPlus)

// 全局挂载 axios 实例
app.config.globalProperties.$axios = axios

// 初始化认证状态
initAuth()

// 初始化用户状态
const userStore = useUserStore()
userStore.initUserState()

// 全局错误处理
app.config.errorHandler = (err, vm, info) => {
  console.error('Vue错误:', err)
  console.error('错误信息:', info)
}

// 全局未处理的Promise拒绝处理
window.addEventListener('unhandledrejection', event => {
  console.error('未处理的Promise拒绝:', event.reason)
})

app.mount('#app') 