<template>
  <div>
    <div class="header">
      <h3>数字身份购买记录</h3>
    </div>

    <el-alert
      v-if="listError && !listLoading"
      class="list-state-alert"
      type="error"
      :closable="false"
      show-icon
      role="alert"
      :title="listError"
    >
      <el-button type="primary" link @click="retryFetchPurchases">重试</el-button>
    </el-alert>

    <div v-loading="listLoading" class="table-wrap">
    <el-table :data="purchases" style="width: 100%">
        <template #empty>
          <el-empty v-if="!listLoading" description="暂无购买记录" />
        </template>
      <el-table-column label="数字艺术品">
        <template #default="{ row }">
          <div class="artwork-info">
            <el-image
              lazy
              style="width: 60px; height: 60px"
              :src="getImageUrl(row.artwork_image)"
              fit="cover"
              :alt="row.artwork_title ? `数字艺术品：${row.artwork_title}` : '数字艺术品'"
            >
              <template #placeholder>
                <div class="el-image-placeholder-slot el-image-placeholder-slot--purchase" aria-hidden="true">
                  <el-icon class="is-loading"><Loading /></el-icon>
                </div>
              </template>
            </el-image>
            <span>{{ row.artwork_title }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="discount_amount" label="可抵扣金额">
        <template #default="{ row }">
          ¥{{ row.discount_amount }}
        </template>
      </el-table-column>
      <el-table-column prop="purchase_date" label="购买时间">
        <template #default="{ row }">
          {{ formatDate(row.purchase_date) }}
        </template>
      </el-table-column>
    </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Loading } from '@element-plus/icons-vue'
import axios from '../utils/axios'
import { API_BASE_URL } from '../config'

const route = useRoute()
const purchases = ref([])
const listLoading = ref(false)
const listError = ref('')

const retryFetchPurchases = () => {
  listError.value = ''
  fetchPurchases()
}

const fetchPurchases = async () => {
  listLoading.value = true
  listError.value = ''
  try {
    const data = await axios.get(`/digital-identity/purchases/${route.params.user_id}`)
    purchases.value = Array.isArray(data) ? data : []
    if (!Array.isArray(data)) {
      listError.value = '接口返回格式异常'
    }
  } catch (error) {
    console.error('获取购买记录失败:', error)
    purchases.value = []
    listError.value = '获取购买记录失败，请检查网络或稍后重试'
  } finally {
    listLoading.value = false
  }
}

const getImageUrl = (url) => {
  if (!url) return ''
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`
}

const formatDate = (date) => {
  if (!date) return ''
  return new Date(date).toLocaleString()
}

onMounted(() => {
  fetchPurchases()
})
</script>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.list-state-alert {
  margin-bottom: 12px;
}

.table-wrap {
  min-height: 160px;
}

.el-image-placeholder-slot--purchase {
  width: 60px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
  color: #909399;
}

.artwork-info {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style> 