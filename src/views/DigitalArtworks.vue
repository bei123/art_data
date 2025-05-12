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
            :src="getImageUrl(row.image_url)"
            fit="cover"
          />
        </template>
      </el-table-column>
      <el-table-column prop="author" label="作者" />
      <el-table-column prop="description" label="描述" show-overflow-tooltip />
      <el-table-column prop="project_name" label="项目名称" />
      <el-table-column prop="product_name" label="产品名称" />
      <el-table-column prop="project_owner" label="项目方" />
      <el-table-column prop="issuer" label="发行方" />
      <el-table-column prop="issue_batch" label="发行批次" />
      <el-table-column prop="issue_year" label="发行年份" />
      <el-table-column prop="batch_quantity" label="本批发行数量" />
      <el-table-column prop="price" label="价格" />
      <el-table-column prop="created_at" label="创建时间" />
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
      <el-form :model="form" label-width="120px">
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
            <img v-if="form.image_url" :src="getImageUrl(form.image_url)" class="avatar" />
            <el-icon v-else class="avatar-uploader-icon"><Plus /></el-icon>
          </el-upload>
        </el-form-item>
        <el-form-item label="作者">
          <el-input v-model="form.author" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="登记证书">
          <el-input v-model="form.registration_certificate" />
        </el-form-item>
        <el-form-item label="许可权利">
          <el-input v-model="form.license_rights" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="许可时间">
          <el-input v-model="form.license_period" />
        </el-form-item>
        <el-form-item label="所有者权益">
          <el-input v-model="form.owner_rights" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="许可事项">
          <el-input v-model="form.license_items" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="项目名称">
          <el-input v-model="form.project_name" />
        </el-form-item>
        <el-form-item label="产品名称">
          <el-input v-model="form.product_name" />
        </el-form-item>
        <el-form-item label="项目方">
          <el-input v-model="form.project_owner" />
        </el-form-item>
        <el-form-item label="发行方">
          <el-input v-model="form.issuer" />
        </el-form-item>
        <el-form-item label="发行批次">
          <el-input v-model="form.issue_batch" />
        </el-form-item>
        <el-form-item label="发行年份">
          <el-input-number v-model="form.issue_year" :min="1900" :max="2100" />
        </el-form-item>
        <el-form-item label="本批发行数量">
          <el-input-number v-model="form.batch_quantity" :min="1" />
        </el-form-item>
        <el-form-item label="价格">
          <el-input-number v-model="form.price" :precision="2" :step="0.01" :min="0" />
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
  image_url: '',
  author: '',
  description: '',
  registration_certificate: '',
  license_rights: '',
  license_period: '',
  owner_rights: '',
  license_items: '',
  project_name: '',
  product_name: '',
  project_owner: '',
  issuer: '',
  issue_batch: '',
  issue_year: new Date().getFullYear(),
  batch_quantity: 1,
  price: 0
})

const fetchArtworks = async () => {
  try {
    const data = await axios.get('/digital-artworks')
    console.log('API返回的原始数据：', data)
    if (Array.isArray(data)) {
      artworks.value = data.map(artwork => ({
        ...artwork,
        image_url: getImageUrl(artwork.image_url)
      }))
      console.log('设置后的数字艺术品数据：', artworks.value)
    } else {
      console.error('返回的数据不是数组：', data)
      artworks.value = []
      ElMessage.error('获取数据格式不正确')
    }
  } catch (error) {
    console.error('获取数字艺术品列表失败：', error)
    artworks.value = []
    ElMessage.error('获取数据失败')
  }
}

const handleAdd = () => {
  isEdit.value = false
  form.value = {
    title: '',
    image_url: '',
    author: '',
    description: '',
    registration_certificate: '',
    license_rights: '',
    license_period: '',
    owner_rights: '',
    license_items: '',
    project_name: '',
    product_name: '',
    project_owner: '',
    issuer: '',
    issue_batch: '',
    issue_year: new Date().getFullYear(),
    batch_quantity: 1,
    price: 0
  }
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  form.value = { ...row }
  if (form.value.issue_year === undefined) form.value.issue_year = new Date().getFullYear()
  if (form.value.batch_quantity === undefined) form.value.batch_quantity = 1
  if (form.value.price === undefined) form.value.price = 0
  dialogVisible.value = true
}

const handleDelete = (row) => {
  ElMessageBox.confirm('确定要删除这个作品吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await axios.delete(`/digital-artworks/${row.id}`)
      ElMessage.success('删除成功')
      fetchArtworks()
    } catch (error) {
      console.error('删除失败:', error)
      if (error.response) {
        ElMessage.error(error.response.data.error || '删除失败')
      } else {
        ElMessage.error('删除失败')
      }
    }
  })
}

const handleImageSuccess = (response) => {
  form.value.image_url = response.url;
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
  if (!form.value.image_url) {
    ElMessage.warning('请上传作品图片');
    return;
  }
  if (!form.value.author.trim()) {
    ElMessage.warning('请输入作者名称');
    return;
  }
  if (!form.value.description.trim()) {
    ElMessage.warning('请输入作品描述');
    return;
  }
  if (!form.value.project_name.trim()) {
    ElMessage.warning('请输入项目名称');
    return;
  }
  if (!form.value.product_name.trim()) {
    ElMessage.warning('请输入产品名称');
    return;
  }
  if (!form.value.project_owner.trim()) {
    ElMessage.warning('请输入项目方');
    return;
  }
  if (!form.value.issuer.trim()) {
    ElMessage.warning('请输入发行方');
    return;
  }
  if (!form.value.issue_batch.trim()) {
    ElMessage.warning('请输入发行批次');
    return;
  }
  if (!form.value.issue_year) {
    ElMessage.warning('请输入发行年份');
    return;
  }
  if (!form.value.batch_quantity) {
    ElMessage.warning('请输入本批发行数量');
    return;
  }
  if (form.value.price === undefined || form.value.price < 0) {
    ElMessage.warning('请输入有效的价格');
    return;
  }

  try {
    const submitData = {
      ...form.value,
      image_url: form.value.image_url.startsWith('http') ? form.value.image_url.replace(API_BASE_URL, '') : form.value.image_url
    };

    if (isEdit.value) {
      await axios.put(`/digital-artworks/${form.value.id}`, submitData)
    } else {
      await axios.post('/digital-artworks', submitData)
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