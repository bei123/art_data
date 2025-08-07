<template>
  <div>
    <div class="header">
      <h3>实物分类管理</h3>
      <el-button type="primary" @click="handleAdd">添加分类</el-button>
    </div>

    <el-table :data="categories" style="width: 100%">
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
      <el-table-column label="图标">
        <template #default="{ row }">
          <el-image
            style="width: 50px; height: 50px"
            :src="getImageUrl(row.icon)"
            fit="cover"
          />
        </template>
      </el-table-column>
      <el-table-column prop="count" label="作品数量" />
      <el-table-column prop="description" label="描述" />
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button type="primary" size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button type="danger" size="small" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑分类' : '添加分类'"
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
        <el-form-item label="图标">
          <el-upload
            class="icon-uploader"
            :action="`${API_BASE_URL}/api/upload`"
            :show-file-list="false"
            :on-success="handleIconSuccess"
            :before-upload="beforeImageUpload"
            name="file"
          >
            <img v-if="form.icon" :src="getImageUrl(form.icon)" class="icon" />
            <el-icon v-else class="icon-uploader-icon"><Plus /></el-icon>
          </el-upload>
        </el-form-item>
        <el-form-item label="作品数量">
          <el-input-number v-model="form.count" :min="0" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input type="textarea" v-model="form.description" />
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
import { uploadImageToWebpLimit5MB } from '../utils/image'

const categories = ref([])
const dialogVisible = ref(false)
const isEdit = ref(false)
const form = ref({
  title: '',
  image: '',
  icon: '',
  count: 0,
  description: ''
})

const fetchCategories = async () => {
  try {
    const response = await axios.get('/physical-categories')
    console.log('物理分类数据:', response)
    
    // 处理分页格式的响应数据
    let categoriesData = []
    if (response && response.data && Array.isArray(response.data)) {
      // 新格式：分页响应
      categoriesData = response.data
    } else if (response && Array.isArray(response)) {
      // 旧格式：直接数组
      categoriesData = response
    } else {
      console.error('返回数据格式不正确:', response)
      categories.value = []
      return
    }
    
    categories.value = categoriesData.map(category => ({
      ...category,
      image: getImageUrl(category.image),
      icon: getImageUrl(category.icon)
    }))
  } catch (error) {
    console.error('获取分类失败:', error)
    ElMessage.error('获取数据失败')
  }
}

const handleAdd = () => {
  isEdit.value = false
  form.value = {
    title: '',
    image: '',
    icon: '',
    count: 0,
    description: ''
  }
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  form.value = { ...row }
  dialogVisible.value = true
}

const handleDelete = (row) => {
  ElMessageBox.confirm('确定要删除这个分类吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await axios.delete(`/physical-categories/${row.id}`)
      ElMessage.success('删除成功')
      fetchCategories()
    } catch (error) {
      ElMessage.error('删除失败')
    }
  })
}

const handleImageSuccess = (response) => {
  form.value.image = response.url
}

const handleIconSuccess = (response) => {
  form.value.icon = response.url;
}

const getImageUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('https://wx.oss.2000gallery.art/')) {
    return url;
  }
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`;
}

const beforeImageUpload = async (file) => {
  const result = await uploadImageToWebpLimit5MB(file)
  if (!result) return false
  return Promise.resolve(result)
}

const handleSubmit = async () => {
  if (!form.value.title.trim()) {
    ElMessage.warning('请输入分类标题');
    return;
  }
  if (!form.value.image) {
    ElMessage.warning('请上传分类图片');
    return;
  }

  try {
    // 处理图片URL，保持OSS URL不变
    const submitData = {
      ...form.value,
      image: form.value.image.startsWith('https://wx.oss.2000gallery.art/') 
        ? form.value.image 
        : (form.value.image.startsWith('http') ? form.value.image.replace(API_BASE_URL, '') : form.value.image),
      icon: form.value.icon.startsWith('https://wx.oss.2000gallery.art/')
        ? form.value.icon
        : (form.value.icon.startsWith('http') ? form.value.icon.replace(API_BASE_URL, '') : form.value.icon)
    };

    if (isEdit.value) {
      await axios.put(`/physical-categories/${form.value.id}`, submitData)
    } else {
      await axios.post('/physical-categories', submitData)
    }
    ElMessage.success('保存成功')
    dialogVisible.value = false
    fetchCategories()
  } catch (error) {
    ElMessage.error('保存失败')
  }
}

onMounted(() => {
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

.avatar-uploader,
.icon-uploader {
  border: 1px dashed #d9d9d9;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
}

.avatar-uploader {
  width: 178px;
  height: 178px;
}

.icon-uploader {
  width: 100px;
  height: 100px;
}

.avatar-uploader:hover,
.icon-uploader:hover {
  border-color: #409eff;
}

.avatar-uploader-icon,
.icon-uploader-icon {
  font-size: 28px;
  color: #8c939d;
  text-align: center;
  line-height: 178px;
}

.icon-uploader-icon {
  line-height: 100px;
}

.avatar {
  width: 178px;
  height: 178px;
  display: block;
}

.icon {
  width: 100px;
  height: 100px;
  display: block;
}
</style> 