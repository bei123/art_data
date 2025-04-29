<template>
  <div class="refund-approval">
    <div class="header">
      <h2>退款审批</h2>
      <div class="filter">
        <el-select v-model="filterStatus" placeholder="选择状态" @change="loadRefunds">
          <el-option label="全部" value=""></el-option>
          <el-option label="待审批" value="PENDING"></el-option>
          <el-option label="已批准" value="APPROVED"></el-option>
          <el-option label="已拒绝" value="REJECTED"></el-option>
          <el-option label="处理中" value="PROCESSING"></el-option>
          <el-option label="退款成功" value="SUCCESS"></el-option>
          <el-option label="退款失败" value="FAILED"></el-option>
        </el-select>
      </div>
    </div>

    <el-table :data="refunds" style="width: 100%" v-loading="loading">
      <el-table-column prop="id" label="ID" width="80"></el-table-column>
      <el-table-column prop="out_trade_no" label="订单号" width="180"></el-table-column>
      <el-table-column prop="out_refund_no" label="退款单号" width="180"></el-table-column>
      <el-table-column prop="amount" label="退款金额">
        <template #default="{ row }">
          {{ JSON.parse(row.amount).refund }} 元
        </template>
      </el-table-column>
      <el-table-column prop="reason" label="退款原因"></el-table-column>
      <el-table-column prop="status" label="状态">
        <template #default="{ row }">
          <el-tag :type="getStatusType(row.status)">
            {{ getStatusText(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="申请时间" width="180">
        <template #default="{ row }">
          {{ formatDate(row.created_at) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button 
            v-if="row.status === 'PENDING'"
            type="primary" 
            size="small"
            @click="showApproveDialog(row)"
          >
            审批
          </el-button>
          <el-button 
            type="info" 
            size="small"
            @click="showDetail(row)"
          >
            详情
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @size-change="handleSizeChange"
        @current-change="handlePageChange"
      />
    </div>

    <!-- 审批对话框 -->
    <el-dialog
      v-model="approveDialogVisible"
      title="退款审批"
      width="500px"
    >
      <el-form :model="approveForm" label-width="100px">
        <el-form-item label="退款单号">
          <span>{{ approveForm.out_refund_no }}</span>
        </el-form-item>
        <el-form-item label="退款金额">
          <span>{{ JSON.parse(approveForm.amount).refund }} 元</span>
        </el-form-item>
        <el-form-item label="退款原因">
          <span>{{ approveForm.reason }}</span>
        </el-form-item>
        <el-form-item label="审批结果">
          <el-radio-group v-model="approveForm.approve">
            <el-radio :label="true">批准</el-radio>
            <el-radio :label="false">拒绝</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item 
          label="拒绝原因" 
          v-if="!approveForm.approve"
        >
          <el-input
            v-model="approveForm.reject_reason"
            type="textarea"
            :rows="3"
            placeholder="请输入拒绝原因"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="approveDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="handleApprove">确定</el-button>
        </span>
      </template>
    </el-dialog>

    <!-- 详情对话框 -->
    <el-dialog
      v-model="detailDialogVisible"
      title="退款详情"
      width="600px"
    >
      <el-descriptions :column="1" border>
        <el-descriptions-item label="退款ID">{{ currentRefund.id }}</el-descriptions-item>
        <el-descriptions-item label="订单号">{{ currentRefund.out_trade_no }}</el-descriptions-item>
        <el-descriptions-item label="退款单号">{{ currentRefund.out_refund_no }}</el-descriptions-item>
        <el-descriptions-item label="退款金额">
          {{ JSON.parse(currentRefund.amount).refund }} 元
        </el-descriptions-item>
        <el-descriptions-item label="退款原因">{{ currentRefund.reason }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="getStatusType(currentRefund.status)">
            {{ getStatusText(currentRefund.status) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="申请时间">{{ formatDate(currentRefund.created_at) }}</el-descriptions-item>
        <el-descriptions-item label="审批时间" v-if="currentRefund.approved_at">
          {{ formatDate(currentRefund.approved_at) }}
        </el-descriptions-item>
        <el-descriptions-item label="拒绝时间" v-if="currentRefund.rejected_at">
          {{ formatDate(currentRefund.rejected_at) }}
        </el-descriptions-item>
        <el-descriptions-item label="拒绝原因" v-if="currentRefund.reject_reason">
          {{ currentRefund.reject_reason }}
        </el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'

const loading = ref(false)
const refunds = ref([])
const currentPage = ref(1)
const pageSize = ref(10)
const total = ref(0)
const filterStatus = ref('')

const approveDialogVisible = ref(false)
const detailDialogVisible = ref(false)
const currentRefund = ref({})
const approveForm = ref({
  id: null,
  out_refund_no: '',
  amount: '',
  reason: '',
  approve: true,
  reject_reason: ''
})

// 加载退款申请列表
const loadRefunds = async () => {
  try {
    const response = await axios.get('/api/wx/pay/refund/requests', {
      params: {
        status: filterStatus.value,
        page: currentPage.value,
        limit: pageSize.value
      }
    });
    
    if (response.data.success) {
      refunds.value = response.data.data;
      total.value = response.data.total;
    } else {
      ElMessage.error(response.data.error || '加载退款申请列表失败');
    }
  } catch (error) {
    console.error('加载退款申请列表失败:', error);
    ElMessage.error('加载退款申请列表失败');
  }
};

// 显示审批对话框
const showApproveDialog = (refund) => {
  currentRefund.value = refund
  approveForm.value = {
    id: refund.id,
    out_refund_no: refund.out_refund_no,
    amount: refund.amount,
    reason: refund.reason,
    approve: true,
    reject_reason: ''
  }
  approveDialogVisible.value = true
}

// 显示详情对话框
const showDetail = (refund) => {
  currentRefund.value = refund
  detailDialogVisible.value = true
}

// 处理审批
const handleApprove = async () => {
  if (!approveForm.value.approve && !approveForm.value.reject_reason) {
    ElMessage.warning('请填写拒绝原因')
    return
  }

  try {
    const response = await axios.post('/api/wx/pay/refund/approve', {
      refund_id: approveForm.value.id,
      approve: approveForm.value.approve,
      reject_reason: approveForm.value.reject_reason
    })

    if (response.data.success) {
      ElMessage.success('审批成功')
      approveDialogVisible.value = false
      loadRefunds()
    } else {
      ElMessage.error(response.data.error || '审批失败')
    }
  } catch (error) {
    ElMessage.error('审批失败')
    console.error('审批失败:', error)
  }
}

// 修改分页处理
const handlePageChange = (page) => {
  currentPage.value = page;
  loadRefunds();
};

// 修改每页条数处理
const handleSizeChange = (size) => {
  pageSize.value = size;
  currentPage.value = 1;
  loadRefunds();
};

// 状态相关方法
const getStatusType = (status) => {
  const types = {
    PENDING: 'warning',
    APPROVED: 'primary',
    REJECTED: 'danger',
    PROCESSING: 'info',
    SUCCESS: 'success',
    FAILED: 'danger'
  }
  return types[status] || 'info'
}

const getStatusText = (status) => {
  const texts = {
    PENDING: '待审批',
    APPROVED: '已批准',
    REJECTED: '已拒绝',
    PROCESSING: '处理中',
    SUCCESS: '退款成功',
    FAILED: '退款失败'
  }
  return texts[status] || status
}

// 格式化日期
const formatDate = (dateStr) => {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleString()
}

onMounted(() => {
  loadRefunds()
})
</script>

<style scoped>
.refund-approval {
  padding: 20px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.filter {
  width: 200px;
}

.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style> 