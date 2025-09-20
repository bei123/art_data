<template>
  <div class="artist-detail">
    <el-page-header @back="goBack" :title="'返回列表'" />
    
    <el-card v-loading="loading" class="detail-card">
      <template #header>
        <div class="card-header">
          <span>艺术家详情</span>
          <div style="display:flex; gap:8px;">
            <el-button @click="goToFeaturedManager">管理代表作品</el-button>
            <el-button type="primary" @click="handleEdit">编辑</el-button>
          </div>
        </div>
      </template>

      <el-form :model="form" label-width="120px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="艺术家姓名">
              <el-input v-model="form.name" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="所属时代">
              <el-input v-model="form.era" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="头像" required>
              <div class="image-upload-container">
                <!-- 头像预览区域 -->
                <div class="image-preview" v-if="form.avatar">
                  <img :src="getImageUrl(form.avatar)" class="preview-image" alt="头像" />
                  <div class="image-overlay">
                    <el-button 
                      type="danger" 
                      size="small" 
                      circle 
                      @click="removeAvatar"
                      class="remove-btn"
                    >
                      <el-icon><Delete /></el-icon>
                    </el-button>
                    <el-button 
                      type="primary" 
                      size="small" 
                      @click="triggerAvatarInput"
                      class="replace-btn"
                    >
                      更换头像
                    </el-button>
                  </div>
                </div>

                <!-- 上传区域 -->
                <div 
                  v-else
                  class="upload-zone"
                  :class="{ 
                    'drag-over': isAvatarDragOver, 
                    'uploading': isAvatarUploading || isAvatarProcessing 
                  }"
                  @click="triggerAvatarInput"
                  @dragenter="handleAvatarDragEnter"
                  @dragleave="handleAvatarDragLeave"
                  @dragover="handleAvatarDragOver"
                  @drop="handleAvatarDrop"
                >
                  <div class="upload-content">
                    <el-icon class="upload-icon" :class="{ 'spinning': isAvatarUploading || isAvatarProcessing }">
                      <component :is="(isAvatarUploading || isAvatarProcessing) ? 'Loading' : 'Upload'" />
                    </el-icon>
                    <div class="upload-text">
                      <p class="upload-title">
                        {{ isAvatarProcessing ? '正在处理头像...' : isAvatarUploading ? '正在上传...' : '点击或拖拽头像到此处上传' }}
                      </p>
                      <p class="upload-hint">支持 JPG、PNG、GIF 格式，自动转换为 WebP 格式并压缩至 5MB 以内</p>
                    </div>
                  </div>
                  
                  <!-- 拖拽提示遮罩 -->
                  <div v-if="isAvatarDragOver && !form.avatar" class="drag-overlay">
                    <el-icon class="drag-icon"><Upload /></el-icon>
                    <p>释放鼠标上传头像</p>
                  </div>
                </div>

                <!-- 隐藏的文件输入 -->
                <input
                  ref="avatarInput"
                  type="file"
                  accept="image/*"
                  style="display: none"
                  @change="handleAvatarFileSelect"
                />

                <!-- 头像处理提示 -->
                <div v-if="isAvatarProcessing" class="upload-progress">
                  <div class="progress-header">
                    <span class="progress-title">头像处理中</span>
                    <span class="progress-percentage">处理中...</span>
                  </div>
                  <el-progress 
                    :percentage="0" 
                    :stroke-width="6"
                    :show-text="false"
                    :indeterminate="true"
                    :color="progressColors"
                  />
                  <div class="progress-info">
                    <span class="file-name">{{ avatarFileName }}</span>
                    <span class="file-size">{{ formatFileSize(avatarFileSize) }}</span>
                  </div>
                  <div class="processing-hint">
                    <p>正在将头像转换为 WebP 格式并压缩...</p>
                  </div>
                </div>

                <!-- 上传进度条 -->
                <div v-if="avatarUploadProgress > 0 && avatarUploadProgress < 100 && !isAvatarProcessing" class="upload-progress">
                  <div class="progress-header">
                    <span class="progress-title">上传进度</span>
                    <span class="progress-percentage">{{ avatarUploadProgress }}%</span>
                  </div>
                  <el-progress 
                    :percentage="avatarUploadProgress" 
                    :stroke-width="6"
                    :show-text="false"
                    :color="progressColors"
                  />
                  <div class="progress-info">
                    <span class="file-name">{{ avatarFileName }}</span>
                    <span class="file-size">{{ formatFileSize(avatarFileSize) }}</span>
                  </div>
                </div>

                <!-- 上传完成提示 -->
                <div v-if="avatarUploadProgress === 100" class="upload-success">
                  <el-alert
                    title="头像上传成功！"
                    type="success"
                    :closable="false"
                    show-icon
                  />
                </div>
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="背景图" required>
              <div class="image-upload-container">
                <!-- 背景图预览区域 -->
                <div class="image-preview" v-if="form.banner">
                  <img :src="getImageUrl(form.banner)" class="preview-image" alt="背景图" />
                  <div class="image-overlay">
                    <el-button 
                      type="danger" 
                      size="small" 
                      circle 
                      @click="removeBanner"
                      class="remove-btn"
                    >
                      <el-icon><Delete /></el-icon>
                    </el-button>
                    <el-button 
                      type="primary" 
                      size="small" 
                      @click="triggerBannerInput"
                      class="replace-btn"
                    >
                      更换背景图
                    </el-button>
                  </div>
                </div>

                <!-- 上传区域 -->
                <div 
                  v-else
                  class="upload-zone"
                  :class="{ 
                    'drag-over': isBannerDragOver, 
                    'uploading': isBannerUploading || isBannerProcessing 
                  }"
                  @click="triggerBannerInput"
                  @dragenter="handleBannerDragEnter"
                  @dragleave="handleBannerDragLeave"
                  @dragover="handleBannerDragOver"
                  @drop="handleBannerDrop"
                >
                  <div class="upload-content">
                    <el-icon class="upload-icon" :class="{ 'spinning': isBannerUploading || isBannerProcessing }">
                      <component :is="(isBannerUploading || isBannerProcessing) ? 'Loading' : 'Upload'" />
                    </el-icon>
                    <div class="upload-text">
                      <p class="upload-title">
                        {{ isBannerProcessing ? '正在处理背景图...' : isBannerUploading ? '正在上传...' : '点击或拖拽背景图到此处上传' }}
                      </p>
                      <p class="upload-hint">支持 JPG、PNG、GIF 格式，自动转换为 WebP 格式并压缩至 5MB 以内</p>
                    </div>
                  </div>
                  
                  <!-- 拖拽提示遮罩 -->
                  <div v-if="isBannerDragOver && !form.banner" class="drag-overlay">
                    <el-icon class="drag-icon"><Upload /></el-icon>
                    <p>释放鼠标上传背景图</p>
                  </div>
                </div>

                <!-- 隐藏的文件输入 -->
                <input
                  ref="bannerInput"
                  type="file"
                  accept="image/*"
                  style="display: none"
                  @change="handleBannerFileSelect"
                />

                <!-- 背景图处理提示 -->
                <div v-if="isBannerProcessing" class="upload-progress">
                  <div class="progress-header">
                    <span class="progress-title">背景图处理中</span>
                    <span class="progress-percentage">处理中...</span>
                  </div>
                  <el-progress 
                    :percentage="0" 
                    :stroke-width="6"
                    :show-text="false"
                    :indeterminate="true"
                    :color="progressColors"
                  />
                  <div class="progress-info">
                    <span class="file-name">{{ bannerFileName }}</span>
                    <span class="file-size">{{ formatFileSize(bannerFileSize) }}</span>
                  </div>
                  <div class="processing-hint">
                    <p>正在将背景图转换为 WebP 格式并压缩...</p>
                  </div>
                </div>

                <!-- 上传进度条 -->
                <div v-if="bannerUploadProgress > 0 && bannerUploadProgress < 100 && !isBannerProcessing" class="upload-progress">
                  <div class="progress-header">
                    <span class="progress-title">上传进度</span>
                    <span class="progress-percentage">{{ bannerUploadProgress }}%</span>
                  </div>
                  <el-progress 
                    :percentage="bannerUploadProgress" 
                    :stroke-width="6"
                    :show-text="false"
                    :color="progressColors"
                  />
                  <div class="progress-info">
                    <span class="file-name">{{ bannerFileName }}</span>
                    <span class="file-size">{{ formatFileSize(bannerFileSize) }}</span>
                  </div>
                </div>

                <!-- 上传完成提示 -->
                <div v-if="bannerUploadProgress === 100" class="upload-success">
                  <el-alert
                    title="背景图上传成功！"
                    type="success"
                    :closable="false"
                    show-icon
                  />
                </div>
              </div>
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="简介">
          <el-input v-model="form.description" type="textarea" :rows="4" />
        </el-form-item>

        <el-form-item label="艺术历程">
          <el-input v-model="form.journey" type="textarea" :rows="6" placeholder="请按时间顺序记录艺术家的重要创作时期、重大作品、获奖经历等" />
        </el-form-item>

        <el-divider>成就列表</el-divider>

        <div v-for="(achievement, index) in form.achievements" :key="index" class="achievement-item">
          <el-row :gutter="20">
            <el-col :span="10">
              <el-form-item :label="'成就标题'">
                <el-input v-model="achievement.title" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="'成就描述'">
                <el-input v-model="achievement.description" />
              </el-form-item>
            </el-col>
            <el-col :span="2">
              <el-button type="danger" @click="removeAchievement(index)">删除</el-button>
            </el-col>
          </el-row>
        </div>

        <el-form-item>
          <el-button type="primary" @click="addAchievement">添加成就</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="detail-card" style="margin-top: 16px;">
      <template #header>
        <div class="card-header">
          <span>代表作品</span>
        </div>
      </template>
      <el-row :gutter="16">
        <el-col v-for="item in featuredList" :key="item.id" :span="6">
          <el-card shadow="hover">
            <img :src="getImageUrl(item.image)" class="artwork-thumb" alt="thumb" />
            <div class="artwork-meta" style="margin-top:8px;">
              <div class="artwork-title" :title="item.title">{{ item.title }}</div>
              <div class="artwork-sub">#{{ item.id }} · {{ item.year || '-' }}</div>
            </div>
          </el-card>
        </el-col>
        <el-empty v-if="featuredList.length === 0" description="暂无代表作品" />
      </el-row>
    </el-card>

    <el-card class="detail-card" style="margin-top: 16px;" ref="featuredManagerRef" v-if="showFeaturedManager">
      <template #header>
        <div class="card-header">
          <span>代表作品管理</span>
          <div>
            <el-button type="primary" @click="saveFeatured" :loading="savingFeatured">保存代表作品</el-button>
          </div>
        </div>
      </template>

      <el-row :gutter="20">
        <el-col :span="12">
          <el-card shadow="never">
            <template #header>
              <div class="card-header">
                <span>该艺术家全部作品</span>
                <el-input v-model="artworkSearch" placeholder="搜索标题" size="small" style="max-width: 220px;" clearable />
              </div>
            </template>
            <el-scrollbar height="400px">
              <el-empty v-if="filteredAllArtworks.length === 0" description="暂无作品或未匹配" />
              <div v-else class="artwork-list">
                <div v-for="item in filteredAllArtworks" :key="item.id" class="artwork-item">
                  <img :src="getImageUrl(item.image)" class="artwork-thumb" alt="thumb" />
                  <div class="artwork-meta">
                    <div class="artwork-title" :title="item.title">{{ item.title }}</div>
                    <div class="artwork-sub">#{{ item.id }} · {{ item.year || '-' }}</div>
                  </div>
                  <div class="artwork-actions">
                    <el-button size="small" :disabled="isInFeatured(item.id)" @click="addToFeatured(item)">
                      {{ isInFeatured(item.id) ? '已添加' : '添加' }}
                    </el-button>
                  </div>
                </div>
              </div>
            </el-scrollbar>
          </el-card>
        </el-col>

        <el-col :span="12">
          <el-card shadow="never">
            <template #header>
              <div class="card-header">
                <span>已选代表作品（可排序）</span>
                <div>
                  <el-button size="small" @click="clearFeatured" :disabled="featuredList.length===0">清空</el-button>
                </div>
              </div>
            </template>
            <el-scrollbar height="400px">
              <el-empty v-if="featuredList.length === 0" description="未选择" />
              <div v-else class="artwork-list">
                <div v-for="(item, index) in featuredList" :key="item.id" class="artwork-item">
                  <img :src="getImageUrl(item.image)" class="artwork-thumb" alt="thumb" />
                  <div class="artwork-meta">
                    <div class="artwork-title" :title="item.title">{{ index + 1 }}. {{ item.title }}</div>
                    <div class="artwork-sub">#{{ item.id }} · {{ item.year || '-' }}</div>
                  </div>
                  <div class="artwork-actions">
                    <el-button size="small" :disabled="index===0" @click="moveUp(index)">上移</el-button>
                    <el-button size="small" :disabled="index===featuredList.length-1" @click="moveDown(index)">下移</el-button>
                    <el-button size="small" type="danger" @click="removeFromFeatured(index)">移除</el-button>
                  </div>
                </div>
              </div>
            </el-scrollbar>
          </el-card>
        </el-col>
      </el-row>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Upload, Delete, Loading } from '@element-plus/icons-vue'
