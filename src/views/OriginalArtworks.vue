<template>
  <div class="artworks-container">
    <div class="header">
      <h2>艺术品管理</h2>
      <el-button type="primary" @click="showAddDialog">添加艺术品</el-button>
    </div>

    <el-table 
      v-loading="loading"
      :data="artworks" 
      style="width: 100%"
    >
      <el-table-column prop="title" label="标题" />
      <el-table-column label="图片" width="120">
        <template #default="{ row }">
          <el-image 
            :src="row.image" 
            :preview-src-list="[row.image]"
            fit="cover"
            style="width: 80px; height: 80px"
          />
        </template>
      </el-table-column>
      <el-table-column prop="artist_name" label="艺术家" />
      <el-table-column prop="year" label="年份" width="100" />
      <el-table-column label="价格" width="200">
        <template #default="{ row }">
          <div v-if="row.discount_price && row.discount_price < row.original_price">
            <span class="original-price">¥{{ row.original_price }}</span>
            <span class="discount-price">¥{{ row.discount_price }}</span>
          </div>
          <span v-else>¥{{ row.original_price }}</span>
        </template>
      </el-table-column>
      <el-table-column label="库存/销量" width="150">
        <template #default="{ row }">
          <div>库存: {{ row.stock }}</div>
          <div>销量: {{ row.sales }}</div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.is_on_sale ? 'success' : 'info'">
            {{ row.is_on_sale ? '在售' : '下架' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button type="primary" size="small" @click="editArtwork(row)">编辑</el-button>
          <el-button type="danger" size="small" @click="deleteArtwork(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 添加/编辑对话框 -->
    <el-dialog 
      :title="dialogType === 'add' ? '添加艺术品' : '编辑艺术品'" 
      v-model="dialogVisible"
      width="60%"
    >
      <el-form 
        :model="form" 
        :rules="rules"
        ref="formRef"
        label-width="100px"
      >
        <el-form-item label="标题" required>
          <el-input v-model="form.title" />
        </el-form-item>
        <el-form-item label="图片" required>
          <el-upload
            class="avatar-uploader"
            :action="`${baseUrl}/api/upload`"
            :show-file-list="false"
            :on-success="handleUploadSuccess"
            :before-upload="beforeUpload"
          >
            <img v-if="form.image" :src="form.image" class="avatar" />
            <el-icon v-else class="avatar-uploader-icon"><Plus /></el-icon>
          </el-upload>
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
        <el-form-item label="年份">
          <el-input v-model="form.year" />
        </el-form-item>
        <el-divider>价格和库存信息</el-divider>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="原价" prop="original_price">
              <el-input-number 
                v-model="form.original_price" 
                :min="0" 
                :precision="2" 
                :step="100"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="折扣价" prop="discount_price">
              <el-input-number 
                v-model="form.discount_price" 
                :min="0" 
                :precision="2" 
                :step="100"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="库存" prop="stock">
              <el-input-number 
                v-model="form.stock" 
                :min="0" 
                :precision="0" 
                :step="1"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="销量" prop="sales">
              <el-input-number 
                v-model="form.sales" 
                :min="0" 
                :precision="0" 
                :step="1"
                style="width: 100%"
                :disabled="true"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="状态" prop="is_on_sale">
          <el-switch
            v-model="form.is_on_sale"
            :active-value="1"
            :inactive-value="0"
            active-text="在售"
            inactive-text="下架"
          />
        </el-form-item>

        <el-form-item label="描述">
          <el-input type="textarea" v-model="form.description" rows="4" />
        </el-form-item>

        <el-divider>收藏信息</el-divider>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="收藏位置">
              <el-input v-model="form.collection_location" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="收藏编号">
              <el-input v-model="form.collection_number" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="作品尺寸">
              <el-input v-model="form.collection_size" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="作品材质">
              <el-input v-model="form.collection_material" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" @click="submitForm">确定</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import axios from '../utils/axios'  // 使用封装的axios实例
import { useRouter } from 'vue-router'
import { uploadImageToWebpLimit5MB } from '../utils/image'

const router = useRouter()
const baseUrl = 'https://api.wx.2000gallery.art:2000'
const artworks = ref([])
const dialogVisible = ref(false)
const dialogType = ref('add')
const loading = ref(false)
const form = ref({
  title: '',
  image: '',
  artist_id: '',
  year: new Date().getFullYear(),
  original_price: 0,
  discount_price: 0,
  stock: 0,
  is_on_sale: 1,
  description: '',
  collection_location: '',
  collection_number: '',
  collection_size: '',
  collection_material: ''
})

const formRef = ref(null)
const rules = {
  original_price: [
    { required: true, message: '请输入原价', trigger: 'blur' },
    { type: 'number', min: 0, message: '价格必须大于等于0', trigger: 'blur' }
  ],
  discount_price: [
    { type: 'number', min: 0, message: '折扣价必须大于等于0', trigger: 'blur' }
  ],
  stock: [
    { required: true, message: '请输入库存', trigger: 'blur' },
    { type: 'number', min: 0, message: '库存必须大于等于0', trigger: 'blur' }
  ]
}

const artistOptions = ref([])

const fetchArtists = async () => {
  try {
    const data = await axios.get('/artists')
    if (Array.isArray(data)) {
      artistOptions.value = data
    } else {
      artistOptions.value = []
    }
  } catch (error) {
    artistOptions.value = []
    ElMessage.error('获取艺术家列表失败')
  }
}

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

// 获取艺术品列表
const fetchArtworks = async () => {
  if (!checkLoginStatus()) return
  
  loading.value = true
  try {
    console.log('Fetching artworks from:', `${baseUrl}/original-artworks`)
    const response = await axios.get('/original-artworks')
    console.log('API Response:', response)
    console.log('typeof response:', typeof response)
    console.log('Array.isArray(response):', Array.isArray(response))
    console.log('response:', response)

    let data = response
    if (Array.isArray(data)) {
      // 直接是数组
    } else if (data && Array.isArray(data.data)) {
      // 被包裹在 data 字段下
      data = data.data
    } else {
      console.error('Invalid response:', response)
      throw new Error('无效的响应数据')
    }

    // 处理数据
    artworks.value = data.map(item => {
      // 确保数值类型正确
      const artwork = {
        ...item,
        original_price: Number(item.original_price) || 0,
        discount_price: Number(item.discount_price) || 0,
        stock: Number(item.stock) || 0,
        sales: Number(item.sales) || 0,
        is_on_sale: Number(item.is_on_sale) || 0,
        year: Number(item.year) || new Date().getFullYear()
      }

      // 处理图片URL
      if (artwork.image && !artwork.image.startsWith('http')) {
        artwork.image = `${baseUrl}${artwork.image}`
      }

      // 处理艺术家头像
      if (artwork.artist && artwork.artist.avatar && !artwork.artist.avatar.startsWith('http')) {
        artwork.artist.avatar = `${baseUrl}${artwork.artist.avatar}`
      }

      return artwork
    })
  } catch (error) {
    console.error('Error fetching artworks:', error)
    if (error.response) {
      if (error.response.status === 401) {
        ElMessage.error('登录已过期，请重新登录')
        router.push('/login')
      } else {
        ElMessage.error(`获取艺术品列表失败: ${error.response.data.message || '服务器错误'}`)
      }
    } else if (error.request) {
      console.error('No response received:', error.request)
      ElMessage.error('无法连接到服务器，请检查网络连接')
    } else {
      console.error('Error message:', error.message)
      ElMessage.error(`获取艺术品列表失败: ${error.message}`)
    }
  } finally {
    loading.value = false
  }
}

// 显示添加对话框
const showAddDialog = () => {
  if (!checkLoginStatus()) return
  dialogType.value = 'add'
  form.value = {
    title: '',
    image: '',
    artist_id: '',
    year: new Date().getFullYear(),
    description: '',
    background: '',
    features: '',
    original_price: 0,
    discount_price: 0,
    stock: 0,
    sales: 0,
    is_on_sale: 1,
    collection_location: '',
    collection_number: '',
    collection_size: '',
    collection_material: ''
  }
  dialogVisible.value = true
}

// 编辑艺术品
const editArtwork = (row) => {
  if (!checkLoginStatus()) return
  console.log('Editing artwork:', row)
  dialogType.value = 'edit'
  form.value = {
    id: row.id,
    title: row.title || '',
    image: row.image || '',
    artist_id: row.artist?.id || '',
    year: Number(row.year) || new Date().getFullYear(),
    description: row.description || '',
    background: row.background || '',
    features: row.features || '',
    original_price: Number(row.original_price) || 0,
    discount_price: Number(row.discount_price) || 0,
    stock: Number(row.stock) || 0,
    sales: Number(row.sales) || 0,
    is_on_sale: Number(row.is_on_sale) || 1,
    collection_location: row.collection?.location || '',
    collection_number: row.collection?.number || '',
    collection_size: row.collection?.size || '',
    collection_material: row.collection?.material || ''
  }
  console.log('Form data:', form.value)
  dialogVisible.value = true
}

// 删除艺术品
const deleteArtwork = async (row) => {
  if (!checkLoginStatus()) return
  try {
    await ElMessageBox.confirm('确定要删除这个艺术品吗？', '提示', {
      type: 'warning'
    })
    console.log('Deleting artwork:', row.id)
    const response = await axios.delete(`/original-artworks/${row.id}`)
    console.log('Delete response:', response.data)
    ElMessage.success('删除成功')
    fetchArtworks()
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Delete error:', error)
      if (error.response) {
        if (error.response.status === 401) {
          ElMessage.error('登录已过期，请重新登录')
          router.push('/login')
        } else {
          ElMessage.error(error.response.data.message || '删除失败')
        }
      } else {
        ElMessage.error('删除失败')
      }
    }
  }
}

// 提交表单
const submitForm = async () => {
  if (!checkLoginStatus()) return
  if (!formRef.value) return
  
  try {
    await formRef.value.validate()
    
    const submitData = {
      title: form.value.title,
      image: form.value.image,
      artist_id: form.value.artist_id,
      year: Number(form.value.year),
      description: form.value.description,
      background: form.value.background,
      features: form.value.features,
      original_price: Number(form.value.original_price),
      discount_price: Number(form.value.discount_price),
      stock: Number(form.value.stock),
      sales: Number(form.value.sales),
      is_on_sale: Number(form.value.is_on_sale),
      collection_location: form.value.collection_location,
      collection_number: form.value.collection_number,
      collection_size: form.value.collection_size,
      collection_material: form.value.collection_material
    }

    console.log('Submitting data:', submitData)

    if (dialogType.value === 'add') {
      console.log('Adding new artwork...')
      const response = await axios.post('/original-artworks', submitData)
      console.log('Add response:', response.data)
      ElMessage.success('添加成功')
    } else {
      console.log('Updating artwork:', form.value.id)
      const response = await axios.put(`/original-artworks/${form.value.id}`, submitData)
      console.log('Update response:', response.data)
      ElMessage.success('更新成功')
    }
    dialogVisible.value = false
    fetchArtworks()
  } catch (error) {
    console.error('Submit error:', error)
    if (error.response) {
      if (error.response.status === 401) {
        ElMessage.error('登录已过期，请重新登录')
        router.push('/login')
      } else {
        ElMessage.error(error.response.data.message || '操作失败')
      }
    } else {
      ElMessage.error('表单验证失败，请检查输入')
    }
  }
}

// 上传图片相关方法
const handleUploadSuccess = (response) => {
  form.value.image = response.url
}

const beforeUpload = async (file) => {
  const result = await uploadImageToWebpLimit5MB(file)
  if (!result) return false
  return Promise.resolve(result)
}

onMounted(() => {
  fetchArtists()
  checkLoginStatus() && fetchArtworks()
})
</script>

<style scoped>
.artworks-container {
  padding: 20px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
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
  border-color: #409EFF;
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

.original-price {
  text-decoration: line-through;
  color: #999;
  margin-right: 10px;
}

.discount-price {
  color: #f56c6c;
  font-weight: bold;
}

:deep(.el-input-number) {
  width: 100%;
}
</style> 