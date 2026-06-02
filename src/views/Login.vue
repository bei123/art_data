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

      <CardContent class="flex flex-col gap-4">
        <Alert v-if="sessionExpiredHint" variant="destructive">
          <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
          <AlertTitle>登录已过期</AlertTitle>
          <AlertDescription>请重新输入账号密码登录。</AlertDescription>
        </Alert>

        <Alert v-else-if="authRequiredHint" variant="default">
          <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
          <AlertTitle>需要登录</AlertTitle>
          <AlertDescription>请先登录后再访问管理功能。</AlertDescription>
        </Alert>

        <Alert v-if="isLogin && !formError" variant="default">
          <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
          <AlertTitle>登录说明</AlertTitle>
          <AlertDescription class="space-y-1">
            <p>请使用管理员分配的账号登录本系统。</p>
            <p>登录状态约 {{ tokenExpiryHours }} 小时内有效，过期后需重新登录。</p>
            <p>若无法登录，请联系系统管理员重置密码。</p>
          </AlertDescription>
        </Alert>

        <Alert v-if="formError" variant="destructive" role="alert">
          <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
          <AlertTitle>{{ isLogin ? '登录失败' : '注册失败' }}</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

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
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertCircle, Eye, EyeOff } from 'lucide-vue-next'
import axios from '../utils/axios'
import { showLayoutSuccess, showPageSuccess, showPageWarning } from '@/utils/appMessage'
import { useUserStore } from '@/stores/user'
import { CONFIG } from '@/config'
import { resetTokenExpiryNotifications } from '@/utils/tokenExpiryReminder'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
const route = useRoute()
const isLogin = ref(true)
const tokenExpiryHours = CONFIG.token.expiryHours

const sessionExpiredHint = computed(
  () => isLogin.value && String(route.query.reason || '') === 'session_expired'
)
const authRequiredHint = computed(
  () => isLogin.value && String(route.query.reason || '') === 'auth_required'
)

watch(
  () => route.query.reason,
  (reason) => {
    if (reason === 'session_expired') {
      showPageWarning('登录已过期，请重新登录')
    }
  },
  { immediate: true }
)
const loading = ref(false)
const showPassword = ref(false)
const formError = ref('')
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
  formError.value = ''
}

function resolveAuthApiError(error) {
  if (error?.response) {
    const { status, data } = error.response
    if (data?.error) return String(data.error)
    if (Array.isArray(data?.errors) && data.errors.length) {
      return data.errors
        .map((item) => item?.msg || item?.message)
        .filter(Boolean)
        .join('；')
    }
    if (status === 401) return '用户名或密码错误'
    if (status === 403) return '账户已被禁用或无权登录'
    if (status === 400) return '请检查填写的账号信息'
    if (status >= 500) return '服务器繁忙，请稍后重试'
    return `请求失败（HTTP ${status}）`
  }
  if (error?.code === 'ECONNABORTED') {
    return '连接超时，请检查网络后重试'
  }
  if (error?.request) {
    return '无法连接服务器，请检查网络或联系管理员'
  }
  return String(error?.message || '操作失败，请重试')
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
  formError.value = ''
  showPassword.value = false
}

const handleSubmit = async () => {
  if (!validate()) return

  loading.value = true
  formError.value = ''
  const endpoint = isLogin.value ? '/auth/login' : '/auth/register'

  try {
    const body = await axios.post(endpoint, form, { skipGlobalError: true })

    if (isLogin.value) {
      const token = body?.data?.token
      const user = body?.data?.user
      if (!token || !user) {
        formError.value = '登录失败：服务器返回数据异常，请稍后重试'
        return
      }
      localStorage.setItem('token', token)
      const expiryTime = Date.now() + (CONFIG.token.expiryHours * 60 * 60 * 1000)
      localStorage.setItem('tokenExpiry', expiryTime.toString())
      localStorage.setItem('user', JSON.stringify(user))
      userStore.setUserInfo(user)
      resetTokenExpiryNotifications()
      await router.replace('/')
      showLayoutSuccess('登录成功')
    } else {
      if (body?.success === false) {
        formError.value = body?.error || '注册失败'
        return
      }
      showPageSuccess('注册成功，请登录')
      isLogin.value = true
      form.username = ''
      form.email = ''
      form.password = ''
    }
  } catch (error) {
    formError.value = resolveAuthApiError(error)
  } finally {
    loading.value = false
  }
}
</script>
