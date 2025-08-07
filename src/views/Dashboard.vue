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
                {{ row.artist?.name || '未知艺术家' }}
              </template>
            </el-table-column>
            <el-table-column prop="created_at" label="添加时间">
              <template #default="{ row }">
                {{ formatDate(row.created_at) }}
              </template>
            </el-table-column>
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
            <el-table-column label="艺术家">
              <template #default="{ row }">
                {{ row.artist?.name || '未知艺术家' }}
              </template>
            </el-table-column>
            <el-table-column prop="created_at" label="添加时间">
              <template #default="{ row }">
                {{ formatDate(row.created_at) }}
              </template>
            </el-table-column>
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

// 格式化日期
const formatDate = (dateString) => {
  if (!dateString) return ''
  const date = new Date(dateString)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const fetchStats = async () => {
  try {
    // 获取原作艺术品数据（分页格式）
    const originalRes = await axios.get('/original-artworks?pageSize=1000')
    // 获取数字艺术品数据（使用分页参数获取所有数据）
    const digitalRes = await axios.get('/digital-artworks?pageSize=1000')
    // 获取实物分类数据（分页格式）
    const categoriesRes = await axios.get('/physical-categories?limit=1000')
    
    console.log('Dashboard数据:', {
      original: originalRes,
      digital: digitalRes,
      categories: categoriesRes
    })

    // 处理原作艺术品数据（分页格式）
    let originalArtworks = []
    if (originalRes && originalRes.data && Array.isArray(originalRes.data)) {
      originalArtworks = originalRes.data
    } else if (Array.isArray(originalRes)) {
      // 兼容旧格式
      originalArtworks = originalRes
    }

    // 处理数字艺术品数据（直接数组格式）
    let digitalArtworks = []
    if (Array.isArray(digitalRes)) {
      digitalArtworks = digitalRes
    }

    // 处理实物分类数据（分页格式）
    let categories = []
    if (categoriesRes && categoriesRes.data && Array.isArray(categoriesRes.data)) {
      categories = categoriesRes.data
    } else if (Array.isArray(categoriesRes)) {
      // 兼容旧格式
      categories = categoriesRes
    }
    
    stats.value = {
      originalArtworks: originalArtworks.length,
      digitalArtworks: digitalArtworks.length,
      physicalCategories: categories.length
    }
    
    // 获取最近添加的作品（按创建时间排序）
    recentOriginalArtworks.value = originalArtworks
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5)
    
    recentDigitalArtworks.value = digitalArtworks
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5)
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