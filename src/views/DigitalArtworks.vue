<template>
  <div>
    <div class="header">
      <h3>数字艺术品管理</h3>
      <el-button type="primary" @click="handleAdd">添加作品</el-button>
    </div>

    <el-table :data="artworks" style="width: 100%">
      <el-table-column prop="title" label="标题" />
      <el-table-column label="图片">
        <template #default="{ row }">
          <el-image
            style="width: 100px; height: 100px"
            :src="getImageUrl(row.image_url)"
            fit="cover"
          />
        </template>
      </el-table-column>
      <el-table-column prop="description" label="描述" show-overflow-tooltip />
      <el-table-column prop="project_name" label="项目名称" />
      <el-table-column prop="product_name" label="产品名称" />
      <el-table-column prop="project_owner" label="项目方" />
      <el-table-column prop="issuer" label="发行方" />
      <el-table-column prop="issue_batch" label="发行批次" />
      <el-table-column prop="issue_year" label="发行年份" />
      <el-table-column prop="batch_quantity" label="本批发行数量" />
      <el-table-column prop="price" label="价格" />
      <el-table-column prop="created_at" label="创建时间" />
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button type="primary" size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button type="danger" size="small" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑作品' : '添加作品'"
      width="50%"
    >
      <el-form :model="form" label-width="120px">
        <el-form-item label="标题">
          <el-input v-model="form.title" />
        </el-form-item>
        <el-form-item label="图片" required>
          <div class="image-upload-container">
            <!-- 图片预览区域 -->
            <div class="image-preview" v-if="form.image_url">
              <img :src="getImageUrl(form.image_url)" class="preview-image" alt="图片" />
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
              <div v-if="isImageDragOver && !form.image_url" class="drag-overlay">
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
          <el-input v-model="form.description" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="登记证书">
          <el-input v-model="form.registration_certificate" />
        </el-form-item>
        <el-form-item label="许可权利">
          <el-input v-model="form.license_rights" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="许可时间">
          <el-input v-model="form.license_period" />
        </el-form-item>
        <el-form-item label="所有者权益">
          <el-input v-model="form.owner_rights" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="许可事项">
          <el-input v-model="form.license_items" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="项目名称">
          <el-input v-model="form.project_name" />
        </el-form-item>
        <el-form-item label="产品名称">
          <el-input v-model="form.product_name" />
        </el-form-item>
        <el-form-item label="项目方">
          <el-input v-model="form.project_owner" />
        </el-form-item>
        <el-form-item label="发行方">
          <el-input v-model="form.issuer" />
        </el-form-item>
        <el-form-item label="发行批次">
          <el-input v-model="form.issue_batch" />
        </el-form-item>
        <el-form-item label="发行年份">
          <el-input-number v-model="form.issue_year" :min="1900" :max="2100" />
        </el-form-item>
        <el-form-item label="本批发行数量">
          <el-input-number v-model="form.batch_quantity" :min="1" />
        </el-form-item>
        <el-form-item label="价格">
          <el-input-number v-model="form.price" :precision="2" :step="0.01" :min="0" />
        </el-form-item>
        <el-form-item label="艺术家" required>
          <el-select v-model="form.artist_id" filterable placeholder="请选择艺术家">
            <el-option
              v-for="artist in artistOptions"
              :key="artist.id"
              :label="artist.name"
              :value="artist.id"
            />
          </el-select>
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

const artworks = ref([])
const dialogVisible = ref(false)
const isEdit = ref(false)
const artistOptions = ref([])

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
  image_url: '',
  artist_id: '',
  description: '',
  registration_certificate: '',
  license_rights: '',
  license_period: '',
  owner_rights: '',
  license_items: '',
  project_name: '',
  product_name: '',
  project_owner: '',
  issuer: '',
  issue_batch: '',
  issue_year: new Date().getFullYear(),
  batch_quantity: 1,
  price: 0
})

const fetchArtworks = async () => {
  try {
    const data = await axios.get('/digital-artworks')
    console.log('API返回的原始数据：', data)
    if (Array.isArray(data)) {
      artworks.value = data.map(artwork => ({
        ...artwork,
        image_url: getImageUrl(artwork.image_url)
      }))
      console.log('设置后的数字艺术品数据：', artworks.value)
    } else {
      console.error('返回的数据不是数组：', data)
      artworks.value = []
      ElMessage.error('获取数据格式不正确')
    }
  } catch (error) {
    console.error('获取数字艺术品列表失败：', error)
    artworks.value = []
    ElMessage.error('获取数据失败')
  }
}