import axios from '../utils/axios'
import { API_BASE_URL } from '../config'
import { uploadImageToWebpLimit5MB } from '../utils/image'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const savingFeatured = ref(false)
const artworkSearch = ref('')
const allArtworks = ref([])
const featuredList = ref([])
const showFeaturedManager = ref(true)
const featuredManagerRef = ref(null)

const form = ref({
  name: '',
  avatar: '',
  banner: '',
  era: '',
  description: '',
  journey: '',
  achievements: []
})

// 头像上传相关状态
const avatarInput = ref(null)
const isAvatarDragOver = ref(false)
const avatarUploadProgress = ref(0)
const isAvatarUploading = ref(false)
const isAvatarProcessing = ref(false)
const avatarFileName = ref('')
const avatarFileSize = ref(0)

// 背景图上传相关状态
const bannerInput = ref(null)
const isBannerDragOver = ref(false)
const bannerUploadProgress = ref(0)
const isBannerUploading = ref(false)
const isBannerProcessing = ref(false)
const bannerFileName = ref('')
const bannerFileSize = ref(0)

// 进度条颜色配置
const progressColors = [
  { color: '#f56c6c', percentage: 20 },
  { color: '#e6a23c', percentage: 40 },
  { color: '#5cb87a', percentage: 60 },
  { color: '#1989fa', percentage: 80 },
  { color: '#6f7ad3', percentage: 100 }
]

