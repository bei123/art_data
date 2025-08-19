<template>
  <div class="right-detail">
    <el-page-header @back="goBack" :title="'返回列表'" />
    
    <el-card v-loading="loading" class="detail-card">
      <template #header>
        <div class="card-header">
          <span>版权实物详情</span>
          <el-button type="primary" @click="handleEdit">编辑</el-button>
        </div>
      </template>

      <el-form :model="form" label-width="120px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="标题">
              <el-input v-model="form.title" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="状态">
              <el-select v-model="form.status" placeholder="请选择状态">
                <el-option label="在售" value="onsale" />
                <el-option label="已售罄" value="soldout" />
                <el-option label="即将发售" value="upcoming" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="价格">
              <el-input-number v-model="form.price" :precision="2" :step="0.1" :min="0" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="原价">
              <el-input-number v-model="form.originalPrice" :precision="2" :step="0.1" :min="0" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="期限">
              <el-input v-model="form.period" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="剩余数量">
              <el-input-number v-model="form.remainingCount" :min="0" :max="form.totalCount" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="总数量">
          <el-input-number v-model="form.totalCount" :min="0" />
        </el-form-item>

        <el-form-item label="富文本内容">
          <div v-if="!isEditing">
            <div v-html="form.rich_text"></div>
          </div>
          <div v-else>
            <Toolbar :editor="editorRef" style="width: 100%" />
            <Editor
              v-model="richTextHtml"
              :defaultConfig="{ placeholder: '请输入富文本内容...', ...editorConfig }"
              mode="default"
              style="width: 100%; min-width: 400px; height: 300px; border: 1px solid #ccc"
              @onCreated="handleEditorCreated"
            />
            <div style="margin-top: 10px;">
              <el-button type="primary" @click="saveEdit">保存</el-button>
              <el-button @click="cancelEdit">取消</el-button>
            </div>
          </div>
        </el-form-item>

        <el-divider>图片列表</el-divider>

        <el-form-item label="图片列表" required>
          <div class="images-upload-container">
            <!-- 已上传的图片列表 -->
            <div class="images-list" v-if="form.images.length > 0">
              <div 
                v-for="(image, index) in form.images" 
                :key="index"
                class="image-item"
              >
                <img :src="getImageUrl(image)" class="item-image" alt="图片" />
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
                'drag-over': isImageDragOver, 
                'uploading': isImageUploading || isImageProcessing 
              }"
              @click="triggerImageInput"
              @dragenter="handleImageDragEnter"
              @dragleave="handleImageDragLeave"
              @dragover="handleImageDragOver"
              @drop="handleImageDrop"
            >
              <el-icon class="add-icon" :class="{ 'spinning': isImageUploading || isImageProcessing }">
                <component :is="(isImageUploading || isImageProcessing) ? 'Loading' : 'Plus'" />
              </el-icon>
              <p class="add-text">添加图片</p>
              <p class="add-hint">最多5张，支持拖拽</p>
            </div>

            <!-- 隐藏的文件输入 -->
            <input
              ref="imageInput"
              type="file"
              accept="image/*"
              multiple
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

        <el-divider>详情列表</el-divider>

        <div v-for="(detail, index) in form.details" :key="index" class="detail-item">
          <el-row :gutter="20">
            <el-col :span="10">
              <el-form-item :label="'标题'">
                <el-input v-model="detail.title" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="'内容'">
                <el-input v-model="detail.content" />
              </el-form-item>
            </el-col>
            <el-col :span="2">
              <el-button type="danger" @click="removeDetail(index)">删除</el-button>
            </el-col>
          </el-row>
        </div>

        <el-form-item>
          <el-button type="primary" @click="addDetail">添加详情</el-button>
        </el-form-item>

        <el-divider>规则列表</el-divider>

        <div v-for="(rule, index) in form.rules" :key="index" class="rule-item">
          <el-row :gutter="20">
            <el-col :span="10">
              <el-form-item :label="'标题'">
                <el-input v-model="rule.title" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="'内容'">
                <el-input v-model="rule.content" />
              </el-form-item>
            </el-col>
            <el-col :span="2">
              <el-button type="danger" @click="removeRule(index)">删除</el-button>
            </el-col>
          </el-row>
        </div>

        <el-form-item>
          <el-button type="primary" @click="addRule">添加规则</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Upload, Delete, Loading } from '@element-plus/icons-vue'
import axios from '../utils/axios'
import { API_BASE_URL } from '../config'
import { uploadImageToWebpLimit5MB } from '../utils/image'
import '@wangeditor/editor/dist/css/style.css'
import { Editor, Toolbar } from '@wangeditor/editor-for-vue'
import { onBeforeUnmount } from 'vue'

const route = useRoute()
const router = useRouter()
const loading = ref(false)

const form = ref({
  title: '',
  price: 0,
  originalPrice: 0,
  description: '',
  status: '',
  period: '',
  remainingCount: 0,
  totalCount: 0,
  images: [],
  details: [],
  rules: [],
  rich_text: ''
})

const fileList = ref([])

watch(() => form.value.images, (newVal) => {
  fileList.value = (newVal || []).map(url => ({
    url: getImageUrl(url),
    name: url.split('/').pop()
  }))
}, { immediate: true })

const editorRef = ref(null)
const richTextHtml = ref('')
const isEditing = ref(false)

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

