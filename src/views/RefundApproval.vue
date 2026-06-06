<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <h2 class="text-xl font-semibold tracking-tight text-foreground">
        退款审批
      </h2>
      <div class="flex w-full max-w-xs flex-col gap-2">
        <Label for="refund-filter-status" class="text-muted-foreground">状态筛选</Label>
        <select
          id="refund-filter-status"
          v-model="filterStatus"
          class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @change="loadRefunds"
        >
          <option value="">全部</option>
          <option value="PENDING">待审批</option>
          <option value="APPROVED">已批准</option>
          <option value="REJECTED">已拒绝</option>
          <option value="PROCESSING">处理中</option>
          <option value="SUCCESS">退款成功</option>
          <option value="FAILED">退款失败</option>
        </select>
      </div>
    </div>

    <Alert v-if="listError && !loading" variant="destructive">
      <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
      <AlertTitle>{{ listError }}</AlertTitle>
      <AlertDescription class="mt-2">
        <Button type="button" variant="secondary" size="sm" @click="retryLoadRefunds">
          重试
        </Button>
      </AlertDescription>
    </Alert>

    <Card class="relative overflow-hidden shadow-none ring-1">
      <div
        v-if="loading"
        class="absolute inset-0 z-10 flex items-center justify-center bg-background/70 backdrop-blur-[1px]"
        aria-busy="true"
        aria-label="加载中"
      >
        <Loader2 class="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
      <CardContent class="overflow-x-auto p-0 sm:p-6">
        <table class="w-full min-w-[960px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="h-10 w-16 px-3 text-left font-medium tabular-nums">ID</th>
              <th class="h-10 w-44 px-3 text-left font-medium">订单号</th>
              <th class="h-10 w-44 px-3 text-left font-medium">退款单号</th>
              <th class="h-10 w-28 px-3 text-left font-medium">退款金额</th>
              <th class="h-10 min-w-[8rem] px-3 text-left font-medium">退款原因</th>
              <th class="h-10 w-28 px-3 text-left font-medium">状态</th>
              <th class="h-10 w-44 px-3 text-left font-medium">申请时间</th>
              <th class="h-10 w-40 px-3 text-left font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in refunds"
              :key="row.id"
              class="border-b border-border transition-colors hover:bg-muted/30"
            >
              <td class="px-3 py-2.5 tabular-nums text-muted-foreground">{{ row.id }}</td>
              <td class="px-3 py-2.5 font-mono text-xs text-muted-foreground">{{ row.out_trade_no }}</td>
              <td class="px-3 py-2.5 font-mono text-xs text-muted-foreground">{{ row.out_refund_no }}</td>
              <td class="px-3 py-2.5 tabular-nums font-medium">
                {{ formatAmount(parseRefundCents(row.amount)) }} 元
              </td>
              <td class="max-w-[14rem] truncate px-3 py-2.5 text-muted-foreground" :title="row.reason">
                {{ row.reason }}
              </td>
              <td class="px-3 py-2.5">
                <Badge :variant="getStatusBadgeVariant(row.status)">
                  {{ getStatusText(row.status) }}
                </Badge>
              </td>
              <td class="px-3 py-2.5 tabular-nums text-muted-foreground">
                {{ formatDate(row.created_at) }}
              </td>
              <td class="px-3 py-2.5">
                <div class="flex flex-wrap gap-1.5">
                  <Button
                    v-if="row.status === 'PENDING'"
                    size="sm"
                    type="button"
                    @click="showApproveDialog(row)"
                  >
                    审批
                  </Button>
                  <Button
                    v-if="row.status === 'PROCESSING'"
                    size="sm"
                    type="button"
                    variant="outline"
                    :disabled="syncingRefundId === row.id"
                    @click="syncRefundStatus(row)"
                  >
                    刷新状态
                  </Button>
                  <Button size="sm" type="button" variant="secondary" @click="showDetail(row)">
                    详情
                  </Button>
                </div>
              </td>
            </tr>
            <tr v-if="refunds.length === 0 && !loading">
              <td colspan="8" class="px-3 py-12 text-center text-muted-foreground">
                暂无退款申请
              </td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>

    <Card class="shadow-none ring-1">
      <CardContent class="flex flex-col gap-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <span class="text-sm text-muted-foreground">共 {{ total }} 条</span>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm text-muted-foreground">每页</span>
          <Select
            :model-value="String(pageSize)"
            @update:model-value="(v) => handleSizeChange(Number(v))"
          >
            <SelectTrigger class="h-8 w-[88px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            type="button"
            :disabled="currentPage <= 1"
            @click="handlePageChange(currentPage - 1)"
          >
            上一页
          </Button>
          <span class="min-w-[5rem] text-center text-sm tabular-nums">
            {{ currentPage }} / {{ totalPages }}
          </span>
          <Button
            size="sm"
            variant="outline"
            type="button"
            :disabled="currentPage >= totalPages"
            @click="handlePageChange(currentPage + 1)"
          >
            下一页
          </Button>
        </div>
      </CardContent>
    </Card>

    <Dialog v-model:open="approveDialogVisible">
      <DialogContent class="max-w-[calc(100%-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>退款审批</DialogTitle>
        </DialogHeader>

        <div class="grid gap-4 py-2">
          <div class="grid gap-1 text-sm">
            <span class="text-muted-foreground">退款单号</span>
            <span class="font-mono text-xs">{{ approveForm.out_refund_no }}</span>
          </div>
          <div class="grid gap-1 text-sm">
            <span class="text-muted-foreground">退款金额</span>
            <span class="font-medium tabular-nums">{{ formatAmount(parseRefundCents(approveForm.amount)) }} 元</span>
          </div>
          <div class="grid gap-1 text-sm">
            <span class="text-muted-foreground">退款原因</span>
            <span>{{ approveForm.reason }}</span>
          </div>
          <div class="flex flex-col gap-2">
            <Label>审批结果</Label>
            <div class="flex flex-wrap gap-2">
              <Button
                type="button"
                :variant="approveForm.approve ? 'default' : 'outline'"
                size="sm"
                @click="approveForm.approve = true"
              >
                批准
              </Button>
              <Button
                type="button"
                :variant="approveForm.approve === false ? 'destructive' : 'outline'"
                size="sm"
                @click="approveForm.approve = false"
              >
                拒绝
              </Button>
            </div>
          </div>
          <div v-if="!approveForm.approve" class="flex flex-col gap-2">
            <Label for="reject-reason">拒绝原因</Label>
            <Textarea
              id="reject-reason"
              v-model="approveForm.reject_reason"
              placeholder="请输入拒绝原因"
              class="min-h-24"
              rows="3"
            />
          </div>
        </div>

        <DialogFooter class="gap-2 sm:justify-end">
          <Button type="button" variant="outline" @click="approveDialogVisible = false">
            取消
          </Button>
          <Button type="button" :disabled="approving" @click="handleApprove">
            <Loader2 v-if="approving" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="detailDialogVisible">
      <DialogContent class="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>退款详情</DialogTitle>
        </DialogHeader>

        <div class="grid gap-3 border-t border-border pt-4 text-sm">
          <div class="flex flex-col gap-1 border-b border-border pb-3 sm:grid sm:grid-cols-[8rem_1fr] sm:items-baseline sm:gap-2 sm:pb-2">
            <span class="text-muted-foreground">退款 ID</span>
            <span class="tabular-nums">{{ currentRefund.id }}</span>
          </div>
          <div class="flex flex-col gap-1 border-b border-border pb-3 sm:grid sm:grid-cols-[8rem_1fr] sm:items-baseline sm:gap-2 sm:pb-2">
            <span class="text-muted-foreground">订单号</span>
            <span class="break-all font-mono text-xs">{{ currentRefund.out_trade_no }}</span>
          </div>
          <div class="flex flex-col gap-1 border-b border-border pb-3 sm:grid sm:grid-cols-[8rem_1fr] sm:items-baseline sm:gap-2 sm:pb-2">
            <span class="text-muted-foreground">退款单号</span>
            <span class="break-all font-mono text-xs">{{ currentRefund.out_refund_no }}</span>
          </div>
          <div class="flex flex-col gap-1 border-b border-border pb-3 sm:grid sm:grid-cols-[8rem_1fr] sm:items-baseline sm:gap-2 sm:pb-2">
            <span class="text-muted-foreground">退款金额</span>
            <span class="font-medium tabular-nums">{{ formatAmount(parseRefundCents(currentRefund.amount)) }} 元</span>
          </div>
          <div class="flex flex-col gap-1 border-b border-border pb-3 sm:grid sm:grid-cols-[8rem_1fr] sm:items-baseline sm:gap-2 sm:pb-2">
            <span class="text-muted-foreground">退款原因</span>
            <span>{{ currentRefund.reason }}</span>
          </div>
          <div class="flex flex-col gap-1 border-b border-border pb-3 sm:grid sm:grid-cols-[8rem_1fr] sm:items-baseline sm:gap-2 sm:pb-2">
            <span class="text-muted-foreground">状态</span>
            <div>
              <Badge :variant="getStatusBadgeVariant(currentRefund.status)">
                {{ getStatusText(currentRefund.status) }}
              </Badge>
            </div>
          </div>
          <div class="flex flex-col gap-1 border-b border-border pb-3 sm:grid sm:grid-cols-[8rem_1fr] sm:items-baseline sm:gap-2 sm:pb-2">
            <span class="text-muted-foreground">申请时间</span>
            <span class="tabular-nums">{{ formatDate(currentRefund.created_at) }}</span>
          </div>
          <div
            v-if="currentRefund.approved_at"
            class="flex flex-col gap-1 border-b border-border pb-3 sm:grid sm:grid-cols-[8rem_1fr] sm:items-baseline sm:gap-2 sm:pb-2"
          >
            <span class="text-muted-foreground">审批时间</span>
            <span class="tabular-nums">{{ formatDate(currentRefund.approved_at) }}</span>
          </div>
          <div
            v-if="currentRefund.rejected_at"
            class="flex flex-col gap-1 border-b border-border pb-3 sm:grid sm:grid-cols-[8rem_1fr] sm:items-baseline sm:gap-2 sm:pb-2"
          >
            <span class="text-muted-foreground">拒绝时间</span>
            <span class="tabular-nums">{{ formatDate(currentRefund.rejected_at) }}</span>
          </div>
          <div
            v-if="currentRefund.reject_reason"
            class="flex flex-col gap-1 pb-1 sm:grid sm:grid-cols-[8rem_1fr] sm:items-baseline sm:gap-2"
          >
            <span class="text-muted-foreground">拒绝原因</span>
            <span>{{ currentRefund.reject_reason }}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { AlertCircle, Loader2 } from 'lucide-vue-next'
