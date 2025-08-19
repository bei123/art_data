<template>
  <div class="artwork-detail">
    <el-page-header @back="goBack" :title="'返回列表'" />
    
    <el-card v-loading="loading" class="detail-card">
      <template #header>
        <div class="card-header">
          <span>作品详情</span>
          <el-button type="primary" @click="handleEdit">编辑</el-button>
        </div>
      </template>

      <el-form :model="form" label-width="120px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="作品标题">
              <el-input v-model="form.title" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="创作年份">
              <el-input-number v-model="form.year" :min="1900" :max="2100" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="作品图片" required>
          <!-- 重构后的图片上传组件 -->
          <div class="image-upload-container">
            <!-- 图片预览区域 -->
            <div class="image-preview" v-if="form.image">
              <img :src="form.image" class="preview-image" alt="作品图片" />
              <div class="image-overlay">
                <el-button 
                  type="danger" 
                  size="small" 
                  circle 
                  @click="removeImage"
                  class="remove-btn"
                >
                  <el-icon><Delete /></el-icon>
                </el-button>
                                 <el-button 
                   type="primary" 
                   size="small" 
                   @click="triggerImageInput"
                   class="replace-btn"
                 >
                   更换图片
                 </el-button>
              </div>
            </div>

            <!-- 上传区域 -->
                         <div 
               v-else
               class="upload-zone"
               :class="{ 
                 'drag-over': isImageDragOver, 
                 'uploading': isImageUploading || isImageProcessing 
               }"
               @click="triggerImageInput"
               @dragenter="handleImageDragEnter"
               @dragleave="handleImageDragLeave"
               @dragover="handleImageDragOver"
               @drop="handleImageDrop"
             >
               <div class="upload-content">
                 <el-icon class="upload-icon" :class="{ 'spinning': isImageUploading || isImageProcessing }">
                   <component :is="(isImageUploading || isImageProcessing) ? 'Loading' : 'Upload'" />
                 </el-icon>
                 <div class="upload-text">
                                    <p class="upload-title">
                   {{ isImageProcessing ? '正在处理图片...' : isImageUploading ? '正在上传...' : '点击或拖拽图片到此处上传' }}
                 </p>
                   <p class="upload-hint">支持 JPG、PNG、GIF 格式，自动转换为 WebP 格式并压缩至 5MB 以内</p>
                 </div>
               </div>
              
                             <!-- 拖拽提示遮罩 -->
               <div v-if="isImageDragOver && !form.image" class="drag-overlay">
                 <el-icon class="drag-icon"><Upload /></el-icon>
                 <p>释放鼠标上传图片</p>
               </div>
            </div>

            <!-- 隐藏的文件输入 -->
            <input
              ref="imageInput"
              type="file"
              accept="image/*"
              style="display: none"
              @change="handleImageFileSelect"
            />

                         <!-- 图片处理提示 -->
             <div v-if="isImageProcessing" class="upload-progress">
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
                 <span class="file-name">{{ imageFileName }}</span>
                 <span class="file-size">{{ formatFileSize(imageFileSize) }}</span>
               </div>
               <div class="processing-hint">
                 <p>正在将图片转换为 WebP 格式并压缩...</p>
               </div>
             </div>

             <!-- 上传进度条 -->
             <div v-if="imageUploadProgress > 0 && imageUploadProgress < 100 && !isImageProcessing" class="upload-progress">
               <div class="progress-header">
                 <span class="progress-title">上传进度</span>
                 <span class="progress-percentage">{{ imageUploadProgress }}%</span>
               </div>
               <el-progress 
                 :percentage="imageUploadProgress" 
                 :stroke-width="6"
                 :show-text="false"
                 :color="progressColors"
               />
               <div class="progress-info">
                 <span class="file-name">{{ imageFileName }}</span>
                 <span class="file-size">{{ formatFileSize(imageFileSize) }}</span>
               </div>
             </div>

            <!-- 上传完成提示 -->
            <div v-if="imageUploadProgress === 100" class="upload-success">
              <el-alert
                title="图片上传成功！"
                type="success"
                :closable="false"
                show-icon
              />
            </div>
          </div>
        </el-form-item>

        <el-form-item label="作品描述">
          <el-input v-model="form.description" type="textarea" :rows="4" />
        </el-form-item>

        <el-form-item label="创作背景">
          <el-input v-model="form.background" type="textarea" :rows="4" />
        </el-form-item>

        <el-form-item label="作品特点">
          <el-input v-model="form.features" type="textarea" :rows="4" />
        </el-form-item>

        <el-divider>收藏信息</el-divider>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="收藏位置">
              <el-input v-model="form.collection.location" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="收藏编号">
              <el-input v-model="form.collection.number" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="作品尺寸">
              <el-input v-model="form.collection.size" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="作品材质">
              <el-input v-model="form.collection.material" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider>艺术家信息</el-divider>

        <el-form-item label="艺术家">
          <el-select v-model="form.artist.id" filterable placeholder="请选择艺术家">
            <el-option
              v-for="artist in artists"
              :key="artist.id"
              :label="artist.name"
              :value="artist.id"
            />
          </el-select>
        </el-form-item>

        <el-divider>价格和库存信息</el-divider>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="价格">
              <el-input-number v-model="form.price" :min="0" :precision="2" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="库存">
              <el-input-number v-model="form.stock" :min="0" :precision="0" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="折扣价格">
              <el-input-number v-model="form.discount_price" :min="0" :precision="2" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="原价">
              <el-input-number v-model="form.original_price" :min="0" :precision="2" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="销量">
              <el-input-number v-model="form.sales" :min="0" :precision="0" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="状态">
              <el-switch
                v-model="form.is_on_sale"
                :active-value="1"
                :inactive-value="0"
                active-text="在售"
                inactive-text="下架"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="详情富文本">
          <div v-html="form.long_description"></div>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Upload, Delete, Loading } from '@element-plus/icons-vue'
