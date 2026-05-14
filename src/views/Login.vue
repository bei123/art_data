<template>
  <div class="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4">
    <Card class="w-full max-w-md shadow-sm">
      <CardHeader class="gap-1 text-center sm:text-left">
        <CardTitle class="text-xl">
          {{ isLogin ? '登录' : '注册' }}
        </CardTitle>
        <CardDescription>
          艺术品数据管理系统
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form class="flex flex-col gap-4" novalidate @submit.prevent="handleSubmit">
          <div class="flex flex-col gap-2">
            <Label for="login-username">用户名</Label>
            <Input
              id="login-username"
              v-model="form.username"
              name="username"
              autocomplete="username"
              placeholder="请输入用户名"
              :aria-invalid="!!fieldErrors.username"
              :aria-describedby="fieldErrors.username ? 'login-username-error' : undefined"
              @input="clearFieldError('username')"
            />
            <p
              v-if="fieldErrors.username"
              id="login-username-error"
              class="text-sm text-destructive"
              role="alert"
            >
              {{ fieldErrors.username }}
            </p>
          </div>

          <div v-if="!isLogin" class="flex flex-col gap-2">
            <Label for="login-email">邮箱</Label>
            <Input
              id="login-email"
              v-model="form.email"
              name="email"
              type="email"
              autocomplete="email"
              placeholder="请输入邮箱"
              :aria-invalid="!!fieldErrors.email"
              :aria-describedby="fieldErrors.email ? 'login-email-error' : undefined"
              @input="clearFieldError('email')"
            />
            <p
              v-if="fieldErrors.email"
              id="login-email-error"
              class="text-sm text-destructive"
              role="alert"
            >
              {{ fieldErrors.email }}
            </p>
          </div>

          <div class="flex flex-col gap-2">
            <Label for="login-password">密码</Label>
            <div class="flex gap-2">
              <Input
                id="login-password"
                v-model="form.password"
                class="min-w-0 flex-1"
                name="password"
                :type="passwordInputType"
                autocomplete="current-password"
                placeholder="请输入密码"
                :aria-invalid="!!fieldErrors.password"
                :aria-describedby="fieldErrors.password ? 'login-password-error' : undefined"
                @input="clearFieldError('password')"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                class="shrink-0"
                :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                :aria-pressed="showPassword"
                @click="showPassword = !showPassword"
              >
                <Eye v-if="!showPassword" aria-hidden="true" />
                <EyeOff v-else aria-hidden="true" />
              </Button>
            </div>
            <p
              v-if="fieldErrors.password"
              id="login-password-error"
              class="text-sm text-destructive"
              role="alert"
            >
              {{ fieldErrors.password }}
            </p>
          </div>

          <Separator />

          <div class="flex flex-col gap-2">
            <Button type="submit" class="w-full" :disabled="loading">
              {{
                loading
                  ? (isLogin ? '登录中…' : '注册中…')
                  : (isLogin ? '登录' : '注册')
              }}
            </Button>
            <Button type="button" variant="outline" class="w-full" @click="toggleMode">
              {{ isLogin ? '没有账号？去注册' : '已有账号？去登录' }}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Eye, EyeOff } from 'lucide-vue-next'
import { ElMessage } from 'element-plus'
import axios from '../utils/axios'
import { useUserStore } from '@/stores/user'
import { CONFIG } from '@/config'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

const router = useRouter()
const isLogin = ref(true)
const loading = ref(false)
const showPassword = ref(false)
const userStore = useUserStore()

const form = reactive({
  username: '',
  email: '',
  password: '',
})

const fieldErrors = reactive({
  username: '',
  email: '',
  password: '',
})

const passwordInputType = computed(() => (showPassword.value ? 'text' : 'password'))

function clearFieldError(key) {
  fieldErrors[key] = ''
}

function validate() {
  fieldErrors.username = ''
  fieldErrors.email = ''
  fieldErrors.password = ''
  let valid = true

  if (!form.username?.trim()) {
    fieldErrors.username = '请输入用户名'
    valid = false
  } else if (form.username.trim().length < 3) {
    fieldErrors.username = '用户名至少 3 个字符'
    valid = false
  }

  if (!isLogin.value) {
    const email = form.email?.trim() ?? ''
    if (!email) {
      fieldErrors.email = '请输入邮箱'
      valid = false
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fieldErrors.email = '请输入有效的邮箱地址'
      valid = false
    }
  }

  if (!form.password) {
    fieldErrors.password = '请输入密码'
    valid = false
  } else if (form.password.length < 6) {
    fieldErrors.password = '密码至少 6 个字符'
    valid = false
  }

  return valid
}

const toggleMode = () => {
  isLogin.value = !isLogin.value
  form.username = ''
  form.email = ''
  form.password = ''
  fieldErrors.username = ''
  fieldErrors.email = ''
  fieldErrors.password = ''
  showPassword.value = false
}

const handleSubmit = async () => {
  if (!validate()) return

  loading.value = true
  const endpoint = isLogin.value ? '/auth/login' : '/auth/register'

  try {
    const response = await axios.post(endpoint, form)

    if (isLogin.value) {
      localStorage.setItem('token', response.data.token)
      const expiryTime = Date.now() + (CONFIG.token.expiryHours * 60 * 60 * 1000)
      localStorage.setItem('tokenExpiry', expiryTime.toString())
      localStorage.setItem('user', JSON.stringify(response.data.user))
      userStore.setUserInfo(response.data.user)
      ElMessage.success('登录成功')
      router.push('/')
    } else {
      ElMessage.success('注册成功，请登录')
      isLogin.value = true
      form.username = ''
      form.email = ''
      form.password = ''
    }
  } catch (error) {
    if (error.response) {
      ElMessage.error(error.response.data.error || '操作失败')
    } else if (error.request) {
      ElMessage.error('网络请求失败，请检查网络连接')
    } else {
      ElMessage.error(`操作失败: ${error.message}`)
    }
  } finally {
    loading.value = false
  }
}
</script>