import axios from '../utils/axios'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const loading = ref(false)
const listError = ref('')
const refunds = ref([])
const currentPage = ref(1)
const pageSize = ref(10)
const total = ref(0)
const filterStatus = ref('')

const approveDialogVisible = ref(false)
const detailDialogVisible = ref(false)
const approving = ref(false)
const syncingRefundId = ref(null)
const currentRefund = ref({})
const approveForm = ref({
  id: null,
  out_refund_no: '',
  amount: '',
  reason: '',
  approve: true,
  reject_reason: '',
})

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

function parseRefundCents(amountStr) {
  if (!amountStr) return 0
  try {
    const j = typeof amountStr === 'string' ? JSON.parse(amountStr) : amountStr
    return j?.refund ?? 0
  } catch {
    return 0
  }
}

const retryLoadRefunds = () => {
  listError.value = ''
  loadRefunds()
}

const loadRefunds = async () => {
  try {
    loading.value = true
    listError.value = ''
    const response = await axios.get('/wx/pay/refund/requests', {
      params: {
        status: filterStatus.value,
        page: currentPage.value,
        limit: pageSize.value,
      },
    })

    if (response.success) {
      refunds.value = response.data
      total.value = response.total || 0
    } else {
      refunds.value = []
      total.value = 0
      listError.value = response.error || '加载退款申请列表失败'
    }
  } catch (error) {
    console.error('加载退款申请列表失败:', error)
    refunds.value = []
    total.value = 0
    listError.value = '加载退款申请列表失败，请检查网络或稍后重试'
  } finally {
    loading.value = false
  }
}

