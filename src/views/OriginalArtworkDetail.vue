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

        <el-form-item label="作品图片">
          <el-upload
            class="avatar-uploader"
            :class="{ 'uploading': isUploading }"
            :action="`${API_BASE_URL}/api/upload`"
            :show-file-list="false"
            :on-success="handleImageSuccess"
            :before-upload="beforeImageUpload"
            :drag="true"
            :accept="'image/*'"
            name="file"
            :http-request="customUpload"
            @dragenter="handleDragEnter"
            @dragleave="handleDragLeave"
          >
            <div class="upload-area" :class="{ 'drag-over': isDragOver, 'uploading': isUploading }">
              <img v-if="form.image" :src="form.image" class="avatar" />
              <div v-else class="upload-placeholder">
                <el-icon class="avatar-uploader-icon"><Plus /></el-icon>
                <div class="upload-text">
                  <p>点击或拖拽图片到此处上传</p>
                  <p class="upload-hint">支持 JPG、PNG、GIF 格式，文件大小不超过 5MB</p>
                </div>
              </div>
            </div>
            <div v-if="isDragOver" class="drag-overlay">
              <el-icon class="drag-icon"><Upload /></el-icon>
              <p>释放鼠标上传图片</p>
            </div>
          </el-upload>
          
          <!-- 上传进度条 -->
          <div v-if="uploadProgress > 0" class="upload-progress">
            <el-progress 
              :percentage="uploadProgress" 
              :stroke-width="8"
              :show-text="true"
              :status="uploadProgress === 100 ? 'success' : ''"
            />
            <p class="progress-text">
              <span v-if="uploadProgress < 100">正在上传图片... {{ uploadProgress }}%</span>
              <span v-else class="success-text">上传完成！</span>
            </p>
          </div>
          
          <!-- 测试按钮 -->
          <div style="margin-top: 10px;">
            <el-button size="small" @click="testProgress">测试进度条</el-button>
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
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Plus, Upload } from '@element-plus/icons-vue'
import axios from '../utils/axios'
import { API_BASE_URL } from '../config'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const artists = ref([])
const isDragOver = ref(false)
const uploadProgress = ref(0)
const isUploading = ref(false)

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

const handleImageSuccess = (response) => {
  form.value.image = response.url
  ElMessage.success('图片上传成功')
}

const beforeImageUpload = async (file) => {
  console.log('beforeImageUpload called with file:', file.name, file.type, file.size);
  
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
  console.log('Upload started, progress reset to 0');

  return true
}

const customUpload = async (options) => {
  console.log('customUpload called with options:', options);
  const { onSuccess, onError, file, onProgress } = options;
  const formData = new FormData();
  formData.append('file', file);

  try {
    console.log('Starting upload to:', `${API_BASE_URL}/api/upload`);
    const response = await axios.post(`${API_BASE_URL}/api/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          uploadProgress.value = percent;
          onProgress({ percent });
          console.log('Upload progress:', percent + '%');
        } else {
          // 如果没有total，模拟进度
          uploadProgress.value = Math.min(uploadProgress.value + 10, 90);
          onProgress({ percent: uploadProgress.value });
          console.log('Simulated progress:', uploadProgress.value + '%');
        }
      }
    });
    
    console.log('Upload completed, response:', response.data);
    // 上传完成
    uploadProgress.value = 100;
    setTimeout(() => {
      uploadProgress.value = 0;
      isUploading.value = false;
    }, 1000);
    
    onSuccess(response.data);
  } catch (error) {
    console.error('Upload error:', error);
    uploadProgress.value = 0;
    isUploading.value = false;
    onError(error);
    ElMessage.error('上传失败：' + (error.response?.data?.message || '未知错误'));
  }
};

// 监听拖拽状态
const handleDragEnter = () => {
  isDragOver.value = true;
};

const handleDragLeave = () => {
  isDragOver.value = false;
};

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

const testProgress = () => {
  uploadProgress.value = 0;
  isUploading.value = true;
  setTimeout(() => {
    uploadProgress.value = 50;
  }, 1000);
  setTimeout(() => {
    uploadProgress.value = 100;
    setTimeout(() => {
      uploadProgress.value = 0;
      isUploading.value = false;
    }, 1000);
  }, 2000);
};

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

.avatar-uploader {
  border: 1px dashed #d9d9d9;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  width: 178px;
  height: 178px;
  transition: all 0.3s ease;
}

.avatar-uploader:hover {
  border-color: #409eff;
}

.avatar-uploader-icon {
  font-size: 28px;
  color: #8c939d;
  width: 178px;
  height: 178px;
  text-align: center;
  line-height: 178px;
}

.avatar {
  width: 178px;
  height: 178px;
  display: block;
  object-fit: cover;
}

.upload-area {
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: #f5f7fa;
  border: 2px dashed #d9d9d9;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
  min-height: 178px;
}

.upload-area.drag-over {
  border-color: #409eff;
  background-color: #ecf5ff;
  transform: scale(1.02);
  box-shadow: 0 0 10px rgba(64, 158, 255, 0.3);
}

.drag-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(64, 158, 255, 0.1);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  color: #409eff;
  font-weight: bold;
  z-index: 10;
  border-radius: 6px;
}

.drag-icon {
  font-size: 48px;
  margin-bottom: 10px;
}

.upload-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 20px;
  box-sizing: border-box;
}

.upload-text {
  text-align: center;
  color: #606266;
  margin-top: 10px;
}

.upload-text p {
  margin: 5px 0;
}

.upload-hint {
  font-size: 12px;
  color: #909399;
}

.upload-progress {
  margin-top: 15px;
  padding: 15px;
  background-color: #f8f9fa;
  border-radius: 6px;
  border: 1px solid #e9ecef;
}

.progress-text {
  margin: 10px 0 0 0;
  text-align: center;
  color: #606266;
  font-size: 14px;
}

.success-text {
  color: #67c23a;
  font-weight: bold;
}

/* 上传中状态样式 */
.avatar-uploader.uploading {
  opacity: 0.7;
  pointer-events: none;
}

.upload-area.uploading {
  background-color: #f0f9ff;
  border-color: #409eff;
}
</style> 