const fetchArtistDetail = async () => {
  loading.value = true
  try {
    const response = await axios.get(`/artists/${route.params.id}`)
    const data = response.data
    form.value = {
      ...data,
      achievements: data.achievements || []
    }
  } catch (error) {
    ElMessage.error('获取艺术家详情失败')
  } finally {
    loading.value = false
  }
}

// 头像上传相关函数
const triggerAvatarInput = () => {
  if (!isAvatarUploading.value && !isAvatarProcessing.value) {
    avatarInput.value?.click()
  }
}

const handleAvatarFileSelect = (event) => {
  const file = event.target.files[0]
  if (file) {
    uploadAvatarFile(file)
  }
  event.target.value = ''
}

const uploadAvatarFile = async (file) => {
  avatarUploadProgress.value = 0
  isAvatarUploading.value = true
  isAvatarProcessing.value = true
  avatarFileName.value = file.name
  avatarFileSize.value = file.size

  try {
    console.log('开始处理头像文件:', file.name, file.size)
    const processedFile = await uploadImageToWebpLimit5MB(file)
    
    if (!processedFile) {
      console.log('头像处理失败，终止上传')
      resetAvatarUploadState()
      return
    }

    console.log('头像处理成功:', processedFile.name, processedFile.size)
    
    isAvatarProcessing.value = false
    avatarFileName.value = processedFile.name
    avatarFileSize.value = processedFile.size

    const formData = new FormData()
    formData.append('file', processedFile)

    const response = await axios.post(`${API_BASE_URL}/api/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          avatarUploadProgress.value = percent
        } else {
          avatarUploadProgress.value = Math.min(avatarUploadProgress.value + 10, 90)
        }
      }
    })

    handleAvatarUploadSuccess(response)
  } catch (error) {
    handleAvatarUploadError(error)
  }
}

const handleAvatarUploadSuccess = (response) => {
  console.log('头像上传成功响应:', response)
  
  let imageUrl = ''
  
  if (response && response.url) {
    imageUrl = response.url
  } else if (response && response.data && response.data.url) {
    imageUrl = response.data.url
  } else if (response && response.data && typeof response.data === 'string') {
    imageUrl = response.data
  } else if (typeof response === 'string') {
    imageUrl = response
  } else if (response && response.path) {
    imageUrl = response.path
  } else if (response && response.file) {
    imageUrl = response.file
  } else if (response && response.filename) {
    imageUrl = response.filename
  }

  if (imageUrl) {
    form.value.avatar = imageUrl
    avatarUploadProgress.value = 100
    
    setTimeout(() => {
      avatarUploadProgress.value = 0
      isAvatarUploading.value = false
      avatarFileName.value = ''
      avatarFileSize.value = 0
    }, 2000)
    
    ElMessage.success('头像上传成功')
  } else {
    console.error('无法从响应中提取URL，完整响应:', response)
    ElMessage.error('头像上传失败：未获取到图片URL')
    resetAvatarUploadState()
  }
}

const handleAvatarUploadError = (error) => {
  console.error('头像上传错误:', error)
  ElMessage.error('头像上传失败：' + (error.response?.data?.message || '未知错误'))
  resetAvatarUploadState()
}

const resetAvatarUploadState = () => {
  avatarUploadProgress.value = 0
  isAvatarUploading.value = false
  isAvatarProcessing.value = false
  avatarFileName.value = ''
  avatarFileSize.value = 0
}

const removeAvatar = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要删除这张头像吗？',
      '确认删除',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
    form.value.avatar = ''
    ElMessage.success('头像已删除')
  } catch {
    // 用户取消删除
  }
}

// 头像拖拽处理函数
const handleAvatarDragEnter = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!isAvatarUploading.value && !isAvatarProcessing.value && !form.value.avatar) {
    isAvatarDragOver.value = true
  }
}

const handleAvatarDragLeave = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!e.currentTarget.contains(e.relatedTarget)) {
    isAvatarDragOver.value = false
  }
}

const handleAvatarDragOver = (e) => {
  e.preventDefault()
  e.stopPropagation()
}

const handleAvatarDrop = (e) => {
  e.preventDefault()
  e.stopPropagation()
  isAvatarDragOver.value = false
  
  if (isAvatarUploading.value || isAvatarProcessing.value || form.value.avatar) return
  
  const files = e.dataTransfer.files
  if (files.length > 0) {
    uploadAvatarFile(files[0])
  }
}

// 背景图上传相关函数
const triggerBannerInput = () => {
  if (!isBannerUploading.value && !isBannerProcessing.value) {
    bannerInput.value?.click()
  }
}

const handleBannerFileSelect = (event) => {
  const file = event.target.files[0]
  if (file) {
    uploadBannerFile(file)
  }
  event.target.value = ''
}

const uploadBannerFile = async (file) => {
  bannerUploadProgress.value = 0
  isBannerUploading.value = true
  isBannerProcessing.value = true
  bannerFileName.value = file.name
  bannerFileSize.value = file.size

  try {
    console.log('开始处理背景图文件:', file.name, file.size)
    const processedFile = await uploadImageToWebpLimit5MB(file)
    
    if (!processedFile) {
      console.log('背景图处理失败，终止上传')
      resetBannerUploadState()
      return
    }

    console.log('背景图处理成功:', processedFile.name, processedFile.size)
    
    isBannerProcessing.value = false
    bannerFileName.value = processedFile.name
    bannerFileSize.value = processedFile.size

    const formData = new FormData()
    formData.append('file', processedFile)

    const response = await axios.post(`${API_BASE_URL}/api/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          bannerUploadProgress.value = percent
        } else {
          bannerUploadProgress.value = Math.min(bannerUploadProgress.value + 10, 90)
        }
      }
    })

    handleBannerUploadSuccess(response)
  } catch (error) {
    handleBannerUploadError(error)
  }
}

