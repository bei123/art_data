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
            :action="`${API_BASE_URL}/api/upload`"
            :show-file-list="false"
            :on-success="handleImageSuccess"
            :before-upload="beforeImageUpload"
            name="file"
          >
            <img v-if="form.image" :src="form.image" class="avatar" />
            <el-icon v-else class="avatar-uploader-icon"><Plus /></el-icon>
          </el-upload>
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

        <el-form-item label="多图">
          <el-image
            v-for="(img, idx) in form.images"
            :key="idx"
            :src="img"
            style="width: 100px; margin-right: 10px"
          />
        </el-form-item>

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
import { Plus } from '@element-plus/icons-vue'
import axios from '../utils/axios'
import { API_BASE_URL } from '../config'
import { uploadImageToWebpLimit5MB } from '../utils/image'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const artists = ref([])

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
  images: [],
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
      images: data.images || [],
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
}

const beforeImageUpload = async (file) => {
  const result = await uploadImageToWebpLimit5MB(file);
  if (!result) return false;
  // el-upload 需要返回 File 对象，直接 return result 即可
  return result;
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

.avatar-uploader {
  border: 1px dashed #d9d9d9;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  width: 178px;
  height: 178px;
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
}
</style> 