<template>
  <div>
    <div class="header">
      <h3>机构管理</h3>
      <el-button type="primary" @click="handleAdd">添加机构</el-button>
    </div>

    <el-table :data="institutions" style="width: 100%">
      <el-table-column label="Logo" width="100">
        <template #default="{ row }">
          <el-image
            style="width: 50px; height: 50px"
            :src="row.logo"
            fit="cover"
          />
        </template>
      </el-table-column>
      <el-table-column prop="name" label="机构名称" />
      <el-table-column prop="description" label="描述" :show-overflow-tooltip="true" />
      <el-table-column prop="address" label="地址" :show-overflow-tooltip="true" />
      <el-table-column prop="phone" label="电话" width="120" />
      <el-table-column prop="website" label="网站" width="150" />
      <el-table-column label="操作" width="250">
        <template #default="{ row }">
          <el-button type="primary" size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button type="success" size="small" @click="handleViewArtists(row)">查看艺术家</el-button>
          <el-button type="danger" size="small" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑机构' : '添加机构'"
      width="50%"
    >
      <el-form :model="form" label-width="120px">
        <el-form-item label="机构名称">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="Logo">
          <el-upload
            class="logo-uploader"
            :action="`${API_BASE_URL}/api/upload`"
            :show-file-list="false"
            :on-success="handleLogoSuccess"
            :before-upload="beforeLogoUpload"
            name="file"
          >
            <el-image
              style="width: 200px; height: 200px"
              :src="getImageUrl(form.logo)"
              fit="cover"
            />
          </el-upload>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="地址">
          <el-input v-model="form.address" />
        </el-form-item>
        <el-form-item label="电话">
          <el-input v-model="form.phone" />
        </el-form-item>
        <el-form-item label="网站">
          <el-input v-model="form.website" />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" @click="handleSubmit">确定</el-button>
        </span>
      </template>
    </el-dialog>

    <!-- 机构艺术家列表对话框 -->
    <el-dialog
      v-model="artistsDialogVisible"
      :title="`${selectedInstitution?.name || ''} - 艺术家列表`"
      width="80%"
    >
      <div v-if="institutionArtists.length === 0" class="empty-state">
        <el-empty description="该机构下暂无艺术家" />
      </div>
      <el-table v-else :data="institutionArtists" style="width: 100%">
        <el-table-column label="头像" width="100">
          <template #default="{ row }">
            <el-image
              style="width: 50px; height: 50px"
              :src="row.avatar"
              fit="cover"
            />
          </template>
        </el-table-column>
        <el-table-column prop="name" label="姓名" />
        <el-table-column prop="era" label="时代" />
        <el-table-column prop="description" label="艺术历程" :show-overflow-tooltip="true" />
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <el-button type="primary" size="small" @click="handleEditArtist(row)">编辑艺术家</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import axios from '../utils/axios'
import { API_BASE_URL } from '../config'
import { uploadImageToWebpLimit5MB } from '../utils/image'

const router = useRouter()
const institutions = ref([])
const dialogVisible = ref(false)
const isEdit = ref(false)
const artistsDialogVisible = ref(false)
const selectedInstitution = ref(null)
const institutionArtists = ref([])

const form = ref({
  name: '',
  logo: '',
  description: '',
  address: '',
  phone: '',
  website: ''
})

const fetchInstitutions = async () => {
  try {
    const data = await axios.get('/institutions')
    if (Array.isArray(data)) {
      institutions.value = data
    } else {
      institutions.value = []
      ElMessage.error('获取数据格式不正确')
    }
  } catch (error) {
    console.error('获取机构列表失败：', error)
    institutions.value = []
    ElMessage.error('获取机构列表失败')
  }
}

const handleAdd = () => {
  isEdit.value = false
  form.value = {
    name: '',
    logo: '',
    description: '',
    address: '',
    phone: '',
    website: ''
  }
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  form.value = {
    id: row.id,
    name: row.name,
    logo: row.logo,
    description: row.description,
    address: row.address,
    phone: row.phone,
    website: row.website
  }
  dialogVisible.value = true
}

const handleDelete = (row) => {
  ElMessageBox.confirm('确定要删除这个机构吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await axios.delete(`/institutions/${row.id}`)
      ElMessage.success('删除成功')
      fetchInstitutions()
    } catch (error) {
      ElMessage.error('删除失败')
    }
  })
}

const handleViewArtists = async (row) => {
  try {
    selectedInstitution.value = row
    const response = await axios.get(`/institutions/${row.id}/artists`)
    institutionArtists.value = response.artists || []
    artistsDialogVisible.value = true
  } catch (error) {
    console.error('获取机构艺术家失败：', error)
    ElMessage.error('获取机构艺术家失败')
  }
}

const handleEditArtist = (artist) => {
  // 跳转到艺术家管理页面并打开编辑对话框
  router.push({
    path: '/artists',
    query: { edit: artist.id }
  })
}

const handleLogoSuccess = (response) => {
  form.value.logo = response.url
}

const getImageUrl = (url) => {
  if (!url) return '';
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`;
}

const handleSubmit = async () => {
  if (!form.value.name.trim()) {
    ElMessage.warning('请输入机构名称');
    return;
  }

  try {
    // 确保提交的图片URL是相对路径
    const submitData = {
      ...form.value,
      logo: form.value.logo ? (form.value.logo.startsWith('http') ? form.value.logo.replace(API_BASE_URL, '') : form.value.logo) : ''
    };

    if (isEdit.value) {
      await axios.put(`/institutions/${form.value.id}`, submitData)
    } else {
      await axios.post('/institutions', submitData)
    }
    ElMessage.success('保存成功')
    dialogVisible.value = false
    fetchInstitutions()
  } catch (error) {
    ElMessage.error('保存失败')
  }
}

const beforeLogoUpload = async (file) => {
  const result = await uploadImageToWebpLimit5MB(file);
  if (!result) return false;
  return result;
}

// 页面加载时获取数据
onMounted(() => {
  fetchInstitutions()
})
</script>

<style scoped>
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
  transition: border-color 0.3s;
  width: 200px;
  height: 200px;
}

.logo-uploader:hover {
  border-color: #409eff;
}

.logo-uploader :deep(.el-image) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.logo-uploader :deep(.el-upload) {
  width: 100%;
  height: 100%;
}

:deep(.el-table .el-image) {
  width: 80px;
  height: 80px;
  border-radius: 4px;
}

:deep(.el-dialog .el-form-item) {
  margin-bottom: 22px;
}

:deep(.el-upload:hover) {
  border-color: #409eff;
}

:deep(.el-image) {
  transition: transform 0.3s;
}

:deep(.el-image:hover) {
  transform: scale(1.02);
}

.empty-state {
  text-align: center;
  padding: 40px 0;
}
</style>