const showApproveDialog = (refund) => {
  currentRefund.value = refund
  approveForm.value = {
    id: refund.id,
    out_refund_no: refund.out_refund_no,
    amount: refund.amount,
    reason: refund.reason,
    approve: true,
    reject_reason: '',
  }
  approveDialogVisible.value = true
}

const showDetail = (refund) => {
  currentRefund.value = refund
  detailDialogVisible.value = true
}

async function syncRefundStatus(refund) {
  if (!refund?.id) return
  syncingRefundId.value = refund.id
  try {
    const response = await axios.get(`/wx/pay/refund/requests/${refund.id}`)
    if (response.success) {
      const nextStatus = response.data?.status
      const idx = refunds.value.findIndex((item) => item.id === refund.id)
      if (idx >= 0) refunds.value[idx] = { ...refunds.value[idx], ...response.data }
      if (nextStatus === 'SUCCESS') ElMessage.success('退款已完成')
      else if (nextStatus === 'FAILED') ElMessage.warning('微信侧退款失败')
      else if (nextStatus === 'PENDING') ElMessage.warning('微信侧未找到退款单，已退回待审批，请重新审批')
      else ElMessage.info('微信侧仍在处理中，请稍后再试')
    } else {
      ElMessage.error(response.error || '刷新状态失败')
    }
  } catch (error) {
    console.error('刷新退款状态失败:', error)
    ElMessage.error('刷新状态失败')
  } finally {
    syncingRefundId.value = null
  }
}

