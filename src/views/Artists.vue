<template>
  <div>
    <div class="header">
      <h3>艺术家管理</h3>
      <el-button type="primary" @click="handleAdd">添加艺术家</el-button>
    </div>

    <el-table :data="artists" style="width: 100%">
      <el-table-column label="头像">
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
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button type="primary" size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button type="danger" size="small" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑艺术家' : '添加艺术家'"
      width="50%"
    >
      <el-form :model="form" label-width="120px">
        <el-form-item label="艺术家姓名">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="所属时代">
          <el-input v-model="form.era" />
        </el-form-item>
        <el-form-item label="头像">
          <el-upload
            class="avatar-uploader"
            :action="`${API_BASE_URL}/api/upload`"
            :show-file-list="false"
            :on-success="handleAvatarSuccess"
            name="file"
          >
            <el-image
              style="width: 100%; height: 200px"
              :src="getImageUrl(form.avatar)"
              fit="cover"
            />
          </el-upload>
        </el-form-item>
        <el-form-item label="背景图">
          <el-upload
            class="banner-uploader"
            :action="`${API_BASE_URL}/api/upload`"
            :show-file-list="false"
            :on-success="handleBannerSuccess"
            name="file"
          >
            <el-image
              style="width: 100%; height: 200px"
              :src="getImageUrl(form.banner)"
              fit="cover"
            />
          </el-upload>
        </el-form-item>
        <el-form-item label="简介">
          <el-input v-model="form.description" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="传记">
          <el-input v-model="form.biography" type="textarea" :rows="6" />
        </el-form-item>
        <el-form-item label="艺术历程">
          <el-input v-model="form.journey" type="textarea" :rows="6" placeholder="请按时间顺序记录艺术家的重要创作时期、重大作品、获奖经历等" />
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
const artists = ref([])
const dialogVisible = ref(false)
const isEdit = ref(false)

const form = ref({
  name: '',
  era: '',
  avatar: '',
  banner: '',
  description: '',
  biography: '',
  journey: ''
})

const fetchArtists = async () => {
  try {
    const data = await axios.get('/artists')
    console.log('API返回的原始数据：', data)
    if (Array.isArray(data)) {
      artists.value = data
      console.log('设置后的艺术家数据：', artists.value)
    } else {
      console.error('返回的数据不是数组：', data)
      artists.value = []
      ElMessage.error('获取数据格式不正确')
    }
  } catch (error) {
    console.error('获取艺术家列表失败：', error)
    artists.value = []
    ElMessage.error('获取艺术家列表失败')
  }
}

const handleAdd = () => {
  isEdit.value = false
  form.value = {
    name: '',
    era: '',
    avatar: '',
    banner: '',
    description: '',
    biography: '',
    journey: ''
  }
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  form.value = {
    id: row.id,
    name: row.name,
    era: row.era,
    avatar: row.avatar,
    banner: row.banner,
    description: row.description,
    biography: row.biography,
    journey: row.journey
  }
  dialogVisible.value = true
}

const handleDelete = (row) => {
  ElMessageBox.confirm('确定要删除这个艺术家吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await axios.delete(`/artists/${row.id}`)
      ElMessage.success('删除成功')
      fetchArtists()
    } catch (error) {
      ElMessage.error('删除失败')
    }
  })
}

const handleAvatarSuccess = (response) => {
  form.value.avatar = response.url;
}

const handleBannerSuccess = (response) => {
  form.value.banner = response.url;
}

const getImageUrl = (url) => {
  if (!url) return '';
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`;
}

const handleSubmit = async () => {
  if (!form.value.name.trim()) {
    ElMessage.warning('请输入艺术家姓名');
    return;
  }

  try {
    // 确保提交的图片URL是相对路径
    const submitData = {
      ...form.value,
      avatar: form.value.avatar ? (form.value.avatar.startsWith('http') ? form.value.avatar.replace(API_BASE_URL, '') : form.value.avatar) : '',
      banner: form.value.banner ? (form.value.banner.startsWith('http') ? form.value.banner.replace(API_BASE_URL, '') : form.value.banner) : ''
    };

    if (isEdit.value) {
      await axios.put(`/artists/${form.value.id}`, submitData)
    } else {
      await axios.post('/artists', submitData)
    }
    ElMessage.success('保存成功')
    dialogVisible.value = false
    fetchArtists()
  } catch (error) {
    ElMessage.error('保存失败')
  }
}

// 页面加载时获取数据
onMounted(() => {
  fetchArtists()
})
</script>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.avatar-uploader,
.banner-uploader {
  border: 1px dashed #d9d9d9;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: border-color 0.3s;
}

.avatar-uploader {
  width: 200px;
  height: 200px;
}

.banner-uploader {
  width: 400px;
  height: 200px;
}

.avatar-uploader:hover,
.banner-uploader:hover {
  border-color: #409eff;
}

.avatar-uploader :deep(.el-image),
.banner-uploader :deep(.el-image) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-uploader :deep(.el-upload),
.banner-uploader :deep(.el-upload) {
  width: 100%;
  height: 100%;
}

.avatar-uploader-icon,
.banner-uploader-icon {
  font-size: 28px;
  color: #8c939d;
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
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
</style> 