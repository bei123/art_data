<template>
  <div>
    <h3>数据概览</h3>
    <el-row :gutter="20" class="dashboard-row">
      <el-col :span="8">
        <el-card shadow="hover">
          <template #header>
            <div class="card-header">
              <span>原作艺术品</span>
              <el-button type="primary" link @click="$router.push('/original-artworks')">查看全部</el-button>
            </div>
          </template>
          <div class="card-content">
            <div class="stat-number">{{ stats.originalArtworks }}</div>
            <div class="stat-desc">件作品</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover">
          <template #header>
            <div class="card-header">
              <span>数字艺术品</span>
              <el-button type="primary" link @click="$router.push('/digital-artworks')">查看全部</el-button>
            </div>
          </template>
          <div class="card-content">
            <div class="stat-number">{{ stats.digitalArtworks }}</div>
            <div class="stat-desc">件作品</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover">
          <template #header>
            <div class="card-header">
              <span>实物分类</span>
              <el-button type="primary" link @click="$router.push('/physical-categories')">查看全部</el-button>
            </div>
          </template>
          <div class="card-content">
            <div class="stat-number">{{ stats.physicalCategories }}</div>
            <div class="stat-desc">个分类</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="dashboard-row">
      <el-col :span="12">
        <el-card shadow="hover">
          <template #header>
            <div class="card-header">
              <span>最近添加的原作艺术品</span>
            </div>
          </template>
          <el-table :data="recentOriginalArtworks" style="width: 100%">
            <el-table-column prop="title" label="标题" />
            <el-table-column label="艺术家">
              <template #default="{ row }">
                {{ row.artist.name }}
              </template>
            </el-table-column>
            <el-table-column prop="created_at" label="添加时间" />
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="hover">
          <template #header>
            <div class="card-header">
              <span>最近添加的数字艺术品</span>
            </div>
          </template>
          <el-table :data="recentDigitalArtworks" style="width: 100%">
            <el-table-column prop="title" label="标题" />
            <el-table-column prop="created_at" label="添加时间" />
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import axios from '../utils/axios'

const stats = ref({
  originalArtworks: 0,
  digitalArtworks: 0,
  physicalCategories: 0
})

const recentOriginalArtworks = ref([])
const recentDigitalArtworks = ref([])

const fetchStats = async () => {
  try {
    const [originalRes, digitalRes, categoriesRes] = await Promise.all([
      axios.get('/original-artworks'),
      axios.get('/digital-artworks'),
      axios.get('/physical-categories')
    ])
    
    console.log('Dashboard数据:', {
      original: originalRes,
      digital: digitalRes,
      categories: categoriesRes
    })

    // 确保响应数据是数组
    const originalArtworks = Array.isArray(originalRes) ? originalRes : []
    const digitalArtworks = Array.isArray(digitalRes) ? digitalRes : []
    const categories = Array.isArray(categoriesRes) ? categoriesRes : []
    
    stats.value = {
      originalArtworks: originalArtworks.length,
      digitalArtworks: digitalArtworks.length,
      physicalCategories: categories.length
    }
    
    recentOriginalArtworks.value = originalArtworks.slice(-5).reverse()
    recentDigitalArtworks.value = digitalArtworks.slice(-5).reverse()
  } catch (error) {
    console.error('获取统计数据失败:', error)
    stats.value = {
      originalArtworks: 0,
      digitalArtworks: 0,
      physicalCategories: 0
    }
    recentOriginalArtworks.value = []
    recentDigitalArtworks.value = []
  }
}

onMounted(() => {
  fetchStats()
})
</script>

<style scoped>
.dashboard-row {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-content {
  text-align: center;
  padding: 20px 0;
}

.stat-number {
  font-size: 36px;
  font-weight: bold;
  color: #409eff;
}

.stat-desc {
  color: #909399;
  margin-top: 10px;
}
</style> 