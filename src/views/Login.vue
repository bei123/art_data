<template>
  <div class="login-container">
    <el-card class="login-card">
      <template #header>
        <div class="card-header">
          <h2>{{ isLogin ? '登录' : '注册' }}</h2>
        </div>
      </template>
      
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="80px"
        @submit.prevent="handleSubmit"
      >
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="请输入用户名" />
        </el-form-item>
        
        <el-form-item v-if="!isLogin" label="邮箱" prop="email">
          <el-input v-model="form.email" placeholder="请输入邮箱" />
        </el-form-item>
        
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            show-password
          />
        </el-form-item>
        
        <el-form-item>
          <el-button type="primary" native-type="submit" :loading="loading">
            {{ isLogin ? '登录' : '注册' }}
          </el-button>
          <el-button @click="toggleMode">
            {{ isLogin ? '没有账号？去注册' : '已有账号？去登录' }}
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { login, register, initAuth } from '../utils/auth'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const formRef = ref(null)
const isLogin = ref(true)
const loading = ref(false)
const userStore = useUserStore()

const form = reactive({
  username: '',
  email: '',
  password: ''
})

const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, message: '用户名至少3个字符', trigger: 'blur' }
  ],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入有效的邮箱地址', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少6个字符', trigger: 'blur' }
  ]
}

const toggleMode = () => {
  isLogin.value = !isLogin.value
  form.username = ''
  form.email = ''
  form.password = ''
  if (formRef.value) {
    formRef.value.clearValidate()
  }
}

const handleSubmit = async () => {
  if (!formRef.value) return
  
  try {
    await formRef.value.validate()
    loading.value = true
    
    console.log('发送请求数据:', form)
    
    if (isLogin.value) {
      // 登录
      const response = await login(form.username, form.password)
      console.log('登录响应:', response)
      
      if (response.success) {
        // 初始化认证状态
        initAuth()
        
        // 存入pinia
        userStore.setUserInfo(response.data.user)
        
        ElMessage.success('登录成功')
        router.push('/')
      }
    } else {
      // 注册
      const response = await register(form.username, form.email, form.password)
      console.log('注册响应:', response)
      
      if (response.success) {
        // 初始化认证状态
        initAuth()
        
        // 存入pinia
        userStore.setUserInfo(response.data)
        
        ElMessage.success('注册成功，已自动登录')
        router.push('/')
      }
    }
  } catch (error) {
    console.error('操作失败:', error)
    if (error.response) {
      console.error('错误响应:', error.response.data)
      const errorMessage = error.response.data.error || error.response.data.message || '操作失败'
      ElMessage.error(errorMessage)
    } else if (error.request) {
      console.error('请求错误:', error.request)
      ElMessage.error('网络请求失败，请检查网络连接')
    } else {
      console.error('其他错误:', error.message)
      ElMessage.error('操作失败: ' + error.message)
    }
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background-color: #f5f7fa;
}

.login-card {
  width: 100%;
  max-width: 400px;
}

.card-header {
  text-align: center;
}

.card-header h2 {
  margin: 0;
  color: #303133;
}
</style> 