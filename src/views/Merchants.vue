<template>
  <div class="merchants-container">
    <div class="header">
      <h2>商家管理</h2>
      <el-button type="primary" @click="showAddDialog">添加商家</el-button>
    </div>

    <el-table :data="merchants" style="width: 100%" v-loading="loading">
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column label="Logo" width="100">
        <template #default="{ row }">
          <el-image 
            :src="row.logo" 
            :preview-src-list="[row.logo]"
            fit="cover"
            style="width: 50px; height: 50px"
          />
        </template>
      </el-table-column>
      <el-table-column prop="name" label="商家名称" />
      <el-table-column prop="description" label="描述" show-overflow-tooltip />
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button type="primary" link @click="handleEdit(row)">编辑</el-button>
          <el-button type="danger" link @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 添加/编辑商家对话框 -->
    <el-dialog
      :title="dialogType === 'add' ? '添加商家' : '编辑商家'"
      v-model="dialogVisible"
      width="600px"
    >
      <el-form :model="form" :rules="rules" ref="formRef" label-width="100px">
        <el-form-item label="商家名称" prop="name">
          <el-input v-model="form.name" />
        </el-form-item>
        
        <el-form-item label="Logo" prop="logo">
          <el-upload
            class="logo-uploader"
            :action="`${baseUrl}/api/merchants/upload-logo`"
            :headers="uploadHeaders"
            :show-file-list="false"
            :on-success="handleLogoSuccess"
            :before-upload="beforeLogoUpload"
            name="file"
          >
            <img v-if="form.logo" :src="form.logo" class="logo" />
            <el-icon v-else class="logo-uploader-icon"><Plus /></el-icon>
          </el-upload>
        </el-form-item>

        <el-form-item label="商家图片">
          <el-upload
            :action="`${baseUrl}/api/merchants/upload-images`"
            :headers="uploadHeaders"
            list-type="picture-card"
            :on-success="handleImagesSuccess"
            :before-upload="beforeImagesUpload"
            name="images"
            multiple
          >
            <el-icon><Plus /></el-icon>
          </el-upload>
        </el-form-item>

        <el-form-item label="描述" prop="description">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="4"
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
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import axios from 'axios'

const baseUrl = import.meta.env.VITE_API_BASE_URL || 'https://api.wx.2000gallery.art:2000'
const merchants = ref([])
const loading = ref(false)
const dialogVisible = ref(false)
const dialogType = ref('add')
const formRef = ref(null)
const form = ref({
  name: '',
  logo: '',
  description: '',
  images: []
})

const rules = {
  name: [{ required: true, message: '请输入商家名称', trigger: 'blur' }],
  logo: [{ required: true, message: '请上传Logo', trigger: 'change' }],
  description: [{ required: true, message: '请输入商家描述', trigger: 'blur' }]
}

const uploadHeaders = {
  Authorization: `Bearer ${localStorage.getItem('token')}`
}

// 获取商家列表
const fetchMerchants = async () => {
  loading.value = true
  try {
    const response = await axios.get(`${baseUrl}/api/merchants`)
    merchants.value = response.data.data
  } catch (error) {
    ElMessage.error('获取商家列表失败')
  } finally {
    loading.value = false
  }
}

// Logo上传前的验证
const beforeLogoUpload = (file) => {
  const isImage = file.type.startsWith('image/')
  const isLt2M = file.size / 1024 / 1024 < 2

  if (!isImage) {
    ElMessage.error('只能上传图片文件!')
    return false
  }
  if (!isLt2M) {
    ElMessage.error('图片大小不能超过 2MB!')
    return false
  }
  return true
}

// 商家图片上传前的验证
const beforeImagesUpload = (file) => {
  const isImage = file.type.startsWith('image/')
  const isLt5M = file.size / 1024 / 1024 < 5

  if (!isImage) {
    ElMessage.error('只能上传图片文件!')
    return false
  }
  if (!isLt5M) {
    ElMessage.error('图片大小不能超过 5MB!')
    return false
  }
  return true
}

// Logo上传成功的回调
const handleLogoSuccess = (response) => {
  form.value.logo = response.fullUrl
}

// 商家图片上传成功的回调
const handleImagesSuccess = (response) => {
  if (response && response.fullUrl) {
    form.value.images.push(response.fullUrl)
  }
}

// 显示添加对话框
const showAddDialog = () => {
  dialogType.value = 'add'
  form.value = {
    name: '',
    logo: '',
    description: '',
    images: []
  }
  dialogVisible.value = true
}

// 显示编辑对话框
const handleEdit = (row) => {
  dialogType.value = 'edit'
  form.value = {
    id: row.id,
    name: row.name,
    logo: row.logo,
    description: row.description,
    images: row.images || []
  }
  dialogVisible.value = true
}

// 提交表单
const handleSubmit = async () => {
  if (!formRef.value) return
  
  await formRef.value.validate(async (valid) => {
    if (valid) {
      try {
        if (dialogType.value === 'add') {
          await axios.post(`${baseUrl}/api/merchants`, form.value, {
            headers: {
              Authorization: `Bearer ${localStorage.getItem('token')}`
            }
          })
          ElMessage.success('添加成功')
        } else {
          await axios.put(`${baseUrl}/api/merchants/${form.value.id}`, form.value, {
            headers: {
              Authorization: `Bearer ${localStorage.getItem('token')}`
            }
          })
          ElMessage.success('更新成功')
        }
        dialogVisible.value = false
        fetchMerchants()
      } catch (error) {
        ElMessage.error(dialogType.value === 'add' ? '添加失败' : '更新失败')
      }
    }
  })
}

// 删除商家
const handleDelete = (row) => {
  ElMessageBox.confirm('确定要删除该商家吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await axios.delete(`${baseUrl}/api/merchants/${row.id}`)
      ElMessage.success('删除成功')
      fetchMerchants()
    } catch (error) {
      ElMessage.error('删除失败')
    }
  })
}

onMounted(() => {
  fetchMerchants()
})
</script>

<style scoped>
.merchants-container {
  padding: 20px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.logo-uploader {
  border: 1px dashed #d9d9d9;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  width: 100px;
  height: 100px;
}

.logo-uploader:hover {
  border-color: #409EFF;
}

.logo-uploader-icon {
  font-size: 28px;
  color: #8c939d;
  width: 100px;
  height: 100px;
  text-align: center;
  line-height: 100px;
}

.logo {
  width: 100px;
  height: 100px;
  display: block;
  object-fit: cover;
}
</style> 