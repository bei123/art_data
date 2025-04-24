<template>
  <div>
    <div class="header">
      <h3>数字艺术品管理</h3>
      <el-button type="primary" @click="handleAdd">添加作品</el-button>
    </div>

    <el-table :data="artworks" style="width: 100%">
      <el-table-column prop="title" label="标题" />
      <el-table-column label="图片">
        <template #default="{ row }">
          <el-image
            style="width: 100px; height: 100px"
            :src="getImageUrl(row.image)"
            fit="cover"
          />
        </template>
      </el-table-column>
      <el-table-column prop="author" label="作者" />
      <el-table-column prop="copyright" label="版权信息" />
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
            :before-upload="beforeImageUpload"
            name="file"
          >
            <img v-if="form.image" :src="getImageUrl(form.image)" class="avatar" />
            <el-icon v-else class="avatar-uploader-icon"><Plus /></el-icon>
          </el-upload>
        </el-form-item>
        <el-form-item label="作者">
          <el-input v-model="form.author" />
        </el-form-item>
        <el-form-item label="版权信息">
          <el-input v-model="form.copyright" />
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
  author: '',
  copyright: ''
})

const fetchArtworks = async () => {
  try {
    const response = await axios.get('/api/digital-artworks')
    artworks.value = response.data.map(artwork => ({
      ...artwork,
      image: getImageUrl(artwork.image)
    }))
  } catch (error) {
    ElMessage.error('获取数据失败')
  }
}

const handleAdd = () => {
  isEdit.value = false
  form.value = {
    title: '',
    image: '',
    author: '',
    copyright: ''
  }
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  form.value = { ...row }
  dialogVisible.value = true
}

const handleDelete = (row) => {
  ElMessageBox.confirm('确定要删除这个作品吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await axios.delete(`/api/digital-artworks/${row.id}`)
      ElMessage.success('删除成功')
      fetchArtworks()
    } catch (error) {
      ElMessage.error('删除失败')
    }
  })
}

const handleImageSuccess = (response) => {
  form.value.image = response.url;
}

const beforeImageUpload = (file) => {
  const isImage = file.type.startsWith('image/');
  const isLt5M = file.size / 1024 / 1024 < 5;

  if (!isImage) {
    ElMessage.error('只能上传图片文件！');
    return false;
  }
  if (!isLt5M) {
    ElMessage.error('图片大小不能超过 5MB！');
    return false;
  }
  return true;
}

const getImageUrl = (url) => {
  if (!url) return '';
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`;
}

const handleSubmit = async () => {
  if (!form.value.title.trim()) {
    ElMessage.warning('请输入作品标题');
    return;
  }
  if (!form.value.image) {
    ElMessage.warning('请上传作品图片');
    return;
  }
  if (!form.value.author.trim()) {
    ElMessage.warning('请输入作者名称');
    return;
  }
  if (!form.value.copyright.trim()) {
    ElMessage.warning('请输入版权信息');
    return;
  }

  try {
    const submitData = {
      ...form.value,
      image: form.value.image.startsWith('http') ? form.value.image.replace(API_BASE_URL, '') : form.value.image
    };

    if (isEdit.value) {
      await axios.put(`/api/digital-artworks/${form.value.id}`, submitData)
    } else {
      await axios.post('/api/digital-artworks', submitData)
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