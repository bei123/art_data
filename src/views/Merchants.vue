<template>
  <div class="merchants-container">
    <div class="header">
      <h2>商家管理</h2>
      <div class="header-actions">
        <el-input
          v-model="searchQuery"
          placeholder="搜索商家名称或描述"
          style="width: 300px; margin-right: 16px"
          clearable
          @clear="handleSearch"
          @keyup.enter="handleSearch"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-button type="primary" @click="showAddDialog">添加商家</el-button>
      </div>
    </div>

    <el-table :data="merchants" style="width: 100%" v-loading="loading">
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column label="Logo" width="100">
        <template #default="{ row }">
          <el-image 
            :src="row.logo" 
            :preview-src-list="[row.logo]"
            fit="cover"
            style="width: 50px; height: 50px"
          />
        </template>
      </el-table-column>
      <el-table-column prop="name" label="商家名称" />
      <el-table-column prop="description" label="描述" show-overflow-tooltip />
      <el-table-column prop="address" label="地址" show-overflow-tooltip />
      <el-table-column prop="phone" label="电话" width="120" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-switch
            v-model="row.status"
            :active-value="'active'"
            :inactive-value="'inactive'"
            @change="handleStatusChange(row)"
          />
        </template>
      </el-table-column>
      <el-table-column label="排序" width="120">
        <template #default="{ row }">
          <el-input-number
            v-model="row.sort_order"
            :min="0"
            :max="999"
            size="small"
            @change="handleSortChange(row)"
          />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button type="primary" link @click="handleEdit(row)">编辑</el-button>
          <el-button type="danger" link @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination-container">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        :total="total"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="handleSizeChange"
        @current-change="handleCurrentChange"
      />
    </div>

    <!-- 添加/编辑商家对话框 -->
    <el-dialog
      :title="dialogType === 'add' ? '添加商家' : '编辑商家'"
      v-model="dialogVisible"
      width="600px"
    >
      <el-form :model="form" :rules="rules" ref="formRef" label-width="100px">
        <el-form-item label="商家名称" prop="name">
          <el-input v-model="form.name" />
        </el-form-item>
        
        <el-form-item label="地址" prop="address">
          <el-input v-model="form.address" />
        </el-form-item>

        <el-form-item label="电话" prop="phone">
          <el-input v-model="form.phone" />
        </el-form-item>

        <el-form-item label="Logo" required>
          <div class="image-upload-container">
            <!-- 图片预览区域 -->
            <div class="image-preview" v-if="form.logo">
              <img :src="getImageUrl(form.logo)" class="preview-image" alt="Logo" />
              <div class="image-overlay">
                <el-button 
                  type="danger" 
                  size="small" 
                  circle 
                  @click="removeLogo"
                  class="remove-btn"
                >
                  <el-icon><Delete /></el-icon>
                </el-button>
                <el-button 
                  type="primary" 
                  size="small" 
                  @click="triggerLogoInput"
                  class="replace-btn"
                >
                  更换Logo
                </el-button>
              </div>
            </div>

            <!-- 上传区域 -->
            <div 
              v-else
              class="upload-zone"
              :class="{ 
                'drag-over': isLogoDragOver, 
                'uploading': isLogoUploading || isLogoProcessing 
              }"
              @click="triggerLogoInput"
              @dragenter="handleLogoDragEnter"
              @dragleave="handleLogoDragLeave"
              @dragover="handleLogoDragOver"
              @drop="handleLogoDrop"
            >
              <div class="upload-content">
                <el-icon class="upload-icon" :class="{ 'spinning': isLogoUploading || isLogoProcessing }">
                  <component :is="(isLogoUploading || isLogoProcessing) ? 'Loading' : 'Upload'" />
                </el-icon>
                <div class="upload-text">
                  <p class="upload-title">
                    {{ isLogoProcessing ? '正在处理图片...' : isLogoUploading ? '正在上传...' : '点击或拖拽图片到此处上传' }}
                  </p>
                  <p class="upload-hint">支持 JPG、PNG、GIF 格式，自动转换为 WebP 格式并压缩至 5MB 以内</p>
                </div>
              </div>
              
              <!-- 拖拽提示遮罩 -->
              <div v-if="isLogoDragOver && !form.logo" class="drag-overlay">
                <el-icon class="drag-icon"><Upload /></el-icon>
                <p>释放鼠标上传图片</p>
              </div>
            </div>

            <!-- 隐藏的文件输入 -->
            <input
              ref="logoInput"
              type="file"
              accept="image/*"
              style="display: none"
              @change="handleLogoFileSelect"
            />

            <!-- 图片处理提示 -->
            <div v-if="isLogoProcessing" class="upload-progress">
              <div class="progress-header">
                <span class="progress-title">图片处理中</span>
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
                <span class="file-name">{{ logoFileName }}</span>
                <span class="file-size">{{ formatFileSize(logoFileSize) }}</span>
              </div>
              <div class="processing-hint">
                <p>正在将图片转换为 WebP 格式并压缩...</p>
              </div>
            </div>

            <!-- 上传进度条 -->
            <div v-if="logoUploadProgress > 0 && logoUploadProgress < 100 && !isLogoProcessing" class="upload-progress">
              <div class="progress-header">
                <span class="progress-title">上传进度</span>
                <span class="progress-percentage">{{ logoUploadProgress }}%</span>
              </div>
              <el-progress 
                :percentage="logoUploadProgress" 
                :stroke-width="6"
                :show-text="false"
                :color="progressColors"
              />
              <div class="progress-info">
                <span class="file-name">{{ logoFileName }}</span>
                <span class="file-size">{{ formatFileSize(logoFileSize) }}</span>
              </div>
            </div>

            <!-- 上传完成提示 -->
            <div v-if="logoUploadProgress === 100" class="upload-success">
              <el-alert
                title="图片上传成功！"
                type="success"
                :closable="false"
                show-icon
              />
            </div>
          </div>
        </el-form-item>

        <el-form-item label="商家图片" required>
          <div class="images-upload-container">
            <!-- 已上传的图片列表 -->
            <div class="images-list" v-if="form.images.length > 0">
              <div 
                v-for="(image, index) in form.images" 
                :key="index"
                class="image-item"
              >
                <img :src="getImageUrl(image)" class="item-image" alt="商家图片" />
                <div class="item-overlay">
                  <el-button 
                    type="danger" 
                    size="small" 
                    circle 
                    @click="removeImage(index)"
                    class="remove-btn"
                  >
                    <el-icon><Delete /></el-icon>
                  </el-button>
                </div>
              </div>
            </div>

            <!-- 添加图片按钮 -->
            <div 
              v-if="form.images.length < 5"
              class="add-image-btn"
              :class="{ 
                'drag-over': isImagesDragOver, 
                'uploading': isImagesUploading || isImagesProcessing 
              }"
              @click="triggerImagesInput"
              @dragenter="handleImagesDragEnter"
              @dragleave="handleImagesDragLeave"
              @dragover="handleImagesDragOver"
              @drop="handleImagesDrop"
            >
              <el-icon class="add-icon" :class="{ 'spinning': isImagesUploading || isImagesProcessing }">
                <component :is="(isImagesUploading || isImagesProcessing) ? 'Loading' : 'Plus'" />
              </el-icon>
              <p class="add-text">添加图片</p>
              <p class="add-hint">最多5张，支持拖拽</p>
            </div>

            <!-- 隐藏的文件输入 -->
            <input
              ref="imagesInput"
              type="file"
              accept="image/*"
              multiple
              style="display: none"
              @change="handleImagesFileSelect"
            />

            <!-- 图片处理提示 -->
            <div v-if="isImagesProcessing" class="upload-progress">
              <div class="progress-header">
                <span class="progress-title">图片处理中</span>
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
                <span class="file-name">{{ imagesFileName }}</span>
                <span class="file-size">{{ formatFileSize(imagesFileSize) }}</span>
              </div>
              <div class="processing-hint">
                <p>正在将图片转换为 WebP 格式并压缩...</p>
              </div>
            </div>

            <!-- 上传进度条 -->
            <div v-if="imagesUploadProgress > 0 && imagesUploadProgress < 100 && !isImagesProcessing" class="upload-progress">
              <div class="progress-header">
                <span class="progress-title">上传进度</span>
                <span class="progress-percentage">{{ imagesUploadProgress }}%</span>
              </div>
              <el-progress 
                :percentage="imagesUploadProgress" 
                :stroke-width="6"
                :show-text="false"
                :color="progressColors"
              />
              <div class="progress-info">
                <span class="file-name">{{ imagesFileName }}</span>
                <span class="file-size">{{ formatFileSize(imagesFileSize) }}</span>
              </div>
            </div>

            <!-- 上传完成提示 -->
            <div v-if="imagesUploadProgress === 100" class="upload-success">
              <el-alert
                title="图片上传成功！"
                type="success"
                :closable="false"
                show-icon
              />
            </div>
          </div>
        </el-form-item>

        <el-form-item label="描述" prop="description">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="4"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" @click="handleSubmit">确定</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search, Upload, Delete, Loading } from '@element-plus/icons-vue'