const fetchArtists = async () => {
  try {
    const data = await axios.get('/artists')
    console.log('数字艺术品艺术家API返回的原始数据：', data)
    if (Array.isArray(data)) {
      artistOptions.value = data
      console.log('设置后的艺术家数据：', artistOptions.value)
    } else {
      console.error('返回的数据不是数组：', data)
      artistOptions.value = []
      ElMessage.error('获取艺术家数据格式不正确')
    }
  } catch (error) {
    console.error('获取艺术家列表失败：', error)
    artistOptions.value = []
    ElMessage.error('获取艺术家列表失败')
  }
}

const handleAdd = () => {
  isEdit.value = false
  form.value = {
    title: '',
    image_url: '',
    artist_id: '',
    description: '',
    registration_certificate: '',
    license_rights: '',
    license_period: '',
    owner_rights: '',
    license_items: '',
    project_name: '',
    product_name: '',
    project_owner: '',
    issuer: '',
    issue_batch: '',
    issue_year: new Date().getFullYear(),
    batch_quantity: 1,
    price: 0
  }
  dialogVisible.value = true
}

const handleEdit = async (row) => {
  isEdit.value = true
  try {
    // 获取详细信息
    let detail = await axios.get(`/digital-artworks/${row.id}`)
    // 兼容后端返回被包裹在data字段下的情况
    if (detail && detail.data) {
      detail = detail.data;
    }
    
    // 用详情数据填充form
    form.value = {
      id: detail.id,
      title: detail.title || '',
      image_url: detail.image_url || '',
      artist_id: detail.artist?.id || '',
      description: detail.description || '',
      registration_certificate: detail.registration_certificate || '',
      license_rights: detail.license_rights || '',
      license_period: detail.license_period || '',
      owner_rights: detail.owner_rights || '',
      license_items: detail.license_items || '',
      project_name: detail.project_name || '',
      product_name: detail.product_name || '',
      project_owner: detail.project_owner || '',
      issuer: detail.issuer || '',
      issue_batch: detail.issue_batch || '',
      issue_year: Number(detail.issue_year) || new Date().getFullYear(),
      batch_quantity: Number(detail.batch_quantity) || 1,
      price: Number(detail.price) || 0
    }
    
    dialogVisible.value = true
  } catch (error) {
    console.error('获取详细信息失败:', error)
    ElMessage.error('获取详细信息失败，无法编辑')
  }
}

const handleDelete = (row) => {
  ElMessageBox.confirm('确定要删除这个作品吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await axios.delete(`/digital-artworks/${row.id}`)
      ElMessage.success('删除成功')
      fetchArtworks()
    } catch (error) {
      console.error('删除失败:', error)
      if (error.response) {
        ElMessage.error(error.response.data.error || '删除失败')
      } else {
        ElMessage.error('删除失败')
      }
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
    form.value.image_url = imageUrl
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
    form.value.image_url = ''
    ElMessage.success('图片已删除')
  } catch {
    // 用户取消删除
  }
}