const editorConfig = {
  MENU_CONF: {
    uploadImage: {
      async customUpload(file, insertFn) {
        const processedFile = await uploadImageToWebpLimit5MB(file);
        if (!processedFile) {
          ElMessage.error('图片处理失败');
          return;
        }
        const formData = new FormData();
        formData.append('file', processedFile);
        const token = localStorage.getItem('token');
        try {
          const resp = await fetch(`${API_BASE_URL}/api/upload`, {
            method: 'POST',
            body: formData,
            headers: token ? { Authorization: `Bearer ${token}` } : {}
          });
          const result = await resp.json();
          let url = '';
          if (result.url) {
            url = result.url;
          } else if (result.data && result.data.url) {
            url = result.data.url;
          }
          if (typeof url === 'string' && url) {
            setTimeout(() => {
              insertFn(url);
              ElMessage.success('图片上传成功');
            }, 0);
          } else {
            ElMessage.error(result.message || '图片上传失败');
          }
        } catch (err) {
          ElMessage.error('图片上传异常');
        }
      }
    }
  }
}

const handleEditorCreated = (editor) => {
  editorRef.value = editor
}

const fetchRightDetail = async () => {
  loading.value = true
  try {
    const response = await axios.get(`/api/rights/${route.params.id}`)
    const data = response.data
    form.value = {
      ...data,
      images: data.images || [],
      details: data.details || [],
      rules: data.rules || [],
      rich_text: data.rich_text || ''
    }
    // 确保富文本内容同步到编辑器
    richTextHtml.value = data.rich_text || ''
  } catch (error) {
    ElMessage.error('获取版权实物详情失败')
  } finally {
    loading.value = false
  }
}

// 图片上传相关函数
const triggerImageInput = () => {
  if (!isImageUploading.value && !isImageProcessing.value) {
    imageInput.value?.click()
  }
}

const handleImageFileSelect = (event) => {
  const files = Array.from(event.target.files)
  if (files.length > 0) {
    uploadImageFiles(files)
  }
  event.target.value = ''
}

const uploadImageFiles = async (files) => {
  for (const file of files) {
    if (form.value.images.length >= 5) {
      ElMessage.warning('最多只能上传5张图片')
      break
    }
    
    imageUploadProgress.value = 0
    isImageUploading.value = true
    isImageProcessing.value = true
    imageFileName.value = file.name
    imageFileSize.value = file.size

    try {
      console.log('开始处理图片文件:', file.name, file.size)
      const processedFile = await uploadImageToWebpLimit5MB(file)
      
      if (!processedFile) {
        console.log('图片处理失败，跳过此文件')
        resetImageUploadState()
        continue
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
    if (!form.value.images) form.value.images = []
    if (!form.value.images.includes(imageUrl)) {
      form.value.images.push(imageUrl)
    }
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
const handleImageDragEnter = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!isImageUploading.value && !isImageProcessing.value && form.value.images.length < 5) {
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
  
  if (isImageUploading.value || isImageProcessing.value || form.value.images.length >= 5) return
  
  const files = Array.from(e.dataTransfer.files)
  if (files.length > 0) {
    uploadImageFiles(files)
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

const addDetail = () => {
  form.value.details.push({
    title: '',
    content: ''
  })
}

const removeDetail = (index) => {
  form.value.details.splice(index, 1)
}

const addRule = () => {
  form.value.rules.push({
    title: '',
    content: ''
  })
}

const removeRule = (index) => {
  form.value.rules.splice(index, 1)
}

const getImageUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('https://wx.oss.2000gallery.art/')) {
    return url;
  }
  return url.startsWith('http') ? url : `${API_BASE_URL}${url.startsWith('/') ? url : `/${url}`}`;
}

const handleEdit = async () => {
  if (!form.value.images || form.value.images.length === 0) {
    ElMessage.warning('请至少上传一张图片');
    return;
  }
  isEditing.value = true
  // 确保富文本内容正确同步
  richTextHtml.value = form.value.rich_text || ''
}

const saveEdit = async () => {
  try {
    const submitData = {
      ...form.value,
      rich_text: richTextHtml.value,
      images: form.value.images.map(image => {
        if (typeof image === 'string') {
          if (image.startsWith('https://wx.oss.2000gallery.art/')) {
            return image;
          }
          if (image.startsWith('http')) {
            const url = new URL(image);
            return url.pathname;
          }
          return image;
        }
        return image.url || image;
      })
    };
    await axios.put(`/api/rights/${route.params.id}`, submitData);
    ElMessage.success('更新成功');
    isEditing.value = false
    form.value.rich_text = richTextHtml.value
  } catch (error) {
    ElMessage.error('更新失败');
  }
}

const cancelEdit = () => {
  isEditing.value = false
  richTextHtml.value = form.value.rich_text || ''
}

const goBack = () => {
  router.push('/rights')
}

onMounted(() => {
  fetchRightDetail()
})

onBeforeUnmount(() => {
  if (editorRef.value && editorRef.value.destroy) editorRef.value.destroy()
})
</script>

<style scoped>
.right-detail {
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

/* 多图片上传容器 */
.images-upload-container {
  width: 100%;
}

/* 图片列表 */
.images-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
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

.remove-btn {
  background: rgba(245, 108, 108, 0.9);
  border: none;
}

.remove-btn:hover {
  background: #f56c6c;
}

/* 添加图片按钮 */
.add-image-btn {
  width: 120px;
  height: 120px;
  border: 2px dashed #d9d9d9;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
  background: #fafafa;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
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

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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
  line-height: 1.4;
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
  .images-list {
    gap: 8px;
  }
  
  .image-item,
  .add-image-btn {
    width: 100px;
    height: 100px;
  }
}

.detail-item,
.rule-item {
  margin-bottom: 20px;
  padding: 10px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
}
</style> 