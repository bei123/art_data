<template>
  <div class="artist-detail">
    <el-page-header @back="goBack" :title="'返回列表'" />
    
    <el-card v-loading="loading" class="detail-card">
      <template #header>
        <div class="card-header">
          <span>艺术家详情</span>
          <el-button type="primary" @click="handleEdit">编辑</el-button>
        </div>
      </template>

      <el-form :model="form" label-width="120px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="艺术家姓名">
              <el-input v-model="form.name" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="所属时代">
              <el-input v-model="form.era" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="头像">
              <el-upload
                class="avatar-uploader"
                :action="`${API_BASE_URL}/api/upload`"
                :show-file-list="false"
                :on-success="handleAvatarSuccess"
                name="file"
              >
                <img v-if="form.avatar" :src="form.avatar" class="avatar" />
                <el-icon v-else class="avatar-uploader-icon"><Plus /></el-icon>
              </el-upload>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="背景图">
              <el-upload
                class="banner-uploader"
                :action="`${API_BASE_URL}/api/upload`"
                :show-file-list="false"
                :on-success="handleBannerSuccess"
                name="file"
              >
                <img v-if="form.banner" :src="form.banner" class="banner" />
                <el-icon v-else class="banner-uploader-icon"><Plus /></el-icon>
              </el-upload>
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="简介">
          <el-input v-model="form.description" type="textarea" :rows="4" />
        </el-form-item>

        <el-form-item label="传记">
          <el-input v-model="form.biography" type="textarea" :rows="6" />
        </el-form-item>

        <el-divider>成就列表</el-divider>

        <div v-for="(achievement, index) in form.achievements" :key="index" class="achievement-item">
          <el-row :gutter="20">
            <el-col :span="10">
              <el-form-item :label="'成就标题'">
                <el-input v-model="achievement.title" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="'成就描述'">
                <el-input v-model="achievement.description" />
              </el-form-item>
            </el-col>
            <el-col :span="2">
              <el-button type="danger" @click="removeAchievement(index)">删除</el-button>
            </el-col>
          </el-row>
        </div>

        <el-form-item>
          <el-button type="primary" @click="addAchievement">添加成就</el-button>
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
  name: '',
  avatar: '',
  banner: '',
  era: '',
  description: '',
  biography: '',
  achievements: []
})

const fetchArtistDetail = async () => {
  loading.value = true
  try {
    const response = await axios.get(`/api/artists/${route.params.id}`)
    const data = response.data
    form.value = {
      ...data,
      achievements: data.achievements || []
    }
  } catch (error) {
    ElMessage.error('获取艺术家详情失败')
  } finally {
    loading.value = false
  }
}

const handleAvatarSuccess = (response) => {
  form.value.avatar = response.url
}

const handleBannerSuccess = (response) => {
  form.value.banner = response.url
}

const addAchievement = () => {
  form.value.achievements.push({
    title: '',
    description: ''
  })
}

const removeAchievement = (index) => {
  form.value.achievements.splice(index, 1)
}

const handleEdit = async () => {
  try {
    await axios.put(`/api/artists/${route.params.id}`, form.value)
    ElMessage.success('更新成功')
  } catch (error) {
    ElMessage.error('更新失败')
  }
}

const goBack = () => {
  router.push('/artists')
}

onMounted(() => {
  fetchArtistDetail()
})
</script>

<style scoped>
.artist-detail {
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

.avatar-uploader,
.banner-uploader {
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

.banner-uploader {
  width: 300px;
  height: 150px;
}

.avatar-uploader:hover,
.banner-uploader:hover {
  border-color: #409eff;
}

.avatar-uploader-icon,
.banner-uploader-icon {
  font-size: 28px;
  color: #8c939d;
  text-align: center;
  line-height: 178px;
}

.banner-uploader-icon {
  line-height: 150px;
}

.avatar {
  width: 178px;
  height: 178px;
  display: block;
}

.banner {
  width: 300px;
  height: 150px;
  display: block;
}

.achievement-item {
  margin-bottom: 20px;
  padding: 10px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
}
</style> 