const handleBannerUploadSuccess = (response) => {
  console.log('背景图上传成功响应:', response)
  
  let imageUrl = ''
  
  if (response && response.url) {
    imageUrl = response.url
  } else if (response && response.data && response.data.url) {
    imageUrl = response.data.url
  } else if (response && response.data && typeof response.data === 'string') {
    imageUrl = response.data
  } else if (typeof response === 'string') {
    imageUrl = response
  } else if (response && response.path) {
    imageUrl = response.path
  } else if (response && response.file) {
    imageUrl = response.file
  } else if (response && response.filename) {
    imageUrl = response.filename
  }

  if (imageUrl) {
    form.value.banner = imageUrl
    bannerUploadProgress.value = 100
    
    setTimeout(() => {
      bannerUploadProgress.value = 0
      isBannerUploading.value = false
      bannerFileName.value = ''
      bannerFileSize.value = 0
    }, 2000)
    
    ElMessage.success('背景图上传成功')
  } else {
    console.error('无法从响应中提取URL，完整响应:', response)
    ElMessage.error('背景图上传失败：未获取到图片URL')
    resetBannerUploadState()
  }
}

const handleBannerUploadError = (error) => {
  console.error('背景图上传错误:', error)
  ElMessage.error('背景图上传失败：' + (error.response?.data?.message || '未知错误'))
  resetBannerUploadState()
}

