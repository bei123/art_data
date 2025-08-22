<template>
  <div>
    <div class="header">
      <h3>版权实物管理</h3>
      <el-button type="primary" @click="handleAdd">添加版权实物</el-button>
    </div>

    <el-table :data="rights" style="width: 100%">
      <el-table-column label="图片">
        <template #default="{ row }">
          <div class="image-preview">
            <el-image 
              v-for="(image, index) in row.images" 
              :key="index"
              style="width: 100px; height: 100px; margin-right: 10px"
              :src="getImageUrl(image)"
              fit="cover"
              :preview-src-list="row.images.map(img => getImageUrl(img))"
            />
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="title" label="标题" />
      <el-table-column prop="status" label="状态">
        <template #default="{ row }">
          <el-tag :type="getStatusType(row.status)">
            {{ getStatusText(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="price" label="价格">
        <template #default="{ row }">
          <div>
            <div>¥{{ row.price }}</div>
            <div v-if="row.discount_amount > 0" class="discount-info">
              可抵扣: ¥{{ row.discount_amount }}
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="remainingCount" label="剩余数量">
        <template #default="{ row }">
          {{ row.remainingCount }}/{{ row.totalCount }}
        </template>
      </el-table-column>
      <el-table-column prop="category_title" label="所属分类" />
      <el-table-column label="关联艺术家">
        <template #default="{ row }">
          <div v-if="row.artist">
            <div class="artist-info">
              <el-avatar :size="30" :src="getImageUrl(row.artist.avatar)" />
              <span class="artist-name">{{ row.artist.name }}</span>
            </div>
          </div>
          <span v-else class="no-artist">未关联</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button type="primary" size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button type="danger" size="small" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑版权实物' : '添加版权实物'"
      width="50%"
    >
      <el-form :model="form" label-width="120px">
        <el-form-item label="标题">
          <el-input v-model="form.title" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" placeholder="请选择状态">
            <el-option label="在售" value="onsale" />
            <el-option label="已售罄" value="soldout" />
            <el-option label="即将发售" value="upcoming" />
          </el-select>
        </el-form-item>
        <el-form-item label="价格">
          <el-input-number v-model="form.price" :precision="2" :step="0.1" :min="0" />
        </el-form-item>
        <el-form-item label="原价">
          <el-input-number v-model="form.originalPrice" :precision="2" :step="0.1" :min="0" />
        </el-form-item>
        <el-form-item label="可抵扣金额">
          <el-input-number v-model="form.discountAmount" :precision="2" :step="0.1" :min="0" />
        </el-form-item>
        <el-form-item label="期限">
          <el-input v-model="form.period" />
        </el-form-item>
        <el-form-item label="总数量">
          <el-input-number v-model="form.totalCount" :min="0" />
        </el-form-item>
        <el-form-item label="剩余数量">
          <el-input-number v-model="form.remainingCount" :min="0" :max="form.totalCount" />
        </el-form-item>
        <el-form-item label="所属分类">
          <el-select v-model="form.category_id" placeholder="请选择分类">
            <el-option
              v-for="cat in categories"
              :key="cat.id"
              :label="cat.title"
              :value="cat.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="关联艺术家">
          <el-select v-model="form.artist_id" placeholder="请选择艺术家" clearable>
            <el-option
              v-for="artist in artists"
              :key="artist.id"
              :label="artist.name"
              :value="artist.id"
            >
              <div class="artist-option">
                <el-avatar :size="24" :src="getImageUrl(artist.avatar)" />
                <span class="artist-name">{{ artist.name }}</span>
              </div>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="图片" required>
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
        <el-form-item label="富文本内容">
          <Toolbar :editor="editorRef" style="width: 100%" />
          <Editor
            v-model="richTextHtml"
            :defaultConfig="{ placeholder: '请输入富文本内容...', ...editorConfig }"
            mode="default"
            style="width: 100%; min-width: 400px; height: 300px; border: 1px solid #ccc"
            @onCreated="handleEditorCreated"
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
import { ref, onMounted, watch, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Upload, Delete, Loading } from '@element-plus/icons-vue'
import axios from '../utils/axios'
import { API_BASE_URL } from '../config'
import { uploadImageToWebpLimit5MB } from '../utils/image'
import '@wangeditor/editor/dist/css/style.css'
import { Editor, Toolbar } from '@wangeditor/editor-for-vue'

const router = useRouter()
const rights = ref([])
const dialogVisible = ref(false)
const isEdit = ref(false)
const categories = ref([])
const artists = ref([])
const fileList = ref([])

const form = ref({
  title: '',
  status: '',
  price: 0,
  originalPrice: 0,
  discountAmount: 0,
  period: '',
  totalCount: 0,
  remainingCount: 0,
  description: '',
  images: [],
  category_id: null,
  artist_id: null
})

const editorRef = ref(null)
const richTextHtml = ref('')

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

watch(() => form.value.images, (newVal) => {
  fileList.value = (newVal || []).map(url => ({
    url: getImageUrl(url),
    name: url.split('/').pop()
  }))
}, { immediate: true })

watch(dialogVisible, (val) => {
  if (val) {
    richTextHtml.value = form.value.rich_text || ''
  }
}, { immediate: true })

const fetchRights = async () => {
  try {
    const response = await axios.get('/rights')
    console.log('版权实物API返回的原始数据：', response)
    let arr = []
    if (Array.isArray(response)) {
      arr = response
    } else if (response && Array.isArray(response.data)) {
      arr = response.data
    }
    if (arr.length) {
      rights.value = arr.map(right => ({
        ...right,
        images: right.images ? right.images.map(image => getImageUrl(image)) : []
      }))
      console.log('设置后的版权实物数据：', rights.value)
    } else {
      console.error('返回的数据不是数组：', response)
      rights.value = []
      ElMessage.error('获取数据格式不正确')
    }
  } catch (error) {
    console.error('获取版权实物列表失败：', error)
    rights.value = []
    ElMessage.error('获取版权实物列表失败')
  }
}

const fetchCategories = async () => {
  try {
    const response = await axios.get('/physical-categories')
    console.log('分类API返回的原始数据：', response)
    if (response && response.data && Array.isArray(response.data)) {
      categories.value = response.data
      console.log('设置后的分类数据：', categories.value)
    } else if (Array.isArray(response)) {
      categories.value = response
      console.log('设置后的分类数据：', categories.value)
    } else {
      console.error('返回的分类数据格式不正确：', response)
      categories.value = []
    }
  } catch (error) {
    console.error('获取分类列表失败：', error)
    categories.value = []
  }
}

const fetchArtists = async () => {
  try {
    const response = await axios.get('/artists')
    console.log('艺术家API返回的原始数据：', response)
    if (Array.isArray(response)) {
      artists.value = response
      console.log('设置后的艺术家数据：', artists.value)
    } else {
      console.error('返回的数据不是数组：', response)
      artists.value = []
      ElMessage.error('获取艺术家数据格式不正确')
    }
  } catch (error) {
    console.error('获取艺术家列表失败：', error)
    artists.value = []
    ElMessage.error('获取艺术家列表失败')
  }
}

const getStatusType = (status) => {
  const types = {
    onsale: 'success',
    soldout: 'info',
    upcoming: 'warning'
  }
  return types[status] || 'info'
}

const getStatusText = (status) => {
  const texts = {
    onsale: '在售',
    soldout: '已售罄',
    upcoming: '即将发售'
  }
  return texts[status] || status
}

const handleAdd = () => {
  isEdit.value = false
  form.value = {
    title: '',
    status: '',
    price: 0,
    originalPrice: 0,
    discountAmount: 0,
    period: '',
    totalCount: 0,
    remainingCount: 0,
    description: '',
    images: [],
    category_id: null,
    artist_id: null,
    rich_text: ''
  }
  dialogVisible.value = true
  richTextHtml.value = ''
}

const handleEdit = (row) => {
  isEdit.value = true
  form.value = {
    id: row.id,
    title: row.title,
    status: row.status,
    price: parseFloat(row.price),
    originalPrice: parseFloat(row.original_price),
    discountAmount: parseFloat(row.discount_amount || 0),
    period: row.period,
    totalCount: parseInt(row.total_count),
    remainingCount: parseInt(row.remaining_count),
    description: row.description,
    images: row.images || [],
    category_id: row.category_id,
    artist_id: row.artist_id,
    rich_text: row.rich_text || ''
  }
  dialogVisible.value = true
  richTextHtml.value = row.rich_text || ''
}

const handleDelete = (row) => {
  ElMessageBox.confirm('确定要删除这个版权实物吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await axios.delete(`/rights/${row.id}`)
      ElMessage.success('删除成功')
      fetchRights()
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

const getImageUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('https://wx.oss.2000gallery.art/')) {
    return url;
  }
  return url.startsWith('http') ? url : `${API_BASE_URL}${url.startsWith('/') ? url : `/${url}`}`;
}

const handleEditorCreated = (editor) => {
  editorRef.value = editor
}

const handleSubmit = async () => {
  if (!form.value.title.trim()) {
    ElMessage.warning('请输入标题')
    return
  }
  if (!form.value.status) {
    ElMessage.warning('请选择状态')
    return
  }
  if (form.value.images.length === 0) {
    ElMessage.warning('请上传至少一张图片')
    return
  }

  try {
    const submitData = {
      ...form.value,
      images: form.value.images.map(image => {
        if (typeof image === 'string') {
          if (image.startsWith('https://wx.oss.2000gallery.art/')) {
            return image;
          }
          if (image.startsWith('http')) {
            const url = new URL(image)
            return url.pathname
          }
          return image
        } else if (image.url) {
          if (image.url.startsWith('https://wx.oss.2000gallery.art/')) {
            return image.url;
          }
          if (image.url.startsWith('http')) {
            const url = new URL(image.url)
            return url.pathname
          }
          return image.url
        }
        return image
      }),
      category_id: form.value.category_id,
      discount_amount: form.value.discountAmount,
      rich_text: richTextHtml.value
    }

    if (isEdit.value) {
      await axios.put(`/rights/${form.value.id}`, submitData)
    } else {
      await axios.post('/rights', submitData)
    }
    ElMessage.success('保存成功')
    dialogVisible.value = false
    fetchRights()
  } catch (error) {
    console.error('保存失败:', error)
    ElMessage.error('保存失败')
  }
}

onMounted(() => {
  fetchRights()
  fetchCategories()
  fetchArtists()
})
onBeforeUnmount(() => {
  if (editorRef.value && editorRef.value.destroy) editorRef.value.destroy()
})
</script>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
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

.discount-info {
  color: #f56c6c;
  font-size: 12px;
  margin-top: 4px;
}

/* 艺术家相关样式 */
.artist-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.artist-name {
  font-size: 14px;
  color: #606266;
}

.no-artist {
  color: #909399;
  font-size: 14px;
  font-style: italic;
}

.artist-option {
  display: flex;
  align-items: center;
  gap: 8px;
}

.artist-option .artist-name {
  font-size: 14px;
  color: #303133;
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
</style> 