import axios from '../utils/axios'
import { API_BASE_URL } from '../config'
import { uploadImageToWebpLimit5MB } from '../utils/image'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const artists = ref([])
const isImageDragOver = ref(false)
const imageUploadProgress = ref(0)
const isImageUploading = ref(false)
const isImageProcessing = ref(false) // 新增：图片处理状态
const imageInput = ref(null)
const imageFileName = ref('')
const imageFileSize = ref(0)

// 进度条颜色配置
const progressColors = [
  { color: '#f56c6c', percentage: 20 },
  { color: '#e6a23c', percentage: 40 },
  { color: '#5cb87a', percentage: 60 },
  { color: '#1989fa', percentage: 80 },
  { color: '#6f7ad3', percentage: 100 }
]

// 检查登录状态
const checkLoginStatus = () => {
  const token = localStorage.getItem('token')
  if (!token) {
    ElMessage.warning('请先登录')
    router.push('/login')
    return false
  }
  return true
}

const form = ref({
  title: '',
  year: new Date().getFullYear(),
  image: '',
  description: '',
  background: '',
  features: '',
  collection: {
    location: '',
    number: '',
    size: '',
    material: ''
  },
  artist: {
    id: null
  },
  price: 0,
  stock: 0,
  discount_price: 0,
  original_price: 0,
  sales: 0,
  is_on_sale: 1,
  long_description: ''
})

const fetchArtists = async () => {
  if (!checkLoginStatus()) return
  try {
    const response = await axios.get('/artists')
    artists.value = response.data
  } catch (error) {
    if (error.response) {
      if (error.response.status === 401) {
        ElMessage.error('登录已过期，请重新登录')
        router.push('/login')
      } else {
        ElMessage.error('获取艺术家列表失败')
      }
    } else {
      ElMessage.error('获取艺术家列表失败')
    }
  }
}

const fetchArtworkDetail = async () => {
  if (!checkLoginStatus()) return
  loading.value = true
  try {
    const response = await axios.get(`/original-artworks/${route.params.id}`)
    const data = response.data
    form.value = {
      title: data.title,
      year: data.year,
      image: data.image,
      description: data.description,
      background: data.background,
      features: data.features,
      collection: {
        location: data.collection?.location || '',
        number: data.collection?.number || '',
        size: data.collection?.size || '',
        material: data.collection?.material || ''
      },
      artist: {
        id: data.artist?.id || null
      },
      price: data.price,
      stock: data.stock,
      discount_price: data.discount_price,
      original_price: data.original_price,
      sales: data.sales,
      is_on_sale: data.is_on_sale,
      long_description: data.long_description || ''
    }
  } catch (error) {
    if (error.response) {
      if (error.response.status === 401) {
        ElMessage.error('登录已过期，请重新登录')
        router.push('/login')
      } else if (error.response.status === 404) {
        ElMessage.error('作品不存在')
        router.push('/original-artworks')
      } else {
        ElMessage.error('获取作品详情失败')
      }
    } else {
      ElMessage.error('获取作品详情失败')
    }
  } finally {
    loading.value = false
  }
}

// 触发文件选择
const triggerImageInput = () => {
  if (!isImageUploading.value && !isImageProcessing.value) {
    imageInput.value?.click()
  }
}

// 处理文件选择
const handleImageFileSelect = (event) => {
  const file = event.target.files[0]
  if (file) {
    uploadImageFile(file)
  }
  // 清空input值，允许重复选择同一文件
  event.target.value = ''
}