import axios from 'axios'
import { uploadImageToWebpLimit5MB } from '../utils/image'

const baseUrl = import.meta.env.VITE_API_BASE_URL || 'https://api.wx.2000gallery.art:2000'

// Logo上传相关状态
const logoInput = ref(null)
const isLogoDragOver = ref(false)
const logoUploadProgress = ref(0)
const isLogoUploading = ref(false)
const isLogoProcessing = ref(false)
const logoFileName = ref('')
const logoFileSize = ref(0)

// 商家图片上传相关状态
const imagesInput = ref(null)
const isImagesDragOver = ref(false)
const imagesUploadProgress = ref(0)
const isImagesUploading = ref(false)
const isImagesProcessing = ref(false)
const imagesFileName = ref('')
const imagesFileSize = ref(0)

// 进度条颜色配置
const progressColors = [
  { color: '#f56c6c', percentage: 20 },
  { color: '#e6a23c', percentage: 40 },
  { color: '#5cb87a', percentage: 60 },
  { color: '#1989fa', percentage: 80 },
  { color: '#6f7ad3', percentage: 100 }
]

// 添加getImageUrl函数
const getImageUrl = (url) => {
  if (!url) return ''
  if (url.startsWith('http')) return url
  return `${baseUrl}${url}`
}

// 创建axios实例
const request = axios.create({
  baseURL: baseUrl,
  timeout: 15000
})

