<template>
  <div>
    <div class="header">
      <h3>订单管理</h3>
      <div class="filters">
        <el-select v-model="filters.status" placeholder="订单状态" clearable style="width: 150px; margin-right: 10px;">
          <el-option label="全部" value="" />
          <el-option label="未支付" value="NOTPAY" />
          <el-option label="支付成功" value="SUCCESS" />
          <el-option label="转入退款" value="REFUND" />
          <el-option label="已关闭" value="CLOSED" />
          <el-option label="已撤销" value="REVOKED" />
          <el-option label="支付失败" value="PAYERROR" />
        </el-select>
        <el-select v-model="filters.type" placeholder="商品类型" clearable style="width: 150px; margin-right: 10px;">
          <el-option label="全部" value="" />
          <el-option label="权益" value="right" />
          <el-option label="数字艺术品" value="digital" />
          <el-option label="原作" value="artwork" />
        </el-select>
        <el-button type="primary" @click="fetchOrders">查询</el-button>
        <el-button @click="resetFilters">重置</el-button>
      </div>
    </div>

    <el-table :data="orders" style="width: 100%" v-loading="loading">
      <el-table-column prop="out_trade_no" label="订单号" width="180" />
      <el-table-column label="用户信息" width="150">
        <template #default="{ row }">
          <div class="user-info">
            <el-avatar :size="30" :src="row.user_avatar" />
            <span class="user-nickname">{{ row.user_nickname || '未知用户' }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="商品信息" min-width="300">
        <template #default="{ row }">
          <div v-for="item in row.items" :key="item.id" class="order-item">
            <el-image
              v-if="item.images && item.images.length > 0"
              :src="getImageUrl(item.images[0])"
              style="width: 50px; height: 50px; margin-right: 10px;"
              fit="cover"
            />
            <div class="item-info">
              <div class="item-title">{{ item.title }}</div>
              <div class="item-details">
                <span class="item-type">{{ getTypeLabel(item.type) }}</span>
                <span class="item-quantity">x{{ item.quantity }}</span>
                <span class="item-price">¥{{ item.price }}</span>
              </div>
              <!-- 地址信息显示 -->
              <div v-if="item.address" class="item-address">
                <el-icon><Location /></el-icon>
                <span class="address-text">{{ item.address.receiver_name }} {{ item.address.receiver_phone }}</span>
                <span class="address-detail">{{ item.address.full_address }}</span>
              </div>
              <div v-else class="item-address no-address">
                <el-icon><Location /></el-icon>
                <span class="address-text">无地址信息</span>
              </div>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="total_fee" label="订单金额" width="120">
        <template #default="{ row }">
          <span class="price">¥{{ row.total_fee }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="actual_fee" label="实付金额" width="120">
        <template #default="{ row }">
          <span class="price">¥{{ row.actual_fee }}</span>
        </template>
      </el-table-column>
      <el-table-column label="支付状态" width="120">
        <template #default="{ row }">
          <el-tag :type="getStatusType(row.pay_status.trade_state)">
            {{ getStatusLabel(row.pay_status.trade_state) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="180" />
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" size="small" @click="viewOrderDetail(row)">查看详情</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination-wrapper">
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.limit"
        :page-sizes="[10, 20, 50, 100]"
        :total="pagination.total"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="handleSizeChange"
        @current-change="handleCurrentChange"
      />
    </div>

    <!-- 订单详情对话框 -->
    <el-dialog
      v-model="detailDialogVisible"
      title="订单详情"
      width="60%"
      :before-close="handleDetailClose"
    >
      <div v-if="selectedOrder" class="order-detail">
        <div class="detail-section">
          <h4>订单信息</h4>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="订单号">{{ selectedOrder.out_trade_no }}</el-descriptions-item>
            <el-descriptions-item label="创建时间">{{ selectedOrder.created_at }}</el-descriptions-item>
            <el-descriptions-item label="用户信息">
              <div class="user-detail-info">
                <el-avatar :size="40" :src="selectedOrder.user_avatar" />
                <span>{{ selectedOrder.user_nickname || '未知用户' }}</span>
              </div>
            </el-descriptions-item>
            <el-descriptions-item label="订单金额">¥{{ selectedOrder.total_fee }}</el-descriptions-item>
            <el-descriptions-item label="实付金额">¥{{ selectedOrder.actual_fee }}</el-descriptions-item>
            <el-descriptions-item label="抵扣金额">¥{{ selectedOrder.discount_amount || 0 }}</el-descriptions-item>
            <el-descriptions-item label="支付状态">
              <el-tag :type="getStatusType(selectedOrder.pay_status.trade_state)">
                {{ getStatusLabel(selectedOrder.pay_status.trade_state) }}
              </el-tag>
            </el-descriptions-item>
          </el-descriptions>
        </div>

        <div class="detail-section">
          <h4>支付信息</h4>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="交易状态">{{ selectedOrder.pay_status.trade_state_desc }}</el-descriptions-item>
            <el-descriptions-item label="交易ID">{{ selectedOrder.pay_status.transaction_id || '-' }}</el-descriptions-item>
            <el-descriptions-item label="支付时间">{{ selectedOrder.pay_status.success_time || '-' }}</el-descriptions-item>
            <el-descriptions-item label="支付金额">
              {{ selectedOrder.pay_status.amount ? `¥${selectedOrder.pay_status.amount.total / 100}` : '-' }}
            </el-descriptions-item>
          </el-descriptions>
        </div>

        <div class="detail-section">
          <h4>商品信息</h4>
          <div v-for="item in selectedOrder.items" :key="item.id" class="detail-item">
            <div class="item-header">
              <el-image
                v-if="item.images && item.images.length > 0"
                :src="getImageUrl(item.images[0])"
                style="width: 80px; height: 80px;"
                fit="cover"
              />
              <div class="item-content">
                <h5>{{ item.title }}</h5>
                <p class="item-description">{{ item.description }}</p>
                <div class="item-meta">
                  <span class="item-type">{{ getTypeLabel(item.type) }}</span>
                  <span class="item-quantity">数量: {{ item.quantity }}</span>
                  <span class="item-price">单价: ¥{{ item.price }}</span>
                </div>
                <!-- 地址信息显示 -->
                <div v-if="item.address" class="item-address-detail">
                  <h6>收货地址</h6>
                  <el-descriptions :column="1" border size="small">
                    <el-descriptions-item label="收货人">{{ item.address.receiver_name }}</el-descriptions-item>
                    <el-descriptions-item label="联系电话">{{ item.address.receiver_phone }}</el-descriptions-item>
                    <el-descriptions-item label="收货地址">{{ item.address.full_address }}</el-descriptions-item>
                    <el-descriptions-item label="是否默认地址">
                      <el-tag :type="item.address.is_default ? 'success' : 'info'" size="small">
                        {{ item.address.is_default ? '默认地址' : '普通地址' }}
                      </el-tag>
                    </el-descriptions-item>
                  </el-descriptions>
                </div>
                <div v-else class="item-address-detail no-address">
                  <h6>收货地址</h6>
                  <el-empty description="无地址信息" :image-size="60" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, reactive, computed } from 'vue'
import { ElMessage } from 'element-plus'
import axios from '../utils/axios'
import { API_BASE_URL } from '../config'
import { useUserStore } from '../stores/user'
import { Location } from '@element-plus/icons-vue'

const orders = ref([])
const loading = ref(false)
const detailDialogVisible = ref(false)
const selectedOrder = ref(null)
const userStore = useUserStore()



const filters = reactive({
  status: '',
  type: ''
})

const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0
})

const fetchOrders = async () => {
  loading.value = true
  try {
    let params = {
      page: pagination.page,
      limit: pagination.limit
    }
    
    if (filters.status) {
      params.status = filters.status
    }
    
    // 后台管理页面，始终查询所有订单
    const response = await axios.get('/wx/pay/admin/orders', { params })
    
    if (response.success) {
      orders.value = response.data.orders
      pagination.total = response.data.pagination.total
    } else {
      ElMessage.error(response.error || '获取订单列表失败')
    }
  } catch (error) {
    console.error('获取订单列表失败:', error)
    ElMessage.error('获取订单列表失败')
  } finally {
    loading.value = false
  }
}

const resetFilters = () => {
  filters.status = ''
  filters.type = ''
  pagination.page = 1
  fetchOrders()
}

const handleSizeChange = (size) => {
  pagination.limit = size
  pagination.page = 1
  fetchOrders()
}

const handleCurrentChange = (page) => {
  pagination.page = page
  fetchOrders()
}

const viewOrderDetail = (order) => {
  selectedOrder.value = order
  detailDialogVisible.value = true
}

const handleDetailClose = () => {
  selectedOrder.value = null
  detailDialogVisible.value = false
}

const getImageUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('https://wx.oss.2000gallery.art/')) {
    return url;
  }
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`;
}

const getStatusType = (status) => {
  const statusMap = {
    'SUCCESS': 'success',
    'NOTPAY': 'warning',
    'REFUND': 'info',
    'CLOSED': 'danger',
    'REVOKED': 'danger',
    'PAYERROR': 'danger'
  }
  return statusMap[status] || 'info'
}

const getStatusLabel = (status) => {
  const statusMap = {
    'SUCCESS': '支付成功',
    'NOTPAY': '未支付',
    'REFUND': '转入退款',
    'CLOSED': '已关闭',
    'REVOKED': '已撤销',
    'PAYERROR': '支付失败'
  }
  return statusMap[status] || '未知状态'
}

const getTypeLabel = (type) => {
  const typeMap = {
    'right': '权益',
    'digital': '数字艺术品',
    'artwork': '原作'
  }
  return typeMap[type] || type
}

onMounted(() => {
  fetchOrders()
})
</script>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.filters {
  display: flex;
  align-items: center;
}

.order-item {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}

.order-item:last-child {
  margin-bottom: 0;
}

.item-info {
  flex: 1;
}

.item-title {
  font-weight: 500;
  margin-bottom: 5px;
}

.item-details {
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: #666;
}

.item-type {
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 3px;
}

.price {
  font-weight: 500;
  color: #e6a23c;
}

.pagination-wrapper {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}

.order-detail {
  max-height: 70vh;
  overflow-y: auto;
}

.detail-section {
  margin-bottom: 30px;
}

.detail-section h4 {
  margin-bottom: 15px;
  color: #303133;
  border-bottom: 1px solid #ebeef5;
  padding-bottom: 10px;
}

.detail-item {
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 15px;
  margin-bottom: 15px;
}

.item-header {
  display: flex;
  gap: 15px;
}

.item-content {
  flex: 1;
}

.item-content h5 {
  margin: 0 0 10px 0;
  color: #303133;
}

.item-description {
  color: #606266;
  margin: 0 0 10px 0;
  font-size: 14px;
}

.item-meta {
  display: flex;
  gap: 15px;
  font-size: 12px;
  color: #909399;
}

.item-meta span {
  background: #f5f7fa;
  padding: 4px 8px;
  border-radius: 3px;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-nickname {
  font-size: 12px;
  color: #606266;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-detail-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.item-address {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 10px;
  font-size: 12px;
  color: #606266;
}

.item-address .address-text {
  font-weight: 500;
  color: #303133;
}

.item-address .address-detail {
  font-size: 12px;
  color: #909399;
}

.item-address.no-address {
  color: #909399;
}

.item-address-detail {
  margin-top: 20px;
}

.item-address-detail h6 {
  margin-bottom: 10px;
  color: #303133;
  font-size: 14px;
}
</style>