// 文件上传处理
const uploadImageFile = async (file) => {
  // 重置状态
  imageUploadProgress.value = 0
  isImageUploading.value = true
  isImageProcessing.value = true
  imageFileName.value = file.name
  imageFileSize.value = file.size

  try {
    // 使用 uploadImageToWebpLimit5MB 处理图片
    console.log('开始处理图片文件:', file.name, file.size)
    const processedFile = await uploadImageToWebpLimit5MB(file)
    
    if (!processedFile) {
      console.log('图片处理失败，终止上传')
      resetImageUploadState()
      return
    }

    console.log('图片处理成功:', processedFile.name, processedFile.size)
    
    // 图片处理完成，开始上传
    isImageProcessing.value = false
    
    // 更新显示信息
    imageFileName.value = processedFile.name
    imageFileSize.value = processedFile.size

    const formData = new FormData()
    formData.append('file', processedFile)

    const response = await axios.post(`${API_BASE_URL}/api/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          imageUploadProgress.value = percent
        } else {
          // 如果没有total，模拟进度
          imageUploadProgress.value = Math.min(imageUploadProgress.value + 10, 90)
        }
      }
    })

    // 处理上传成功
    handleImageUploadSuccess(response)
  } catch (error) {
    handleImageUploadError(error)
  }
}

// 文件验证（简化版，因为 uploadImageToWebpLimit5MB 已经包含了验证逻辑）
const validateFile = (file) => {
  // 基础文件类型验证
  const isImage = file.type.startsWith('image/')
  if (!isImage) {
    ElMessage.error('只能上传图片文件!')
    return false
  }
  return true
}

// 处理上传成功
const handleImageUploadSuccess = (response) => {
  console.log('上传成功响应:', response)
  
  let imageUrl = ''
  
  // 兼容多种返回格式
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
    form.value.image = imageUrl
    imageUploadProgress.value = 100
    
    // 延迟重置状态
    setTimeout(() => {
      imageUploadProgress.value = 0
      isImageUploading.value = false
      imageFileName.value = ''
      imageFileSize.value = 0
    }, 2000)
    
    ElMessage.success('图片上传成功')
  } else {
    console.error('无法从响应中提取URL，完整响应:', response)
    ElMessage.error('图片上传失败：未获取到图片URL')
    resetImageUploadState()
  }
}

// 处理上传错误
const handleImageUploadError = (error) => {
  console.error('上传错误:', error)
  ElMessage.error('上传失败：' + (error.response?.data?.message || '未知错误'))
  resetImageUploadState()
}

// 重置上传状态
const resetImageUploadState = () => {
  imageUploadProgress.value = 0
  isImageUploading.value = false
  isImageProcessing.value = false
  imageFileName.value = ''
  imageFileSize.value = 0
}

// 移除图片
const removeImage = async () => {
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
    form.value.image = ''
    ElMessage.success('图片已删除')
  } catch {
    // 用户取消删除
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

// 拖拽处理
const handleImageDragEnter = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!isImageUploading.value && !isImageProcessing.value && !form.value.image) {
    isImageDragOver.value = true
  }
}

const handleImageDragLeave = (e) => {
  e.preventDefault()
  e.stopPropagation()
  // 只有当鼠标真正离开上传区域时才设置false
  if (!e.currentTarget.contains(e.relatedTarget)) {
    isImageDragOver.value = false
  }
}

const handleImageDragOver = (e) => {
  e.preventDefault()
  e.stopPropagation()
}

const handleImageDrop = (e) => {
  e.preventDefault()
  e.stopPropagation()
  isImageDragOver.value = false
  
  if (isImageUploading.value || isImageProcessing.value || form.value.image) return
  
  const files = e.dataTransfer.files
  if (files.length > 0) {
    uploadImageFile(files[0])
  }
}

const handleEdit = async () => {
  if (!checkLoginStatus()) return
  try {
    await axios.put(`/original-artworks/${route.params.id}`, form.value)
    ElMessage.success('更新成功')
    router.push('/original-artworks')
  } catch (error) {
    if (error.response) {
      if (error.response.status === 401) {
        ElMessage.error('登录已过期，请重新登录')
        router.push('/login')
      } else {
        ElMessage.error(error.response.data.message || '更新失败')
      }
    } else {
      ElMessage.error('更新失败')
    }
  }
}

const goBack = () => {
  router.push('/original-artworks')
}

onMounted(() => {
  checkLoginStatus() && Promise.all([fetchArtists(), fetchArtworkDetail()])
})
</script>

<style scoped>
.artwork-detail {
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
</style> 