const resetBannerUploadState = () => {
  bannerUploadProgress.value = 0
  isBannerUploading.value = false
  isBannerProcessing.value = false
  bannerFileName.value = ''
  bannerFileSize.value = 0
}

const removeBanner = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要删除这张背景图吗？',
      '确认删除',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
    form.value.banner = ''
    ElMessage.success('背景图已删除')
  } catch {
    // 用户取消删除
  }
}

// 背景图拖拽处理函数
const handleBannerDragEnter = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!isBannerUploading.value && !isBannerProcessing.value && !form.value.banner) {
    isBannerDragOver.value = true
  }
}

const handleBannerDragLeave = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!e.currentTarget.contains(e.relatedTarget)) {
    isBannerDragOver.value = false
  }
}

const handleBannerDragOver = (e) => {
  e.preventDefault()
  e.stopPropagation()
}

const handleBannerDrop = (e) => {
  e.preventDefault()
  e.stopPropagation()
  isBannerDragOver.value = false
  
  if (isBannerUploading.value || isBannerProcessing.value || form.value.banner) return
  
  const files = e.dataTransfer.files
  if (files.length > 0) {
    uploadBannerFile(files[0])
  }
}

// 格式化文件大小
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const getImageUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('https://wx.oss.2000gallery.art/')) {
    return url;
  }
  return url.startsWith('http') ? url : `${API_BASE_URL}${url.startsWith('/') ? url : `/${url}`}`;
}

