<template>
  <div class="refund-approval">
    <el-card>
      <div class="search-form">
        <el-form :inline="true" :model="searchForm" class="demo-form-inline">
          <el-form-item label="状态">
            <el-select v-model="searchForm.status" placeholder="请选择状态" clearable>
              <el-option label="待审批" value="pending" />
              <el-option label="已通过" value="approved" />
              <el-option label="已拒绝" value="rejected" />
              <el-option label="已完成" value="completed" />
              <el-option label="已失败" value="failed" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="handleSearch">查询</el-button>
          </el-form-item>
        </el-form>
      </div>

      <el-table :data="tableData" style="width: 100%" v-loading="loading">
        <el-table-column prop="out_trade_no" label="订单号" width="180" />
        <el-table-column prop="out_refund_no" label="退款单号" width="180" />
        <el-table-column prop="total_fee" label="订单金额" width="120">
          <template #default="scope">
            {{ (scope.row.total_fee / 100).toFixed(2) }}元
          </template>
        </el-table-column>
        <el-table-column prop="refund_fee" label="退款金额" width="120">
          <template #default="scope">
            {{ (scope.row.refund_fee / 100).toFixed(2) }}元
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="退款原因" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="scope">
            <el-tag :type="getStatusType(scope.row.status)">
              {{ getStatusText(scope.row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="申请时间" width="180">
          <template #default="scope">
            {{ formatDate(scope.row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="scope">
            <el-button
              v-if="scope.row.status === 'pending'"
              type="success"
              size="small"
              @click="handleApprove(scope.row)"
            >
              通过
            </el-button>
            <el-button
              v-if="scope.row.status === 'pending'"
              type="danger"
              size="small"
              @click="handleReject(scope.row)"
            >
              拒绝
            </el-button>
            <el-button
              type="primary"
              size="small"
              @click="handleViewDetail(scope.row)"
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
          :page-sizes="[10, 20, 50, 100]"
          :total="total"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleSizeChange"
          @current-change="handleCurrentChange"
        />
      </div>
    </el-card>

    <!-- 拒绝原因对话框 -->
    <el-dialog
      v-model="rejectDialogVisible"
      title="拒绝退款"
      width="500px"
    >
      <el-form :model="rejectForm" label-width="80px">
        <el-form-item label="拒绝原因">
          <el-input
            v-model="rejectForm.reason"
            type="textarea"
            :rows="3"
            placeholder="请输入拒绝原因"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="rejectDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="confirmReject">确定</el-button>
        </span>
      </template>
    </el-dialog>

    <!-- 详情对话框 -->
    <el-dialog
      v-model="detailDialogVisible"
      title="退款详情"
      width="700px"
    >
      <el-descriptions :column="2" border>
        <el-descriptions-item label="订单号">{{ currentDetail.out_trade_no }}</el-descriptions-item>
        <el-descriptions-item label="退款单号">{{ currentDetail.out_refund_no }}</el-descriptions-item>
        <el-descriptions-item label="订单金额">{{ (currentDetail.total_fee / 100).toFixed(2) }}元</el-descriptions-item>
        <el-descriptions-item label="退款金额">{{ (currentDetail.refund_fee / 100).toFixed(2) }}元</el-descriptions-item>
        <el-descriptions-item label="退款原因">{{ currentDetail.reason }}</el-descriptions-item>
        <el-descriptions-item label="当前状态">
          <el-tag :type="getStatusType(currentDetail.status)">
            {{ getStatusText(currentDetail.status) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="申请时间">{{ formatDate(currentDetail.created_at) }}</el-descriptions-item>
        <el-descriptions-item label="审批时间" v-if="currentDetail.approved_at">
          {{ formatDate(currentDetail.approved_at) }}
        </el-descriptions-item>
        <el-descriptions-item label="拒绝原因" v-if="currentDetail.reject_reason">
          {{ currentDetail.reject_reason }}
        </el-descriptions-item>
        <el-descriptions-item label="退款状态" v-if="currentDetail.refund_status">
          {{ currentDetail.refund_status }}
        </el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getRefundList, approveRefund, rejectRefund, getRefundDetail } from '@/api/refund'

// 搜索表单
const searchForm = ref({
  status: ''
})

// 表格数据
const tableData = ref([])
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(10)
const total = ref(0)

// 对话框控制
const rejectDialogVisible = ref(false)
const detailDialogVisible = ref(false)
const currentDetail = ref({})
const rejectForm = ref({
  out_refund_no: '',
  reason: ''
})

// 获取状态类型
const getStatusType = (status) => {
  const types = {
    pending: 'warning',
    approved: 'success',
    rejected: 'danger',
    completed: 'success',
    failed: 'danger'
  }
  return types[status] || 'info'
}

// 获取状态文本
const getStatusText = (status) => {
  const texts = {
    pending: '待审批',
    approved: '已通过',
    rejected: '已拒绝',
    completed: '已完成',
    failed: '已失败'
  }
  return texts[status] || status
}

// 格式化日期
const formatDate = (date) => {
  if (!date) return ''
  return new Date(date).toLocaleString()
}

// 获取退款列表
const fetchRefundList = async () => {
  loading.value = true
  try {
    const params = {
      page: currentPage.value,
      pageSize: pageSize.value,
      status: searchForm.value.status
    }
    const res = await getRefundList(params)
    tableData.value = res.data.list
    total.value = res.data.total
  } catch (error) {
    ElMessage.error('获取退款列表失败')
  } finally {
    loading.value = false
  }
}

// 搜索
const handleSearch = () => {
  currentPage.value = 1
  fetchRefundList()
}

// 分页大小改变
const handleSizeChange = (val) => {
  pageSize.value = val
  fetchRefundList()
}

// 页码改变
const handleCurrentChange = (val) => {
  currentPage.value = val
  fetchRefundList()
}

// 审批通过
const handleApprove = async (row) => {
  try {
    await ElMessageBox.confirm('确定要通过该退款申请吗？', '提示', {
      type: 'warning'
    })
    await approveRefund({ out_refund_no: row.out_refund_no })
    ElMessage.success('审批通过成功')
    fetchRefundList()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('审批通过失败')
    }
  }
}

// 拒绝退款
const handleReject = (row) => {
  rejectForm.value.out_refund_no = row.out_refund_no
  rejectForm.value.reason = ''
  rejectDialogVisible.value = true
}

// 确认拒绝
const confirmReject = async () => {
  if (!rejectForm.value.reason) {
    ElMessage.warning('请输入拒绝原因')
    return
  }
  try {
    await rejectRefund(rejectForm.value)
    ElMessage.success('拒绝成功')
    rejectDialogVisible.value = false
    fetchRefundList()
  } catch (error) {
    ElMessage.error('拒绝失败')
  }
}

// 查看详情
const handleViewDetail = async (row) => {
  try {
    const res = await getRefundDetail(row.out_refund_no)
    currentDetail.value = res.data
    detailDialogVisible.value = true
  } catch (error) {
    ElMessage.error('获取详情失败')
  }
}

// 初始化
onMounted(() => {
  fetchRefundList()
})
</script>

<style scoped>
.refund-approval {
  padding: 20px;
}

.search-form {
  margin-bottom: 20px;
}

.pagination {
  margin-top: 20px;
  text-align: right;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style> 