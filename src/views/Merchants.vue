<template>
  <div class="merchants-container">
    <div class="header">
      <h2>商家管理</h2>
      <div class="header-actions">
        <el-input
          v-model="searchQuery"
          placeholder="搜索商家名称或描述"
          style="width: 300px; margin-right: 16px"
          clearable
          @clear="handleSearch"
          @keyup.enter="handleSearch"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-button type="primary" @click="showAddDialog">添加商家</el-button>
      </div>
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
      <el-table-column prop="address" label="地址" show-overflow-tooltip />
      <el-table-column prop="phone" label="电话" width="120" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-switch
            v-model="row.status"
            :active-value="'active'"
            :inactive-value="'inactive'"
            @change="handleStatusChange(row)"
          />
        </template>
      </el-table-column>
      <el-table-column label="排序" width="120">
        <template #default="{ row }">
          <el-input-number
            v-model="row.sort_order"
            :min="0"
            :max="999"
            size="small"
            @change="handleSortChange(row)"
          />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button type="primary" link @click="handleEdit(row)">编辑</el-button>
          <el-button type="danger" link @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination-container">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        :total="total"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="handleSizeChange"
        @current-change="handleCurrentChange"
      />
    </div>

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
        
        <el-form-item label="地址" prop="address">
          <el-input v-model="form.address" />
        </el-form-item>

        <el-form-item label="电话" prop="phone">
          <el-input v-model="form.phone" />
        </el-form-item>

        <el-form-item label="Logo" prop="logo">
          <el-upload
            class="logo-uploader"
            :action="`${baseUrl}/api/merchants/upload-logo`"
            :headers="uploadHeaders"
            :show-file-list="false"
            :on-success="handleLogoSuccess"
            :before-upload="beforeLogoUpload"
            :on-progress="handleLogoProgress"
            name="file"
          >
            <img v-if="form.logo" :src="form.logo" class="logo" />
            <el-icon v-else class="logo-uploader-icon"><Plus /></el-icon>
            <div v-if="logoUploadProgress > 0 && logoUploadProgress < 100" class="upload-progress">
              <el-progress :percentage="logoUploadProgress" />
            </div>
          </el-upload>
        </el-form-item>

        <el-form-item label="商家图片">
          <el-upload
            :action="`${baseUrl}/api/merchants/upload-images`"
            :headers="uploadHeaders"
            list-type="picture-card"
            :on-success="handleImagesSuccess"
            :on-remove="handleImagesRemove"
            :on-progress="handleImagesProgress"
            :file-list="imagesFileList"
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
import { Plus, Search } from '@element-plus/icons-vue'
import axios from 'axios'

const baseUrl = import.meta.env.VITE_API_BASE_URL || 'https://api.wx.2000gallery.art:2000'

// 创建axios实例
const request = axios.create({
  baseURL: baseUrl,
  timeout: 15000
})

// 请求拦截器
request.interceptors.request.use(
  config => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  error => {
    return Promise.reject(error)
  }
)

// 响应拦截器
request.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      ElMessage.error('登录已过期，请重新登录')
      // 可以在这里添加重定向到登录页面的逻辑
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

const merchants = ref([])
const loading = ref(false)
const dialogVisible = ref(false)
const dialogType = ref('add')
const formRef = ref(null)
const form = ref({
  name: '',
  logo: '',
  description: '',
  address: '',
  phone: '',
  images: []
})
const imagesFileList = ref([])
const logoUploadProgress = ref(0)
const searchQuery = ref('')
const currentPage = ref(1)
const pageSize = ref(10)
const total = ref(0)