const fetchAllArtworks = async () => {
  try {
    const { data } = await axios.get(`/original-artworks`, { params: { artist_id: route.params.id, pageSize: 1000 } })
    allArtworks.value = data?.data || []
  } catch (e) {
    allArtworks.value = []
  }
}

const fetchFeatured = async () => {
  try {
    const { data } = await axios.get(`/artists/${route.params.id}/featured-artworks`)
    featuredList.value = data?.data || []
  } catch (e) {
    featuredList.value = []
  }
}

const isInFeatured = (id) => featuredList.value.some(i => i.id === id)
const addToFeatured = (item) => {
  if (!isInFeatured(item.id)) featuredList.value.push(item)
}
const removeFromFeatured = (index) => {
  featuredList.value.splice(index, 1)
}
const moveUp = (index) => {
  if (index <= 0) return
  const tmp = featuredList.value[index - 1]
  featuredList.value[index - 1] = featuredList.value[index]
  featuredList.value[index] = tmp
}
const moveDown = (index) => {
  if (index >= featuredList.value.length - 1) return
  const tmp = featuredList.value[index + 1]
  featuredList.value[index + 1] = featuredList.value[index]
  featuredList.value[index] = tmp
}
const clearFeatured = () => {
  featuredList.value = []
}

const filteredAllArtworks = computed(() => {
  const raw = (artworkSearch.value || '').toString().trim().toLowerCase()
  if (!raw) return allArtworks.value
  return allArtworks.value.filter(a => {
    const title = (a.title || '').toString().toLowerCase()
    const idStr = (a.id != null ? String(a.id) : '')
    const yearStr = (a.year != null ? String(a.year) : '')
    return title.includes(raw) || idStr.includes(raw) || yearStr.includes(raw)
  })
})