// 拖拽处理函数
const handleImageDragEnter = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!isImageUploading.value && !isImageProcessing.value && !form.value.image_url) {
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
  
  if (isImageUploading.value || isImageProcessing.value || form.value.image_url) return
  
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

const customUpload = async (options) => {
  const { onSuccess, onError, file, onProgress } = options;
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await axios.post(`${API_BASE_URL}/api/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          uploadProgress.value = percent;
          onProgress({ percent });
        } else {
          // 如果没有total，模拟进度
          uploadProgress.value = Math.min(uploadProgress.value + 10, 90);
          onProgress({ percent: uploadProgress.value });
        }
      }
    });
    
    console.log('customUpload 收到的完整响应:', response);
    console.log('customUpload response.data:', response.data);
    
    // 上传完成
    uploadProgress.value = 100;
    setTimeout(() => {
      uploadProgress.value = 0;
      isUploading.value = false;
    }, 1000);
    
         // 确保传递正确的数据给 onSuccess
     console.log('调用 onSuccess，传递数据:', response);
     onSuccess(response);
  } catch (error) {
    console.error('customUpload 错误:', error);
    uploadProgress.value = 0;
    isUploading.value = false;
    onError(error);
    ElMessage.error('上传失败：' + (error.response?.data?.message || '未知错误'));
  }
};

// 监听拖拽状态
const handleDragEnter = (e) => {
  e.preventDefault();
  e.stopPropagation();
  isDragOver.value = true;
};

const handleDragLeave = (e) => {
  e.preventDefault();
  e.stopPropagation();
  isDragOver.value = false;
};

const handleDragOver = (e) => {
  e.preventDefault();
  e.stopPropagation();
};

const handleDrop = (e) => {
  e.preventDefault();
  e.stopPropagation();
  isDragOver.value = false;
};

const beforeImageUpload = async (file) => {
  // 文件类型验证
  const isImage = file.type.startsWith('image/')
  if (!isImage) {
    ElMessage.error('只能上传图片文件!')
    return false
  }

  // 文件大小验证 (5MB)
  const isLt5M = file.size / 1024 / 1024 < 5
  if (!isLt5M) {
    ElMessage.error('图片大小不能超过 5MB!')
    return false
  }

  // 重置进度和上传状态
  uploadProgress.value = 0
  isUploading.value = true

  // 直接调用通用工具
  const result = await uploadImageToWebpLimit5MB(file)
  if (!result) return false
  return Promise.resolve(result)
}

const getImageUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('https://wx.oss.2000gallery.art/')) {
    return url;
  }
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`;
}

const getSubmitData = () => {
  const {
    artist_id, title, image_url, description, registration_certificate,
    license_rights, license_period, owner_rights, license_items,
    project_name, product_name, project_owner, issuer, issue_batch,
    issue_year, batch_quantity, price
  } = form.value;
  return {
    artist_id, title, image_url, description, registration_certificate,
    license_rights, license_period, owner_rights, license_items,
    project_name, product_name, project_owner, issuer, issue_batch,
    issue_year, batch_quantity, price
  };
}

const handleSubmit = async () => {
  if (!form.value.title || !form.value.title.trim()) {
    ElMessage.warning('请输入作品标题');
    return;
  }
  if (!form.value.image_url) {
    ElMessage.warning('请上传作品图片');
    return;
  }
  if (!form.value.artist_id) {
    ElMessage.warning('请选择艺术家');
    return;
  }
  if (!form.value.description || !form.value.description.trim()) {
    ElMessage.warning('请输入作品描述');
    return;
  }
  if (!form.value.project_name || !form.value.project_name.trim()) {
    ElMessage.warning('请输入项目名称');
    return;
  }
  if (!form.value.product_name || !form.value.product_name.trim()) {
    ElMessage.warning('请输入产品名称');
    return;
  }
  if (!form.value.project_owner || !form.value.project_owner.trim()) {
    ElMessage.warning('请输入项目方');
    return;
  }
  if (!form.value.issuer || !form.value.issuer.trim()) {
    ElMessage.warning('请输入发行方');
    return;
  }
  if (!form.value.issue_batch || !form.value.issue_batch.trim()) {
    ElMessage.warning('请输入发行批次');
    return;
  }
  if (!form.value.issue_year) {
    ElMessage.warning('请输入发行年份');
    return;
  }
  if (!form.value.batch_quantity) {
    ElMessage.warning('请输入本批发行数量');
    return;
  }
  if (form.value.price === undefined || form.value.price < 0) {
    ElMessage.warning('请输入有效的价格');
    return;
  }

  try {
    if (isEdit.value) {
      await axios.put(`/digital-artworks/${form.value.id}`, getSubmitData())
    } else {
      await axios.post('/digital-artworks', getSubmitData())
    }
    ElMessage.success(isEdit.value ? '更新成功' : '添加成功')
    dialogVisible.value = false
    fetchArtworks()
  } catch (error) {
    ElMessage.error(isEdit.value ? '更新失败' : '添加失败')
  }
}

onMounted(() => {
  fetchArtists()
  fetchArtworks()
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
</style> 