// 请求拦截器
request.interceptors.request.use(
  config => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  error => {
    return Promise.reject(error)
  }
)

// 响应拦截器
request.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      ElMessage.error('登录已过期，请重新登录')
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// 修改上传组件的action
const uploadAction = `${baseUrl}/api/merchants/upload-logo`
const uploadImagesAction = `${baseUrl}/api/merchants/upload-images`

const merchants = ref([])
const loading = ref(false)
const dialogVisible = ref(false)
const dialogType = ref('add')
const formRef = ref(null)
const form = ref({
  name: '',
  logo: '',
  description: '',
  address: '',
  phone: '',
  images: []
})
const imagesFileList = ref([])
const searchQuery = ref('')
const currentPage = ref(1)
const pageSize = ref(10)
const total = ref(0)

const rules = {
  name: [{ required: true, message: '请输入商家名称', trigger: 'blur' }],
  logo: [{ required: true, message: '请上传Logo', trigger: 'change' }],
  description: [{ required: true, message: '请输入商家描述', trigger: 'blur' }],
  address: [{ required: true, message: '请输入商家地址', trigger: 'blur' }],
  phone: [
    { required: true, message: '请输入商家电话', trigger: 'blur' },
    { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号码', trigger: 'blur' }
  ]
}

const uploadHeaders = {
  Authorization: `Bearer ${localStorage.getItem('token')}`
}

// 获取商家列表
const fetchMerchants = async () => {
  loading.value = true
  try {
    const response = await request.get('/api/merchants', {
      params: {
        page: currentPage.value,
        limit: pageSize.value,
        search: searchQuery.value
      }
    })
    merchants.value = response.data.data
    total.value = response.data.pagination.total
  } catch (error) {
    ElMessage.error('获取商家列表失败')
  } finally {
    loading.value = false
  }
}

// 处理搜索
const handleSearch = () => {
  currentPage.value = 1
  fetchMerchants()
}

// 处理分页
const handleSizeChange = (val) => {
  pageSize.value = val
  fetchMerchants()
}

const handleCurrentChange = (val) => {
  currentPage.value = val
  fetchMerchants()
}

// 处理状态变更
const handleStatusChange = async (row) => {
  try {
    await request.patch(`/api/merchants/${row.id}/status`, {
      status: row.status
    })
    ElMessage.success('状态更新成功')
  } catch (error) {
    row.status = row.status === 'active' ? 'inactive' : 'active'
    ElMessage.error('状态更新失败')
  }
}

// 处理排序变更
const handleSortChange = async (row) => {
  try {
    await request.patch(`/api/merchants/${row.id}/sort`, {
      sort_order: row.sort_order
    })
    ElMessage.success('排序更新成功')
  } catch (error) {
    ElMessage.error('排序更新失败')
  }
}

// 处理删除
const handleDelete = async (row) => {
  try {
    await ElMessageBox.confirm('确定要删除该商家吗？', '提示', {
      type: 'warning'
    })
    
    await request.delete(`/api/merchants/${row.id}`)
    ElMessage.success('删除成功')
    fetchMerchants()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
}

// Logo上传相关函数
const triggerLogoInput = () => {
  if (!isLogoUploading.value && !isLogoProcessing.value) {
    logoInput.value?.click()
  }
}

const handleLogoFileSelect = (event) => {
  const file = event.target.files[0]
  if (file) {
    uploadLogoFile(file)
  }
  event.target.value = ''
}

const uploadLogoFile = async (file) => {
  logoUploadProgress.value = 0
  isLogoUploading.value = true
  isLogoProcessing.value = true
  logoFileName.value = file.name
  logoFileSize.value = file.size

  try {
    console.log('开始处理Logo文件:', file.name, file.size)
    const processedFile = await uploadImageToWebpLimit5MB(file)
    
    if (!processedFile) {
      console.log('Logo处理失败，终止上传')
      resetLogoUploadState()
      return
    }

    console.log('Logo处理成功:', processedFile.name, processedFile.size)
    
    isLogoProcessing.value = false
    logoFileName.value = processedFile.name
    logoFileSize.value = processedFile.size

    const formData = new FormData()
    formData.append('file', processedFile)

    const response = await request.post('/api/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          logoUploadProgress.value = percent
        } else {
          logoUploadProgress.value = Math.min(logoUploadProgress.value + 10, 90)
        }
      }
    })

    handleLogoUploadSuccess(response)
  } catch (error) {
    handleLogoUploadError(error)
  }
}

