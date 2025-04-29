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
      <el-table-column prop="description" label="描述" />
      <el-table-column prop="contract_address" label="合约地址" />
      <el-table-column prop="token_id" label="Token ID" />
      <el-table-column prop="blockchain" label="区块链" />
      <el-table-column prop="blockchain_url" label="链上信息" />
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
        <el-form-item label="合约地址">
          <el-input v-model="form.contract_address" />
        </el-form-item>
        <el-form-item label="Token ID">
          <el-input v-model="form.token_id" />
        </el-form-item>
        <el-form-item label="区块链">
          <el-input v-model="form.blockchain" />
        </el-form-item>
        <el-form-item label="链上信息">
          <el-input v-model="form.blockchain_url" />
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
  image_url: '',
  author: '',
  description: '',
  contract_address: '',
  token_id: '',
  blockchain: '',
  blockchain_url: '',
  copyright: ''
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
    contract_address: '',
    token_id: '',
    blockchain: '',
    blockchain_url: '',
    copyright: ''
  }
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  form.value = { ...row }
  if (form.value.copyright === undefined) form.value.copyright = ''
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
  if (!form.value.contract_address.trim()) {
    ElMessage.warning('请输入合约地址');
    return;
  }
  if (!form.value.token_id.trim()) {
    ElMessage.warning('请输入Token ID');
    return;
  }
  if (!form.value.blockchain.trim()) {
    ElMessage.warning('请输入区块链信息');
    return;
  }
  if (!form.value.blockchain_url.trim()) {
    ElMessage.warning('请输入链上信息查看地址');
    return;
  }
  if (!form.value.copyright.trim()) {
    ElMessage.warning('请输入版权信息');
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