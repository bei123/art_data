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
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="图片">
          <el-upload
            class="upload-list"
            :action="`${API_BASE_URL}/api/upload`"
            list-type="picture-card"
            :on-success="handleImageSuccess"
            :on-remove="handleImageRemove"
            :before-upload="beforeImageUpload"
            :file-list="form.images.map(url => ({ url, name: url.split('/').pop() }))"
            name="file"
          >
            <el-icon><Plus /></el-icon>
          </el-upload>
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
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import axios from '../utils/axios'
import { API_BASE_URL } from '../config'

const router = useRouter()
const rights = ref([])
const dialogVisible = ref(false)
const isEdit = ref(false)
const categories = ref([])

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
  category_id: null
})

const fetchRights = async () => {
  try {
    const data = await axios.get('/rights')
    console.log('API返回的原始数据：', data)
    if (Array.isArray(data)) {
      rights.value = data.map(right => ({
        ...right,
        images: right.images ? right.images.map(image => getImageUrl(image)) : []
      }))
      console.log('设置后的版权实物数据：', rights.value)
    } else {
      console.error('返回的数据不是数组：', data)
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
    if (Array.isArray(response)) {
      categories.value = response
    } else {
      categories.value = []
    }
  } catch (error) {
    categories.value = []
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
    category_id: null
  }
  dialogVisible.value = true
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
    category_id: row.category_id
  }
  dialogVisible.value = true
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

const handleImageSuccess = (response) => {
  if (!form.value.images) {
    form.value.images = []
  }
  if (response && response.url) {
    form.value.images.push(response.url)
  } else {
    ElMessage.error('图片上传失败')
  }
}

const handleImageRemove = (file) => {
  const index = form.value.images.findIndex(url => url === file.url)
  if (index !== -1) {
    form.value.images.splice(index, 1)
  }
}

const getImageUrl = (url) => {
  if (!url) return ''
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`
}

const beforeImageUpload = (file) => {
  const isImage = file.type.startsWith('image/')
  const isLt5M = file.size / 1024 / 1024 < 5

  if (!isImage) {
    ElMessage.error('只能上传图片文件！')
    return false
  }
  if (!isLt5M) {
    ElMessage.error('图片大小不能超过 5MB！')
    return false
  }
  return true
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
      images: form.value.images.map(image => 
        image.startsWith('http') ? image.replace(API_BASE_URL, '') : image
      ),
      category_id: form.value.category_id,
      discount_amount: form.value.discountAmount
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
})
</script>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.upload-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.discount-info {
  color: #f56c6c;
  font-size: 12px;
  margin-top: 4px;
}

.image-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
</style> 