const handleLogoUploadSuccess = (response) => {
  console.log('Logo上传成功响应:', response)
  
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
    form.value.logo = imageUrl
    logoUploadProgress.value = 100
    
    setTimeout(() => {
      logoUploadProgress.value = 0
      isLogoUploading.value = false
      logoFileName.value = ''
      logoFileSize.value = 0
    }, 2000)
    
    ElMessage.success('Logo上传成功')
  } else {
    console.error('无法从响应中提取URL，完整响应:', response)
    ElMessage.error('Logo上传失败：未获取到图片URL')
    resetLogoUploadState()
  }
}

const handleLogoUploadError = (error) => {
  console.error('Logo上传错误:', error)
  ElMessage.error('Logo上传失败：' + (error.response?.data?.message || '未知错误'))
  resetLogoUploadState()
}

const resetLogoUploadState = () => {
  logoUploadProgress.value = 0
  isLogoUploading.value = false
  isLogoProcessing.value = false
  logoFileName.value = ''
  logoFileSize.value = 0
}

const removeLogo = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要删除这个Logo吗？',
      '确认删除',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
    form.value.logo = ''
    ElMessage.success('Logo已删除')
  } catch {
    // 用户取消删除
  }
}

// 商家图片上传相关函数
const triggerImagesInput = () => {
  if (!isImagesUploading.value && !isImagesProcessing.value) {
    imagesInput.value?.click()
  }
}

