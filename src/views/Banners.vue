<template>
  <div>
    <div class="header">
      <h3>轮播图管理</h3>
      <el-button type="primary" @click="handleAdd">添加轮播图</el-button>
    </div>

    <el-table :data="banners" style="width: 100%">
      <el-table-column prop="title" label="标题" />
      <el-table-column label="图片">
        <template #default="{ row }">
          <el-image
            style="width: 200px; height: 100px"
            :src="getImageUrl(row.image_url)"
            fit="cover"
          />
        </template>
      </el-table-column>
      <el-table-column prop="link_url" label="链接" />
      <el-table-column prop="sort_order" label="排序" width="100" />
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'">
            {{ row.status === 'active' ? '启用' : '禁用' }}
          </el-tag>
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
      :title="isEdit ? '编辑轮播图' : '添加轮播图'"
      width="50%"
    >
      <el-form :model="form" label-width="100px">
        <el-form-item label="标题">
          <el-input v-model="form.title" />
        </el-form-item>
        <el-form-item label="图片">
          <el-upload
            class="banner-uploader"
            :action="`${API_BASE_URL}/api/upload`"
            :show-file-list="false"
            :on-success="handleImageSuccess"
            :before-upload="beforeImageUpload"
            name="file"
          >
            <img v-if="form.image_url" :src="getImageUrl(form.image_url)" class="banner" />
            <el-icon v-else class="banner-uploader-icon"><Plus /></el-icon>
          </el-upload>
        </el-form-item>
        <el-form-item label="链接">
          <el-input v-model="form.link_url" placeholder="请输入点击轮播图后跳转的链接" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort_order" :min="0" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status">
            <el-option label="启用" value="active" />
            <el-option label="禁用" value="inactive" />
          </el-select>
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

const banners = ref([])
const dialogVisible = ref(false)
const isEdit = ref(false)
const form = ref({
  title: '',
  image_url: '',
  link_url: '',
  sort_order: 0,
  status: 'active'
})

const fetchBanners = async () => {
  try {
    const res = await axios.get('/banners/all')
    console.log('原始数据:', res)
    const arr = Array.isArray(res) ? res : []
    banners.value = arr.map(banner => {
      console.log('处理单个banner:', banner)
      return {
        ...banner,
        image_url: getImageUrl(banner.image_url)
      }
    })
    console.log('处理后的banners:', banners.value)
  } catch (error) {
    console.error('获取轮播图列表失败：', error)
    ElMessage.error('获取轮播图列表失败')
  }
}

const handleAdd = () => {
  isEdit.value = false
  form.value = {
    title: '',
    image_url: '',
    link_url: '',
    sort_order: 0,
    status: 'active'
  }
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  form.value = { ...row }
  dialogVisible.value = true
}

const handleDelete = (row) => {
  ElMessageBox.confirm('确定要删除这个轮播图吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await axios.delete(`/banners/${row.id}`)
      ElMessage.success('删除成功')
      fetchBanners()
    } catch (error) {
      ElMessage.error('删除失败')
    }
  })
}

const handleImageSuccess = (response) => {
  form.value.image_url = response.url
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

const getImageUrl = (url) => {
  if (!url) {
    console.log('图片URL为空')
    return ''
  }
  const fullUrl = url.startsWith('http') ? url : `${API_BASE_URL}${url}`
  console.log('生成的完整图片URL:', fullUrl)
  return fullUrl
}

const handleSubmit = async () => {
  if (!form.value.title.trim()) {
    ElMessage.warning('请输入轮播图标题')
    return
  }
  if (!form.value.image_url) {
    ElMessage.warning('请上传轮播图图片')
    return
  }

  try {
    const submitData = {
      ...form.value
    }

    if (isEdit.value) {
      await axios.put(`/banners/${form.value.id}`, submitData)
    } else {
      await axios.post('/banners', submitData)
    }
    ElMessage.success('保存成功')
    dialogVisible.value = false
    fetchBanners()
  } catch (error) {
    ElMessage.error('保存失败')
  }
}

onMounted(() => {
  fetchBanners()
})
</script>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.banner-uploader {
  border: 1px dashed #d9d9d9;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  width: 360px;
  height: 180px;
}

.banner-uploader:hover {
  border-color: #409eff;
}

.banner-uploader-icon {
  font-size: 28px;
  color: #8c939d;
  width: 360px;
  height: 180px;
  text-align: center;
  line-height: 180px;
}

.banner {
  width: 360px;
  height: 180px;
  display: block;
  object-fit: cover;
}
</style> 