<template>
  <div>
    <div class="header">
      <h3>原作艺术品管理</h3>
      <el-button type="primary" @click="handleAdd">添加作品</el-button>
    </div>

    <el-table :data="artworks" style="width: 100%">
      <el-table-column prop="title" label="标题" />
      <el-table-column label="图片">
        <template #default="{ row }">
          <el-image
            style="width: 100px; height: 100px"
            :src="row.image"
            fit="cover"
          />
        </template>
      </el-table-column>
      <el-table-column label="艺术家">
        <template #default="{ row }">
          <div class="artist-info">
            <el-avatar :src="row.artist.avatar" />
            <span>{{ row.artist.name }}</span>
          </div>
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
      :title="isEdit ? '编辑作品' : '添加作品'"
      width="50%"
    >
      <el-form :model="form" label-width="100px">
        <el-form-item label="标题">
          <el-input v-model="form.title" />
        </el-form-item>
        <el-form-item label="图片">
          <el-upload
            class="avatar-uploader"
            :action="`${API_BASE_URL}/api/upload`"
            :show-file-list="false"
            :on-success="handleImageSuccess"
            name="file"
          >
            <img v-if="form.image" :src="form.image" class="avatar" />
            <el-icon v-else class="avatar-uploader-icon"><Plus /></el-icon>
          </el-upload>
        </el-form-item>
        <el-form-item label="艺术家">
          <el-input v-model="form.artist_name" placeholder="请输入艺术家姓名" />
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
import axios from '../utils/axios'
import { API_BASE_URL } from '../config'

const artworks = ref([])
const dialogVisible = ref(false)
const isEdit = ref(false)
const form = ref({
  title: '',
  image: '',
  artist_name: ''
})

const fetchArtworks = async () => {
  try {
    const response = await axios.get('/api/original-artworks')
    artworks.value = response.data
  } catch (error) {
    ElMessage.error('获取数据失败')
  }
}

const handleAdd = () => {
  isEdit.value = false
  form.value = {
    title: '',
    image: '',
    artist_name: ''
  }
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  form.value = {
    id: row.id,
    title: row.title,
    image: row.image,
    artist_name: row.artist.name,
    artist_id: row.artist.id
  }
  dialogVisible.value = true
}

const handleDelete = (row) => {
  ElMessageBox.confirm('确定要删除这个作品吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await axios.delete(`/api/original-artworks/${row.id}`)
      ElMessage.success('删除成功')
      fetchArtworks()
    } catch (error) {
      ElMessage.error('删除失败')
    }
  })
}

const handleImageSuccess = (response) => {
  form.value.image = response.url
}

const handleSubmit = async () => {
  try {
    if (isEdit.value) {
      await axios.put(`/api/original-artworks/${form.value.id}`, form.value)
    } else {
      await axios.post('/api/original-artworks', form.value)
    }
    ElMessage.success('保存成功')
    dialogVisible.value = false
    fetchArtworks()
  } catch (error) {
    ElMessage.error('保存失败')
  }
}

onMounted(() => {
  fetchArtworks()
})
</script>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.artist-info {
  display: flex;
  align-items: center;
  gap: 10px;
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