const handleImagesFileSelect = (event) => {
  const files = Array.from(event.target.files)
  if (files.length > 0) {
    uploadImagesFiles(files)
  }
  event.target.value = ''
}

const uploadImagesFiles = async (files) => {
  if (form.value.images.length + files.length > 5) {
    ElMessage.warning('最多只能上传5张图片')
    return
  }

  isImagesUploading.value = true
  isImagesProcessing.value = true

  for (const file of files) {
    try {
      console.log('开始处理图片文件:', file.name, file.size)
      const processedFile = await uploadImageToWebpLimit5MB(file)
      
      if (!processedFile) {
        console.log('图片处理失败，跳过上传')
        continue
      }

      console.log('图片处理成功:', processedFile.name, processedFile.size)
      
      isImagesProcessing.value = false
      imagesFileName.value = processedFile.name
      imagesFileSize.value = processedFile.size

      const formData = new FormData()
      formData.append('file', processedFile)

      const response = await request.post('/api/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
            imagesUploadProgress.value = percent
          } else {
            imagesUploadProgress.value = Math.min(imagesUploadProgress.value + 10, 90)
          }
        }
      })

      handleImagesUploadSuccess(response)
    } catch (error) {
      handleImagesUploadError(error)
    }
  }

  resetImagesUploadState()
}

const handleImagesUploadSuccess = (response) => {
  console.log('图片上传成功响应:', response)
  
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
    form.value.images.push(imageUrl)
    imagesUploadProgress.value = 100
    
    setTimeout(() => {
      imagesUploadProgress.value = 0
    }, 2000)
    
    ElMessage.success('图片上传成功')
  } else {
    console.error('无法从响应中提取URL，完整响应:', response)
    ElMessage.error('图片上传失败：未获取到图片URL')
  }
}

const handleImagesUploadError = (error) => {
  console.error('图片上传错误:', error)
  ElMessage.error('图片上传失败：' + (error.response?.data?.message || '未知错误'))
}

const resetImagesUploadState = () => {
  imagesUploadProgress.value = 0
  isImagesUploading.value = false
  isImagesProcessing.value = false
  imagesFileName.value = ''
  imagesFileSize.value = 0
}

const removeImage = async (index) => {
  try {
    await ElMessageBox.confirm(
      '确定要删除这张图片吗？',
      '确认删除',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
    form.value.images.splice(index, 1)
    ElMessage.success('图片已删除')
  } catch {
    // 用户取消删除
  }
}

// 拖拽处理函数
const handleLogoDragEnter = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!isLogoUploading.value && !isLogoProcessing.value && !form.value.logo) {
    isLogoDragOver.value = true
  }
}

const handleLogoDragLeave = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!e.currentTarget.contains(e.relatedTarget)) {
    isLogoDragOver.value = false
  }
}

const handleLogoDragOver = (e) => {
  e.preventDefault()
  e.stopPropagation()
}

const handleLogoDrop = (e) => {
  e.preventDefault()
  e.stopPropagation()
  isLogoDragOver.value = false
  
  if (isLogoUploading.value || isLogoProcessing.value || form.value.logo) return
  
  const files = e.dataTransfer.files
  if (files.length > 0) {
    uploadLogoFile(files[0])
  }
}