const rules = {
  name: [{ required: true, message: '请输入商家名称', trigger: 'blur' }],
  logo: [{ required: true, message: '请上传Logo', trigger: 'change' }],
  description: [{ required: true, message: '请输入商家描述', trigger: 'blur' }],
  address: [{ required: true, message: '请输入商家地址', trigger: 'blur' }],
  phone: [
    { required: true, message: '请输入商家电话', trigger: 'blur' },
    { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号码', trigger: 'blur' }
  ]
}

const uploadHeaders = {
  Authorization: `Bearer ${localStorage.getItem('token')}`
}

// 获取商家列表
const fetchMerchants = async () => {
  loading.value = true
  try {
    const response = await request.get('/api/merchants', {
      params: {
        page: currentPage.value,
        limit: pageSize.value,
        search: searchQuery.value
      }
    })
    merchants.value = response.data.data
    total.value = response.data.pagination.total
  } catch (error) {
    ElMessage.error('获取商家列表失败')
  } finally {
    loading.value = false
  }
}

// 处理搜索
const handleSearch = () => {
  currentPage.value = 1
  fetchMerchants()
}

// 处理分页
const handleSizeChange = (val) => {
  pageSize.value = val
  fetchMerchants()
}

const handleCurrentChange = (val) => {
  currentPage.value = val
  fetchMerchants()
}

// 处理状态变更
const handleStatusChange = async (row) => {
  try {
    await request.patch(`/api/merchants/${row.id}/status`, {
      status: row.status
    })
    ElMessage.success('状态更新成功')
  } catch (error) {
    row.status = row.status === 'active' ? 'inactive' : 'active'
    ElMessage.error('状态更新失败')
  }
}

// 处理排序变更
const handleSortChange = async (row) => {
  try {
    await request.patch(`/api/merchants/${row.id}/sort`, {
      sort_order: row.sort_order
    })
    ElMessage.success('排序更新成功')
  } catch (error) {
    ElMessage.error('排序更新失败')
  }
}

// 处理删除
const handleDelete = async (row) => {
  try {
    await ElMessageBox.confirm('确定要删除该商家吗？', '提示', {
      type: 'warning'
    })
    
    await request.delete(`/api/merchants/${row.id}`)
    ElMessage.success('删除成功')
    fetchMerchants()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
}

// Logo上传进度
const handleLogoProgress = (event, file) => {
  logoUploadProgress.value = Math.round((event.loaded / event.total) * 100)
}

// 商家图片上传进度
const handleImagesProgress = (event, file) => {
  const index = imagesFileList.value.findIndex(item => item.uid === file.uid)
  if (index !== -1) {
    imagesFileList.value[index].progress = Math.round((event.loaded / event.total) * 100)
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

// 商家图片上传成功的回调
const handleImagesSuccess = (response, file, fileList) => {
  console.log('on-success fileList:', fileList)
  console.log('response:', response)
  form.value.images = Array.from(fileList)
    .map(item => item.response?.fullUrl || item.url)
    .filter(Boolean)
  imagesFileList.value = Array.from(fileList)
  console.log('图片上传成功，当前图片列表:', form.value.images)
}

const handleImagesRemove = (file, fileList) => {
  form.value.images = Array.from(fileList)
    .filter(item => item.status === 'success' && item.response && item.response.fullUrl)
    .map(item => item.response.fullUrl)
  imagesFileList.value = Array.from(fileList)
  console.log('图片移除后，当前图片列表:', form.value.images)
}

// Logo上传成功的回调
const handleLogoSuccess = (response) => {
  form.value.logo = response.fullUrl
}

// 显示添加对话框
const showAddDialog = () => {
  dialogType.value = 'add'
  form.value = {
    name: '',
    logo: '',
    description: '',
    address: '',
    phone: '',
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
    address: row.address,
    phone: row.phone,
    images: row.images || []
  }
  imagesFileList.value = (row.images || []).map(url => ({
    name: url.split('/').pop(),
    url,
    status: 'success',
    response: { fullUrl: url }
  }))
  dialogVisible.value = true
}

// 提交表单
const handleSubmit = async () => {
  if (!formRef.value) return
  await formRef.value.validate(async (valid) => {
    if (valid) {
      console.log('提交数据:', JSON.stringify(form.value, null, 2))
      try {
        if (dialogType.value === 'add') {
          await request.post('/api/merchants', form.value)
          ElMessage.success('添加成功')
        } else {
          await request.put(`/api/merchants/${form.value.id}`, form.value)
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

.header-actions {
  display: flex;
  align-items: center;
}

.pagination-container {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

.logo-uploader {
  position: relative;
}

.upload-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(255, 255, 255, 0.8);
  padding: 5px;
}

.logo {
  width: 100px;
  height: 100px;
  display: block;
}

.logo-uploader-icon {
  font-size: 28px;
  color: #8c939d;
  width: 100px;
  height: 100px;
  text-align: center;
  border: 1px dashed #d9d9d9;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  display: flex;
  justify-content: center;
  align-items: center;
}

.logo-uploader-icon:hover {
  border-color: #409EFF;
}
</style> 