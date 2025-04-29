<template>
  <div class="refund-approval">
    <el-card class="box-card">
      <div slot="header" class="clearfix">
        <span>退款审批</span>
        <el-button style="float: right; padding: 3px 0" type="text" @click="refreshList">刷新</el-button>
      </div>
      
      <!-- 筛选条件 -->
      <el-form :inline="true" :model="filterForm" class="filter-form">
        <el-form-item label="状态">
          <el-select v-model="filterForm.status" placeholder="请选择状态" clearable>
            <el-option label="待审批" value="pending"></el-option>
            <el-option label="已通过" value="approved"></el-option>
            <el-option label="已拒绝" value="rejected"></el-option>
            <el-option label="已完成" value="completed"></el-option>
            <el-option label="已失败" value="failed"></el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="退款单号">
          <el-input v-model="filterForm.out_refund_no" placeholder="请输入退款单号"></el-input>
        </el-form-item>
        <el-form-item label="订单号">
          <el-input v-model="filterForm.out_trade_no" placeholder="请输入订单号"></el-input>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">搜索</el-button>
          <el-button @click="resetFilter">重置</el-button>
        </el-form-item>
      </el-form>

      <!-- 退款列表 -->
      <el-table :data="refundList" style="width: 100%" v-loading="loading">
        <el-table-column prop="out_refund_no" label="退款单号" width="180"></el-table-column>
        <el-table-column prop="out_trade_no" label="订单号" width="180"></el-table-column>
        <el-table-column prop="total_fee" label="订单金额" width="120">
          <template slot-scope="scope">
            {{ (scope.row.total_fee / 100).toFixed(2) }}元
          </template>
        </el-table-column>
        <el-table-column prop="refund_fee" label="退款金额" width="120">
          <template slot-scope="scope">
            {{ (scope.row.refund_fee / 100).toFixed(2) }}元
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="退款原因"></el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template slot-scope="scope">
            <el-tag :type="getStatusType(scope.row.status)">
              {{ getStatusText(scope.row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="申请时间" width="180">
          <template slot-scope="scope">
            {{ formatDate(scope.row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template slot-scope="scope">
            <el-button
              v-if="scope.row.status === 'pending'"
              size="mini"
              type="success"
              @click="handleApprove(scope.row)"
            >通过</el-button>
            <el-button
              v-if="scope.row.status === 'pending'"
              size="mini"
              type="danger"
              @click="handleReject(scope.row)"
            >拒绝</el-button>
            <el-button
              size="mini"
              type="primary"
              @click="handleDetail(scope.row)"
            >详情</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pagination-container">
        <el-pagination
          @size-change="handleSizeChange"
          @current-change="handleCurrentChange"
          :current-page="page"
          :page-sizes="[10, 20, 50, 100]"
          :page-size="pageSize"
          layout="total, sizes, prev, pager, next, jumper"
          :total="total">
        </el-pagination>
      </div>
    </el-card>

    <!-- 审批对话框 -->
    <el-dialog :title="dialogTitle" :visible.sync="dialogVisible" width="500px">
      <el-form :model="approvalForm" label-width="100px">
        <el-form-item label="退款单号">
          <span>{{ approvalForm.out_refund_no }}</span>
        </el-form-item>
        <el-form-item label="订单号">
          <span>{{ approvalForm.out_trade_no }}</span>
        </el-form-item>
        <el-form-item label="退款金额">
          <span>{{ (approvalForm.refund_fee / 100).toFixed(2) }}元</span>
        </el-form-item>
        <el-form-item label="退款原因">
          <span>{{ approvalForm.reason }}</span>
        </el-form-item>
        <el-form-item label="拒绝原因" v-if="!isApprove">
          <el-input
            type="textarea"
            v-model="approvalForm.reject_reason"
            :rows="3"
            placeholder="请输入拒绝原因"
          ></el-input>
        </el-form-item>
      </el-form>
      <div slot="footer" class="dialog-footer">
        <el-button @click="dialogVisible = false">取 消</el-button>
        <el-button type="primary" @click="submitApproval">确 定</el-button>
      </div>
    </el-dialog>

    <!-- 详情对话框 -->
    <el-dialog title="退款详情" :visible.sync="detailVisible" width="600px">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="退款单号">{{ detail.out_refund_no }}</el-descriptions-item>
        <el-descriptions-item label="订单号">{{ detail.out_trade_no }}</el-descriptions-item>
        <el-descriptions-item label="微信订单号">{{ detail.transaction_id }}</el-descriptions-item>
        <el-descriptions-item label="退款状态">
          <el-tag :type="getStatusType(detail.status)">
            {{ getStatusText(detail.status) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="订单金额">{{ (detail.total_fee / 100).toFixed(2) }}元</el-descriptions-item>
        <el-descriptions-item label="退款金额">{{ (detail.refund_fee / 100).toFixed(2) }}元</el-descriptions-item>
        <el-descriptions-item label="退款原因">{{ detail.reason }}</el-descriptions-item>
        <el-descriptions-item label="申请时间">{{ formatDate(detail.created_at) }}</el-descriptions-item>
        <el-descriptions-item label="审批时间" v-if="detail.approved_at">
          {{ formatDate(detail.approved_at) }}
        </el-descriptions-item>
        <el-descriptions-item label="拒绝原因" v-if="detail.reject_reason">
          {{ detail.reject_reason }}
        </el-descriptions-item>
        <el-descriptions-item label="微信退款单号" v-if="detail.refund_id">
          {{ detail.refund_id }}
        </el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<script>
import { getRefundList, approveRefund, getRefundDetail } from '@/api/refund'

export default {
  name: 'RefundApproval',
  data() {
    return {
      loading: false,
      refundList: [],
      total: 0,
      page: 1,
      pageSize: 10,
      filterForm: {
        status: '',
        out_refund_no: '',
        out_trade_no: ''
      },
      dialogVisible: false,
      detailVisible: false,
      dialogTitle: '',
      isApprove: true,
      approvalForm: {
        out_refund_no: '',
        out_trade_no: '',
        refund_fee: 0,
        reason: '',
        reject_reason: ''
      },
      detail: {}
    }
  },
  created() {
    this.getList()
  },
  methods: {
    async getList() {
      this.loading = true
      try {
        const params = {
          page: this.page,
          pageSize: this.pageSize,
          ...this.filterForm
        }
        const res = await getRefundList(params)
        this.refundList = res.data
        this.total = res.total
      } catch (error) {
        this.$message.error('获取退款列表失败')
      } finally {
        this.loading = false
      }
    },
    handleSearch() {
      this.page = 1
      this.getList()
    },
    resetFilter() {
      this.filterForm = {
        status: '',
        out_refund_no: '',
        out_trade_no: ''
      }
      this.handleSearch()
    },
    handleSizeChange(val) {
      this.pageSize = val
      this.getList()
    },
    handleCurrentChange(val) {
      this.page = val
      this.getList()
    },
    handleApprove(row) {
      this.dialogTitle = '通过退款申请'
      this.isApprove = true
      this.approvalForm = { ...row }
      this.dialogVisible = true
    },
    handleReject(row) {
      this.dialogTitle = '拒绝退款申请'
      this.isApprove = false
      this.approvalForm = { ...row }
      this.dialogVisible = true
    },
    async handleDetail(row) {
      try {
        const res = await getRefundDetail(row.out_refund_no)
        this.detail = res.data
        this.detailVisible = true
      } catch (error) {
        this.$message.error('获取退款详情失败')
      }
    },
    async submitApproval() {
      if (!this.isApprove && !this.approvalForm.reject_reason) {
        this.$message.warning('请输入拒绝原因')
        return
      }

      try {
        await approveRefund({
          out_refund_no: this.approvalForm.out_refund_no,
          approve: this.isApprove,
          reject_reason: this.approvalForm.reject_reason
        })
        this.$message.success(this.isApprove ? '已通过退款申请' : '已拒绝退款申请')
        this.dialogVisible = false
        this.getList()
      } catch (error) {
        this.$message.error('操作失败')
      }
    },
    refreshList() {
      this.getList()
    },
    getStatusType(status) {
      const types = {
        pending: 'warning',
        approved: 'success',
        rejected: 'danger',
        completed: 'success',
        failed: 'danger'
      }
      return types[status] || 'info'
    },
    getStatusText(status) {
      const texts = {
        pending: '待审批',
        approved: '已通过',
        rejected: '已拒绝',
        completed: '已完成',
        failed: '已失败'
      }
      return texts[status] || status
    },
    formatDate(date) {
      if (!date) return ''
      return new Date(date).toLocaleString()
    }
  }
}
</script>

<style lang="scss" scoped>
.refund-approval {
  padding: 20px;
  
  .box-card {
    margin-bottom: 20px;
  }
  
  .filter-form {
    margin-bottom: 20px;
  }
  
  .pagination-container {
    margin-top: 20px;
    text-align: right;
  }
}
</style> 