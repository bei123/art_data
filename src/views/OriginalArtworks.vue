<template>
  <div class="artworks-container">
    <div class="header">
      <h2>艺术品管理</h2>
      <el-button type="primary" @click="showAddDialog">添加艺术品</el-button>
    </div>

    <el-table :data="artworks" style="width: 100%">
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
          <div v-if="row.discount_price && row.discount_price < row.price">
            <span class="original-price">¥{{ row.original_price }}</span>
            <span class="discount-price">¥{{ row.discount_price }}</span>
          </div>
          <span v-else>¥{{ row.price }}</span>
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
      <el-form :model="form" label-width="100px">
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
          <el-input v-model="form.artist_name" />
        </el-form-item>
        <el-form-item label="年份">
          <el-input v-model="form.year" />
        </el-form-item>
        <el-form-item label="原价" required>
          <el-input-number v-model="form.original_price" :min="0" :precision="2" />
        </el-form-item>
        <el-form-item label="折扣价">
          <el-input-number v-model="form.discount_price" :min="0" :precision="2" />
        </el-form-item>
        <el-form-item label="库存" required>
          <el-input-number v-model="form.stock" :min="0" :precision="0" />
        </el-form-item>
        <el-form-item label="状态">
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
import axios from 'axios'

const baseUrl = import.meta.env.VITE_API_BASE_URL
const artworks = ref([])
const dialogVisible = ref(false)
const dialogType = ref('add')
const form = ref({
  title: '',
  image: '',
  artist_name: '',
  year: '',
  original_price: 0,
  discount_price: 0,
  stock: 0,
  is_on_sale: 1,
  description: ''
})

// 获取艺术品列表
const fetchArtworks = async () => {
  try {
    const response = await axios.get(`${baseUrl}/api/original-artworks`)
    artworks.value = response.data
  } catch (error) {
    ElMessage.error('获取艺术品列表失败')
  }
}

// 显示添加对话框
const showAddDialog = () => {
  dialogType.value = 'add'
  form.value = {
    title: '',
    image: '',
    artist_name: '',
    year: '',
    original_price: 0,
    discount_price: 0,
    stock: 0,
    is_on_sale: 1,
    description: ''
  }
  dialogVisible.value = true
}

// 编辑艺术品
const editArtwork = (row) => {
  dialogType.value = 'edit'
  form.value = { ...row }
  dialogVisible.value = true
}

// 删除艺术品
const deleteArtwork = async (row) => {
  try {
    await ElMessageBox.confirm('确定要删除这个艺术品吗？', '提示', {
      type: 'warning'
    })
    await axios.delete(`${baseUrl}/api/original-artworks/${row.id}`)
    ElMessage.success('删除成功')
    fetchArtworks()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
}

// 提交表单
const submitForm = async () => {
  try {
    if (dialogType.value === 'add') {
      await axios.post(`${baseUrl}/api/original-artworks`, form.value)
      ElMessage.success('添加成功')
    } else {
      await axios.put(`${baseUrl}/api/original-artworks/${form.value.id}`, form.value)
      ElMessage.success('更新成功')
    }
    dialogVisible.value = false
    fetchArtworks()
  } catch (error) {
    ElMessage.error(dialogType.value === 'add' ? '添加失败' : '更新失败')
  }
}

// 上传图片相关方法
const handleUploadSuccess = (response) => {
  form.value.image = response.fullUrl
}

const beforeUpload = (file) => {
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

onMounted(() => {
  fetchArtworks()
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
</style> 