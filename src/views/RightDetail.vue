<template>
  <div class="right-detail">
    <el-page-header @back="goBack" :title="'返回列表'" />
    
    <el-card v-loading="loading" class="detail-card">
      <template #header>
        <div class="card-header">
          <span>版权实物详情</span>
          <el-button type="primary" @click="handleEdit">编辑</el-button>
        </div>
      </template>

      <el-form :model="form" label-width="120px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="标题">
              <el-input v-model="form.title" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="状态">
              <el-select v-model="form.status" placeholder="请选择状态">
                <el-option label="在售" value="onsale" />
                <el-option label="已售罄" value="soldout" />
                <el-option label="即将发售" value="upcoming" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="价格">
              <el-input-number v-model="form.price" :precision="2" :step="0.1" :min="0" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="原价">
              <el-input-number v-model="form.originalPrice" :precision="2" :step="0.1" :min="0" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="期限">
              <el-input v-model="form.period" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="剩余数量">
              <el-input-number v-model="form.remainingCount" :min="0" :max="form.totalCount" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="总数量">
          <el-input-number v-model="form.totalCount" :min="0" />
        </el-form-item>

        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="4" />
        </el-form-item>

        <el-divider>图片列表</el-divider>

        <el-form-item label="图片列表">
          <el-upload
            class="upload-list"
            :action="`${API_BASE_URL}/api/upload`"
            list-type="picture-card"
            :on-success="handleImageSuccess"
            :on-remove="handleImageRemove"
            :before-upload="beforeImageUpload"
            :file-list="form.images.map(url => ({ url, name: url.split('/').pop() }))"
            name="file"
          >
            <el-icon><Plus /></el-icon>
          </el-upload>
        </el-form-item>

        <el-divider>详情列表</el-divider>

        <div v-for="(detail, index) in form.details" :key="index" class="detail-item">
          <el-row :gutter="20">
            <el-col :span="10">
              <el-form-item :label="'标题'">
                <el-input v-model="detail.title" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="'内容'">
                <el-input v-model="detail.content" />
              </el-form-item>
            </el-col>
            <el-col :span="2">
              <el-button type="danger" @click="removeDetail(index)">删除</el-button>
            </el-col>
          </el-row>
        </div>

        <el-form-item>
          <el-button type="primary" @click="addDetail">添加详情</el-button>
        </el-form-item>

        <el-divider>规则列表</el-divider>

        <div v-for="(rule, index) in form.rules" :key="index" class="rule-item">
          <el-row :gutter="20">
            <el-col :span="10">
              <el-form-item :label="'标题'">
                <el-input v-model="rule.title" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="'内容'">
                <el-input v-model="rule.content" />
              </el-form-item>
            </el-col>
            <el-col :span="2">
              <el-button type="danger" @click="removeRule(index)">删除</el-button>
            </el-col>
          </el-row>
        </div>

        <el-form-item>
          <el-button type="primary" @click="addRule">添加规则</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import axios from '../utils/axios'
import { API_BASE_URL } from '../config'

const route = useRoute()
const router = useRouter()
const loading = ref(false)

const form = ref({
  title: '',
  price: 0,
  originalPrice: 0,
  description: '',
  status: '',
  period: '',
  remainingCount: 0,
  totalCount: 0,
  images: [],
  details: [],
  rules: []
})

const fetchRightDetail = async () => {
  loading.value = true
  try {
    const response = await axios.get(`/api/rights/detail/${route.params.id}`)
    const data = response.data
    form.value = {
      ...data,
      details: data.details || [],
      rules: data.rules || []
    }
  } catch (error) {
    ElMessage.error('获取版权实物详情失败')
  } finally {
    loading.value = false
  }
}

const handleImageSuccess = (response) => {
  form.value.image = response.url
}

const handleImageRemove = (file) => {
  const index = form.value.images.findIndex(url => url === file.url)
  if (index !== -1) {
    form.value.images.splice(index, 1)
  }
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

const addDetail = () => {
  form.value.details.push({
    title: '',
    content: ''
  })
}

const removeDetail = (index) => {
  form.value.details.splice(index, 1)
}

const addRule = () => {
  form.value.rules.push({
    title: '',
    content: ''
  })
}

const removeRule = (index) => {
  form.value.rules.splice(index, 1)
}

const handleEdit = async () => {
  try {
    await axios.put(`/api/rights/${route.params.id}`, form.value)
    ElMessage.success('更新成功')
  } catch (error) {
    ElMessage.error('更新失败')
  }
}

const goBack = () => {
  router.push('/rights')
}

onMounted(() => {
  fetchRightDetail()
})
</script>

<style scoped>
.right-detail {
  padding: 20px;
}

.detail-card {
  margin-top: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.upload-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.detail-item,
.rule-item {
  margin-bottom: 20px;
  padding: 10px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
}
</style> 