<template>
  <div class="merchant-detail">
    <div class="header">
      <el-button @click="$router.back()">返回</el-button>
      <h2>商家详情</h2>
    </div>

    <div v-loading="loading" class="content">
      <div class="basic-info">
        <div class="logo">
          <el-image 
            :src="merchant.logo" 
            :preview-src-list="[merchant.logo]"
            fit="cover"
          />
        </div>
        <div class="info">
          <h3>{{ merchant.name }}</h3>
          <p class="description">{{ merchant.description }}</p>
        </div>
      </div>

      <div class="images-section">
        <h3>商家图片</h3>
        <el-image
          v-for="(image, index) in merchant.images"
          :key="index"
          :src="image"
          :preview-src-list="merchant.images"
          fit="cover"
          class="merchant-image"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import axios from 'axios'

const route = useRoute()
const loading = ref(false)
const merchant = ref({
  name: '',
  logo: '',
  description: '',
  images: []
})

const baseUrl = import.meta.env.VITE_API_BASE_URL || 'https://api.wx.2000gallery.art:2000'

const fetchMerchantDetail = async () => {
  loading.value = true
  try {
    const response = await axios.get(`${baseUrl}/api/merchants/${route.params.id}`)
    merchant.value = response.data.data
  } catch (error) {
    ElMessage.error('获取商家详情失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchMerchantDetail()
})
</script>

<style scoped>
.merchant-detail {
  padding: 20px;
}

.header {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 30px;
}

.content {
  background: #fff;
  padding: 20px;
  border-radius: 8px;
}

.basic-info {
  display: flex;
  gap: 30px;
  margin-bottom: 40px;
}

.logo {
  width: 200px;
  height: 200px;
  border-radius: 8px;
  overflow: hidden;
}

.logo .el-image {
  width: 100%;
  height: 100%;
}

.info {
  flex: 1;
}

.info h3 {
  margin: 0 0 20px 0;
  font-size: 24px;
}

.description {
  color: #666;
  line-height: 1.6;
  margin: 0;
}

.images-section {
  margin-top: 30px;
}

.images-section h3 {
  margin-bottom: 20px;
}

.merchant-image {
  width: 200px;
  height: 200px;
  margin: 0 20px 20px 0;
  border-radius: 8px;
}
</style> 