const handleImagesDragEnter = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!isImagesUploading.value && !isImagesProcessing.value && form.value.images.length < 5) {
    isImagesDragOver.value = true
  }
}

const handleImagesDragLeave = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!e.currentTarget.contains(e.relatedTarget)) {
    isImagesDragOver.value = false
  }
}

const handleImagesDragOver = (e) => {
  e.preventDefault()
  e.stopPropagation()
}

const handleImagesDrop = (e) => {
  e.preventDefault()
  e.stopPropagation()
  isImagesDragOver.value = false
  
  if (isImagesUploading.value || isImagesProcessing.value || form.value.images.length >= 5) return
  
  const files = Array.from(e.dataTransfer.files)
  if (files.length > 0) {
    uploadImagesFiles(files)
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

// 显示添加对话框
const showAddDialog = () => {
  dialogType.value = 'add'
  form.value = {
    name: '',
    logo: '',
    description: '',
    address: '',
    phone: '',
    images: []
  }
  dialogVisible.value = true
}

// 显示编辑对话框
const handleEdit = (row) => {
  dialogType.value = 'edit'
  form.value = {
    id: row.id,
    name: row.name,
    logo: row.logo,
    description: row.description,
    address: row.address,
    phone: row.phone,
    images: row.images || []
  }
  imagesFileList.value = (row.images || []).map(url => ({
    name: url.split('/').pop(),
    url,
    status: 'success',
    response: { fullUrl: url }
  }))
  dialogVisible.value = true
}

// 提交表单
const handleSubmit = async () => {
  if (!formRef.value) return
  await formRef.value.validate(async (valid) => {
    if (valid) {
      console.log('提交数据:', JSON.stringify(form.value, null, 2))
      try {
        if (dialogType.value === 'add') {
          await request.post('/api/merchants', form.value)
          ElMessage.success('添加成功')
        } else {
          await request.put(`/api/merchants/${form.value.id}`, form.value)
          ElMessage.success('更新成功')
        }
        dialogVisible.value = false
        fetchMerchants()
      } catch (error) {
        ElMessage.error(dialogType.value === 'add' ? '添加失败' : '更新失败')
      }
    }
  })
}

onMounted(() => {
  fetchMerchants()
})
</script>

<style scoped>
.merchants-container {
  padding: 20px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.header-actions {
  display: flex;
  align-items: center;
}

.pagination-container {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
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

/* 商家图片上传容器 */
.images-upload-container {
  width: 100%;
}

.images-list {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 16px;
}

.image-item {
  position: relative;
  width: 120px;
  height: 120px;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
}

.image-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.item-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.item-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.image-item:hover .item-overlay {
  opacity: 1;
}

.add-image-btn {
  width: 120px;
  height: 120px;
  border: 2px dashed #d9d9d9;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: #fafafa;
}

.add-image-btn:hover {
  border-color: #409eff;
  background: #f0f9ff;
}

.add-image-btn.drag-over {
  border-color: #409eff;
  background: #ecf5ff;
  transform: scale(1.02);
  box-shadow: 0 0 20px rgba(64, 158, 255, 0.3);
}

.add-image-btn.uploading {
  opacity: 0.7;
  pointer-events: none;
  border-color: #409eff;
  background: #f0f9ff;
}

.add-icon {
  font-size: 32px;
  color: #8c939d;
  margin-bottom: 8px;
  transition: all 0.3s ease;
}

.add-icon.spinning {
  animation: spin 1s linear infinite;
}

.add-text {
  margin: 0 0 4px 0;
  color: #606266;
  font-size: 14px;
  font-weight: 500;
}

.add-hint {
  margin: 0;
  color: #909399;
  font-size: 12px;
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
  
  .images-list {
    gap: 12px;
  }
  
  .image-item,
  .add-image-btn {
    width: 100px;
    height: 100px;
  }
}
</style> 