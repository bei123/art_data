<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <h2 class="text-xl font-semibold tracking-tight text-foreground">推荐官提现</h2>
      <select
        v-model="filterStatus"
        class="flex h-9 w-full max-w-[10rem] rounded-md border border-input bg-background px-3 py-1 text-sm"
        @change="loadWithdrawals"
      >
        <option value="">全部</option>
        <option value="pending">待处理</option>
        <option value="processing">处理中</option>
        <option value="success">已到账</option>
        <option value="failed">失败</option>
      </select>
    </div>

    <Card class="relative overflow-hidden shadow-none ring-1">
      <div
        v-if="loading"
        class="absolute inset-0 z-10 flex items-center justify-center bg-background/70"
      >
        <Loader2 class="size-8 animate-spin text-muted-foreground" />
      </div>
      <CardContent class="overflow-x-auto p-0 sm:p-6">
        <table class="w-full min-w-[960px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="px-3 py-2 text-left">ID</th>
              <th class="px-3 py-2 text-left">用户</th>
              <th class="px-3 py-2 text-left">金额</th>
              <th class="px-3 py-2 text-left">状态</th>
              <th class="px-3 py-2 text-left">单号</th>
              <th class="px-3 py-2 text-left">申请时间</th>
              <th class="px-3 py-2 text-left">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in items" :key="row.id" class="border-b border-border">
              <td class="px-3 py-2">{{ row.id }}</td>
              <td class="px-3 py-2">{{ row.user_id }} / {{ row.nickname || '-' }}</td>
              <td class="px-3 py-2 font-medium">{{ formatMoney(row.amount) }}</td>
              <td class="px-3 py-2">{{ statusLabel(row.status) }}</td>
              <td class="px-3 py-2 font-mono text-xs">{{ row.out_bill_no }}</td>
              <td class="px-3 py-2">{{ formatDate(row.created_at) }}</td>
              <td class="px-3 py-2">
                <div class="flex gap-2">
                  <Button
                    v-if="row.status === 'pending' || row.status === 'failed'"
                    size="sm"
                    @click="handleApprove(row)"
                  >
                    确认打款
                  </Button>
                  <Button
                    v-if="row.status === 'pending' || row.status === 'processing'"
                    size="sm"
                    variant="outline"
                    @click="handleRetry(row)"
                  >
                    重试转账
                  </Button>
                </div>
              </td>
            </tr>
            <tr v-if="!items.length && !loading">
              <td colspan="7" class="px-3 py-12 text-center text-muted-foreground">暂无提现记录</td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import axios from '@/utils/axios'
import { showPageSuccess } from '@/utils/appMessage'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

const loading = ref(false)
const items = ref([])
const filterStatus = ref('')

function formatMoney(value) {
  const n = parseFloat(value)
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}

function formatDate(value) {
  if (!value) return '-'
  return String(value).replace('T', ' ').slice(0, 19)
}

function statusLabel(status) {
  const map = {
    pending: '待处理',
    processing: '处理中',
    success: '已到账',
    failed: '失败',
    cancelled: '已取消',
  }
  return map[status] || status
}

async function loadWithdrawals() {
  loading.value = true
  try {
    const params = { page: 1, pageSize: 50 }
    if (filterStatus.value) params.status = filterStatus.value
    const response = await axios.get('/admin/referral/withdrawals', { params })
    items.value = response.items || []
  } catch (error) {
    items.value = []
  } finally {
    loading.value = false
  }
}

async function handleApprove(row) {
  await axios.post(`/admin/referral/withdrawals/${row.id}/approve`)
  showPageSuccess('已确认打款')
  await loadWithdrawals()
}

async function handleRetry(row) {
  await axios.post(`/admin/referral/withdrawals/${row.id}/retry-transfer`)
  showPageSuccess('已触发转账重试')
  await loadWithdrawals()
}

onMounted(loadWithdrawals)
</script>