const handleApprove = async () => {
  if (!approveForm.value.approve && !approveForm.value.reject_reason?.trim()) {
    ElMessage.warning('请填写拒绝原因')
    return
  }

  approving.value = true
  try {
    const response = await axios.post('/wx/pay/refund/approve', {
      refund_id: approveForm.value.id,
      approve: approveForm.value.approve,
      reject_reason: approveForm.value.reject_reason,
    })

    if (response.success) {
      ElMessage.success('审批成功')
      approveDialogVisible.value = false
      loadRefunds()
    } else {
      ElMessage.error(response.error || '审批失败')
    }
  } catch (error) {
    console.error('审批失败:', error)
    ElMessage.error('审批失败')
  } finally {
    approving.value = false
  }
}

const handlePageChange = (page) => {
  currentPage.value = page
  loadRefunds()
}

const handleSizeChange = (size) => {
  pageSize.value = size
  currentPage.value = 1
  loadRefunds()
}

function getStatusBadgeVariant(status) {
  const variants = {
    PENDING: 'outline',
    APPROVED: 'default',
    REJECTED: 'destructive',
    PROCESSING: 'secondary',
    SUCCESS: 'default',
    FAILED: 'destructive',
  }
  return variants[status] || 'secondary'
}

const getStatusText = (status) => {
  const texts = {
    PENDING: '待审批',
    APPROVED: '已批准',
    REJECTED: '已拒绝',
    PROCESSING: '处理中',
    SUCCESS: '退款成功',
    FAILED: '退款失败',
  }
  return texts[status] || status
}

const formatDate = (dateStr) => {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleString()
}

const formatAmount = (amount) => {
  if (!amount) return '0.00'
  return (amount / 100).toFixed(2)
}

onMounted(() => {
  loadRefunds()
})
</script>
