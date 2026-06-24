<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <h2 class="text-xl font-semibold tracking-tight text-foreground">
        推荐佣金明细
      </h2>
      <div class="flex flex-wrap items-end gap-3">
        <div class="flex w-full max-w-[10rem] flex-col gap-2 sm:w-auto">
          <Label for="commission-filter-status" class="text-muted-foreground">状态</Label>
          <select
            id="commission-filter-status"
            v-model="filterStatus"
            class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            @change="handleFilterChange"
          >
            <option value="">全部</option>
            <option value="pending">待结算</option>
            <option value="settlable">可提现</option>
            <option value="withdrawn">已提现</option>
            <option value="cancelled">已取消</option>
          </select>
        </div>
        <div class="flex w-full max-w-[10rem] flex-col gap-2 sm:w-auto">
          <Label for="commission-filter-user" class="text-muted-foreground">推荐官 ID</Label>
          <Input
            id="commission-filter-user"
            v-model="filterUserId"
            type="number"
            placeholder="用户 ID"
            class="h-9"
            @keydown.enter="handleFilterChange"
          />
        </div>
        <div class="flex w-full max-w-[12rem] flex-col gap-2 sm:w-auto">
          <Label for="commission-filter-order" class="text-muted-foreground">订单号</Label>
          <Input
            id="commission-filter-order"
            v-model="filterOutTradeNo"
            placeholder="商户订单号"
            class="h-9"
            @keydown.enter="handleFilterChange"
          />
        </div>
        <Button type="button" variant="secondary" class="h-9" @click="handleFilterChange">
          查询
        </Button>
        <Button
          type="button"
          class="h-9"
          :disabled="settling"
          @click="handleSettleRun"
        >
          <Loader2 v-if="settling" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
          执行结算扫描
        </Button>
      </div>
    </div>

    <Alert v-if="listError && !loading" variant="destructive">
      <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
      <AlertTitle>{{ listError }}</AlertTitle>
      <AlertDescription class="mt-2">
        <Button type="button" variant="secondary" size="sm" @click="loadCommissions">
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
        <table class="w-full min-w-[1100px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="h-10 w-16 px-3 text-left font-medium">ID</th>
              <th class="h-10 w-24 px-3 text-left font-medium">推荐官</th>
              <th class="h-10 w-44 px-3 text-left font-medium">订单号</th>
              <th class="h-10 w-24 px-3 text-left font-medium">品类</th>
              <th class="h-10 w-24 px-3 text-left font-medium">成交额</th>
              <th class="h-10 w-20 px-3 text-left font-medium">比例</th>
              <th class="h-10 w-24 px-3 text-left font-medium">佣金</th>
              <th class="h-10 w-24 px-3 text-left font-medium">状态</th>
              <th class="h-10 w-40 px-3 text-left font-medium">创建时间</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in items"
              :key="row.id"
              class="border-b border-border transition-colors hover:bg-muted/30"
            >
              <td class="px-3 py-2.5 tabular-nums text-muted-foreground">{{ row.id }}</td>
              <td class="px-3 py-2.5">
                <div class="flex flex-col">
                  <span class="tabular-nums">{{ row.user_id }}</span>
                  <span class="truncate text-xs text-muted-foreground">{{ row.referrer_nickname || '-' }}</span>
                </div>
              </td>
              <td class="px-3 py-2.5 font-mono text-xs text-muted-foreground">{{ row.out_trade_no || '-' }}</td>
              <td class="px-3 py-2.5">{{ productTypeLabel(row.product_type) }}</td>
              <td class="px-3 py-2.5 tabular-nums">{{ formatMoney(row.order_amount) }}</td>
              <td class="px-3 py-2.5 tabular-nums">{{ formatRate(row.final_rate) }}</td>
              <td class="px-3 py-2.5 tabular-nums font-medium">{{ formatMoney(row.commission_amount) }}</td>
              <td class="px-3 py-2.5">
                <Badge :variant="statusBadgeVariant(row.status)">{{ statusLabel(row.status) }}</Badge>
              </td>
              <td class="px-3 py-2.5 tabular-nums text-muted-foreground">{{ formatDate(row.created_at) }}</td>
            </tr>
            <tr v-if="items.length === 0 && !loading">
              <td colspan="9" class="px-3 py-12 text-center text-muted-foreground">
                暂无佣金记录
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
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { AlertCircle, Loader2 } from 'lucide-vue-next'
import axios from '@/utils/axios'
import { showPageSuccess } from '@/utils/appMessage'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const loading = ref(false)
const settling = ref(false)
const listError = ref('')
const items = ref([])
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(20)
const filterStatus = ref('')
const filterUserId = ref('')
const filterOutTradeNo = ref('')

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value) || 1))

function productTypeLabel(type) {
  const map = { right: '版权实物', artwork: '原作', digital: '数字艺术品' }
  return map[type] || type || '-'
}

function statusLabel(status) {
  const map = {
    pending: '待结算',
    settlable: '可提现',
    withdrawn: '已提现',
    cancelled: '已取消',
  }
  return map[status] || status || '-'
}

function statusBadgeVariant(status) {
  if (status === 'settlable') return 'default'
  if (status === 'pending') return 'secondary'
  if (status === 'cancelled') return 'destructive'
  return 'outline'
}

function formatMoney(value) {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

function formatRate(value) {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return '-'
  return `${(n * 100).toFixed(2)}%`
}

function formatDate(value) {
  if (!value) return '-'
  return String(value).replace('T', ' ').slice(0, 19)
}

async function loadCommissions() {
  try {
    loading.value = true
    listError.value = ''
    const params = {
      page: currentPage.value,
      pageSize: pageSize.value,
    }
    if (filterStatus.value) params.status = filterStatus.value
    if (filterUserId.value) params.user_id = filterUserId.value
    if (filterOutTradeNo.value.trim()) params.out_trade_no = filterOutTradeNo.value.trim()

    const response = await axios.get('/admin/referral/commissions', { params })
    items.value = response.items || []
    total.value = Number(response.total || 0)
  } catch (error) {
    console.error('加载佣金明细失败:', error)
    items.value = []
    total.value = 0
    listError.value = '加载佣金明细失败，请检查网络或稍后重试'
  } finally {
    loading.value = false
  }
}

function handleFilterChange() {
  currentPage.value = 1
  loadCommissions()
}

function handlePageChange(page) {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
  loadCommissions()
}

async function handleSettleRun() {
  if (settling.value) return
  settling.value = true
  try {
    const response = await axios.post('/admin/referral/commissions/settle-run', { limit: 100 })
    showPageSuccess(`结算扫描完成：处理 ${response.settled || 0} 条，扫描 ${response.scanned || 0} 条`)
    await loadCommissions()
  } catch (error) {
    console.error('执行结算扫描失败:', error)
    listError.value = '执行结算扫描失败'
  } finally {
    settling.value = false
  }
}

onMounted(() => {
  loadCommissions()
})
</script>
