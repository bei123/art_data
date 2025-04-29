<template>
  <div>
    <div class="header">
      <h3>数字身份购买记录</h3>
    </div>

    <el-table :data="purchases" style="width: 100%">
      <el-table-column label="数字艺术品">
        <template #default="{ row }">
          <div class="artwork-info">
            <el-image 
              style="width: 60px; height: 60px"
              :src="getImageUrl(row.artwork_image)"
              fit="cover"
            />
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
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import axios from '../utils/axios'
import { API_BASE_URL } from '../config'

const route = useRoute()
const purchases = ref([])

const fetchPurchases = async () => {
  try {
    const data = await axios.get(`/digital-identity/purchases/${route.params.user_id}`)
    purchases.value = data
  } catch (error) {
    console.error('获取购买记录失败:', error)
    ElMessage.error('获取购买记录失败')
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

.artwork-info {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style> 