const saveFeatured = async () => {
  try {
    savingFeatured.value = true
    const ids = featuredList.value.map(i => i.id)
    await axios.put(`/artists/${route.params.id}/featured-artworks`, { artwork_ids: ids })
    ElMessage.success('已保存代表作品')
    // 重新获取艺术家详情，确保数据同步
    await fetchArtistDetail()
  } catch (e) {
    ElMessage.error(e?.response?.data?.error || '保存失败')
  } finally {
    savingFeatured.value = false
  }
}

const goToFeaturedManager = async () => {
  showFeaturedManager.value = true
  await nextTick()
  const el = featuredManagerRef.value && (featuredManagerRef.value.$el || featuredManagerRef.value)
  if (el && el.scrollIntoView) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

const addAchievement = () => {
  form.value.achievements.push({
    title: '',
    description: ''
  })
}

const removeAchievement = (index) => {
  form.value.achievements.splice(index, 1)
}

const handleEdit = async () => {
  try {
    await axios.put(`/artists/${route.params.id}`, form.value)
    ElMessage.success('更新成功')
  } catch (error) {
    ElMessage.error('更新失败')
  }
}

const goBack = () => {
  router.push('/artists')
}

onMounted(() => {
  fetchArtistDetail()
  fetchAllArtworks()
  fetchFeatured()
})
</script>

<style scoped>
.artist-detail {
  padding: 20px;
}

.detail-card {
  margin-top: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* 图片上传容器 */
.image-upload-container {
  width: 100%;
  max-width: 400px;
}

/* 图片预览 */
.image-preview {
  position: relative;
  width: 200px;
  height: 200px;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
}

.image-preview:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.preview-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  opacity: 0;
  transition: opacity 0.3s ease;
  gap: 10px;
}

.image-preview:hover .image-overlay {
  opacity: 1;
}

.remove-btn {
  background: rgba(245, 108, 108, 0.9);
  border: none;
}

.remove-btn:hover {
  background: #f56c6c;
}

.replace-btn {
  background: rgba(64, 158, 255, 0.9);
  border: none;
}

.replace-btn:hover {
  background: #409eff;
}

/* 上传区域 */
.upload-zone {
  width: 200px;
  height: 200px;
  border: 2px dashed #d9d9d9;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
  background: #fafafa;
}

.upload-zone:hover {
  border-color: #409eff;
  background: #f0f9ff;
}

.upload-zone.drag-over {
  border-color: #409eff;
  background: #ecf5ff;
  transform: scale(1.02);
  box-shadow: 0 0 20px rgba(64, 158, 255, 0.3);
}

.upload-zone.uploading {
  opacity: 0.7;
  pointer-events: none;
  border-color: #409eff;
  background: #f0f9ff;
}

.upload-content {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  padding: 20px;
  box-sizing: border-box;
}

.upload-icon {
  font-size: 48px;
  color: #8c939d;
  margin-bottom: 16px;
  transition: all 0.3s ease;
}

.upload-icon.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.upload-text {
  text-align: center;
}

.upload-title {
  margin: 0 0 8px 0;
  color: #606266;
  font-size: 14px;
  font-weight: 500;
}

.upload-hint {
  margin: 0;
  color: #909399;
  font-size: 12px;
  line-height: 1.4;
}

/* 拖拽遮罩 */
.drag-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(64, 158, 255, 0.1);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  color: #409eff;
  font-weight: bold;
  z-index: 10;
  border-radius: 8px;
}

.drag-icon {
  font-size: 48px;
  margin-bottom: 10px;
}

/* 上传进度 */
.upload-progress {
  margin-top: 16px;
  padding: 16px;
  background: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #e9ecef;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.progress-title {
  font-size: 14px;
  font-weight: 500;
  color: #606266;
}

.progress-percentage {
  font-size: 14px;
  font-weight: bold;
  color: #409eff;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  font-size: 12px;
  color: #909399;
}

.file-name {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.processing-hint {
  margin-top: 8px;
  text-align: center;
}

.processing-hint p {
  margin: 0;
  color: #909399;
  font-size: 12px;
  font-style: italic;
}

/* 上传成功提示 */
.upload-success {
  margin-top: 16px;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .image-upload-container {
    max-width: 100%;
  }
  
  .image-preview,
  .upload-zone {
    width: 100%;
    max-width: 300px;
    height: 200px;
  }
}

.achievement-item {
  margin-bottom: 20px;
  padding: 10px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
}
</style> 