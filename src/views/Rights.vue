<template>
  <div>
    <div class="header">
      <h3>版权实物管理</h3>
      <el-button type="primary" @click="handleAdd">添加版权实物</el-button>
    </div>

    <el-table :data="rights" style="width: 100%">
      <el-table-column label="图片">
        <template #default="{ row }">
          <el-image 
            style="width: 100px; height: 100px"
            :src="row.images[0]"
            fit="cover"
          />
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
          ¥{{ row.price }}
        </template>
      </el-table-column>
      <el-table-column prop="remainingCount" label="剩余数量">
        <template #default="{ row }">
          {{ row.remainingCount }}/{{ row.totalCount }}
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
        <el-form-item label="期限">
          <el-input v-model="form.period" />
        </el-form-item>
        <el-form-item label="总数量">
          <el-input-number v-model="form.totalCount" :min="0" />
        </el-form-item>
        <el-form-item label="剩余数量">
          <el-input-number v-model="form.remainingCount" :min="0" :max="form.totalCount" />
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

const form = ref({
  title: '',
  status: '',
  price: 0,
  originalPrice: 0,
  period: '',
  totalCount: 0,
  remainingCount: 0,
  description: '',
  images: []
})

const fetchRights = async () => {
  try {
    const response = await axios.get('/api/rights')
    rights.value = response.data
  } catch (error) {
    ElMessage.error('获取版权实物列表失败')
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
    period: '',
    totalCount: 0,
    remainingCount: 0,
    description: '',
    images: []
  }
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  form.value = {
    id: row.id,
    title: row.title,
    status: row.status,
    price: row.price,
    originalPrice: row.original_price,
    period: row.period,
    totalCount: row.total_count,
    remainingCount: row.remaining_count,
    description: row.description,
    images: row.images ? row.images.split(',') : []
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
      await axios.delete(`/api/rights/${row.id}`)
      ElMessage.success('删除成功')
      fetchRights()
    } catch (error) {
      ElMessage.error('删除失败')
    }
  })
}

const handleImageSuccess = (response) => {
  form.value.images.push(response.url)
}

const handleImageRemove = (file) => {
  const index = form.value.images.indexOf(file.url)
  if (index !== -1) {
    form.value.images.splice(index, 1)
  }
}

const handleSubmit = async () => {
  try {
    if (isEdit.value) {
      await axios.put(`/api/rights/${form.value.id}`, form.value)
    } else {
      await axios.post('/api/rights', form.value)
    }
    ElMessage.success('保存成功')
    dialogVisible.value = false
    fetchRights()
  } catch (error) {
    ElMessage.error('保存失败')
  }
}

onMounted(() => {
  fetchRights()
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
</style> 