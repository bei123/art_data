<template>
  <div>
    <div class="header">
      <h3>实物分类管理</h3>
      <el-button type="primary" @click="handleAdd">添加分类</el-button>
    </div>

    <el-table :data="categories" style="width: 100%">
      <el-table-column prop="title" label="标题" />
      <el-table-column label="图片">
        <template #default="{ row }">
          <el-image
            style="width: 100px; height: 100px"
            :src="getImageUrl(row.image)"
            fit="cover"
          />
        </template>
      </el-table-column>
      <el-table-column prop="count" label="作品数量" />
      <el-table-column prop="description" label="描述" />
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button type="primary" size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button type="danger" size="small" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑分类' : '添加分类'"
      width="50%"
    >
      <el-form :model="form" label-width="100px">
        <el-form-item label="标题">
          <el-input v-model="form.title" />
        </el-form-item>
        <el-form-item label="图片" required>
          <div class="image-upload-container">
            <!-- 图片预览区域 -->
            <div class="image-preview" v-if="form.image">
              <img :src="getImageUrl(form.image)" class="preview-image" alt="图片" />
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
        <el-form-item label="描述">
          <el-input type="textarea" v-model="form.description" />
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
import { Plus, Upload, Delete, Loading } from '@element-plus/icons-vue'
import axios from '../utils/axios'
import { API_BASE_URL } from '../config'
import { uploadImageToWebpLimit5MB } from '../utils/image'

const categories = ref([])
const dialogVisible = ref(false)
const isEdit = ref(false)

// 图片上传相关状态
const imageInput = ref(null)
const isImageDragOver = ref(false)
const imageUploadProgress = ref(0)
const isImageUploading = ref(false)
const isImageProcessing = ref(false)
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

const form = ref({
  title: '',
  image: '',
  description: ''
})

const fetchCategories = async () => {
  try {
    const response = await axios.get('/physical-categories')
    console.log('物理分类数据:', response)
    
    // 处理分页格式的响应数据
    let categoriesData = []
    if (response && response.data && Array.isArray(response.data)) {
      // 新格式：分页响应
      categoriesData = response.data
    } else if (response && Array.isArray(response)) {
      // 旧格式：直接数组
      categoriesData = response
    } else {
      console.error('返回数据格式不正确:', response)
      categories.value = []
      return
    }
    
    categories.value = categoriesData.map(category => ({
      ...category,
      image: getImageUrl(category.image)
    }))
  } catch (error) {
    console.error('获取分类失败:', error)
    ElMessage.error('获取数据失败')
  }
}

const handleAdd = () => {
  isEdit.value = false
  form.value = {
    title: '',
    image: '',
    description: ''
  }
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  form.value = { ...row }
  dialogVisible.value = true
}

const handleDelete = (row) => {
  ElMessageBox.confirm('确定要删除这个分类吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await axios.delete(`/physical-categories/${row.id}`)
      ElMessage.success('删除成功')
      fetchCategories()
    } catch (error) {
      ElMessage.error('删除失败')
    }
  })
}

// 图片上传相关函数
const triggerImageInput = () => {
  if (!isImageUploading.value && !isImageProcessing.value) {
    imageInput.value?.click()
  }
}

const handleImageFileSelect = (event) => {
  const file = event.target.files[0]
  if (file) {
    uploadImageFile(file)
  }
  event.target.value = ''
}

const uploadImageFile = async (file) => {
  imageUploadProgress.value = 0
  isImageUploading.value = true
  isImageProcessing.value = true
  imageFileName.value = file.name
  imageFileSize.value = file.size

  try {
    console.log('开始处理图片文件:', file.name, file.size)
    const processedFile = await uploadImageToWebpLimit5MB(file)
    
    if (!processedFile) {
      console.log('图片处理失败，终止上传')
      resetImageUploadState()
      return
    }

    console.log('图片处理成功:', processedFile.name, processedFile.size)
    
    isImageProcessing.value = false
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
          imageUploadProgress.value = Math.min(imageUploadProgress.value + 10, 90)
        }
      }
    })

    handleImageUploadSuccess(response)
  } catch (error) {
    handleImageUploadError(error)
  }
}

const handleImageUploadSuccess = (response) => {
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
    form.value.image = imageUrl
    imageUploadProgress.value = 100
    
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

const handleImageUploadError = (error) => {
  console.error('图片上传错误:', error)
  ElMessage.error('图片上传失败：' + (error.response?.data?.message || '未知错误'))
  resetImageUploadState()
}

const resetImageUploadState = () => {
  imageUploadProgress.value = 0
  isImageUploading.value = false
  isImageProcessing.value = false
  imageFileName.value = ''
  imageFileSize.value = 0
}

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

// 图片拖拽处理函数
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
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`;
}

const handleSubmit = async () => {
  if (!form.value.title.trim()) {
    ElMessage.warning('请输入分类标题');
    return;
  }

  try {
    // 确保提交的图片URL是相对路径
    const submitData = {
      ...form.value,
      image: form.value.image ? (form.value.image.startsWith('http') ? form.value.image.replace(API_BASE_URL, '') : form.value.image) : ''
    };

    if (isEdit.value) {
      await axios.put(`/physical-categories/${form.value.id}`, submitData)
    } else {
      await axios.post('/physical-categories', submitData)
    }
    ElMessage.success('保存成功')
    dialogVisible.value = false
    fetchCategories()
  } catch (error) {
    ElMessage.error('保存失败')
  }
}

// 页面加载时获取数据
onMounted(() => {
  fetchCategories()
})
</script>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
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

:deep(.el-table .el-image) {
  width: 80px;
  height: 80px;
  border-radius: 4px;
}

:deep(.el-dialog .el-form-item) {
  margin-bottom: 22px;
}

:deep(.el-upload:hover) {
  border-color: #409eff;
}

:deep(.el-image) {
  transition: transform 0.3s;
}

:deep(.el-image:hover) {
  transform: scale(1.02);
}
</style> 