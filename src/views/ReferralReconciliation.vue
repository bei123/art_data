<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 class="text-xl font-semibold tracking-tight text-foreground">
          推荐对账日志
        </h2>
        <p class="mt-1 text-sm text-muted-foreground">
          每日自动比对钱包余额、佣金台账与成功订单，发现异常会记录在此。
        </p>
      </div>
      <Button
        type="button"
        class="h-9 shrink-0"
        :disabled="running"
        @click="handleRunReconciliation"
      >
        <Loader2 v-if="running" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
        立即对账
      </Button>
    </div>

    <Alert v-if="listError && !loading" variant="destructive">
      <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
      <AlertTitle>{{ listError }}</AlertTitle>
      <AlertDescription class="mt-2">
        <Button type="button" variant="secondary" size="sm" @click="loadLogs">
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
        <table class="w-full min-w-[720px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40 text-left text-muted-foreground">
              <th class="px-3 py-2.5 font-medium">ID</th>
              <th class="px-3 py-2.5 font-medium">状态</th>
              <th class="px-3 py-2.5 font-medium">异常数</th>
              <th class="px-3 py-2.5 font-medium">活跃推荐官</th>
              <th class="px-3 py-2.5 font-medium">累计分享</th>
              <th class="px-3 py-2.5 font-medium">时间</th>
              <th class="px-3 py-2.5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in items"
              :key="row.id"
              class="border-b border-border transition-colors last:border-b-0 hover:bg-muted/30"
            >
              <td class="px-3 py-2.5 tabular-nums">{{ row.id }}</td>
              <td class="px-3 py-2.5">
                <Badge :variant="row.status === 'ok' ? 'default' : 'destructive'">
                  {{ row.status === 'ok' ? '正常' : '有异常' }}
                </Badge>
              </td>
              <td class="px-3 py-2.5 tabular-nums">{{ row.issue_count }}</td>
              <td class="px-3 py-2.5 tabular-nums">{{ row.stats?.active_referrers ?? '-' }}</td>
              <td class="px-3 py-2.5 tabular-nums">{{ row.stats?.total_shares ?? '-' }}</td>
              <td class="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{{ formatDate(row.created_at) }}</td>
              <td class="px-3 py-2.5">
                <Button type="button" variant="link" class="h-auto px-0" @click="openDetail(row)">
                  详情
                </Button>
              </td>
            </tr>
            <tr v-if="items.length === 0 && !loading">
              <td colspan="7" class="px-3 py-10 text-center text-muted-foreground">
                暂无对账记录
              </td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>

    <div v-if="totalPages > 1" class="flex items-center justify-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        :disabled="currentPage <= 1 || loading"
        @click="handlePageChange(currentPage - 1)"
      >
        上一页
      </Button>
      <span class="text-sm text-muted-foreground">
        第 {{ currentPage }} / {{ totalPages }} 页，共 {{ total }} 条
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        :disabled="currentPage >= totalPages || loading"
        @click="handlePageChange(currentPage + 1)"
      >
        下一页
      </Button>
    </div>

    <Dialog :open="detailOpen" @update:open="detailOpen = $event">
      <DialogContent class="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>对账详情 #{{ detailRow?.id }}</DialogTitle>
          <DialogDescription>
            {{ formatDate(detailRow?.created_at) }}
          </DialogDescription>
        </DialogHeader>

        <div v-if="detailRow" class="flex flex-col gap-4 text-sm">
          <div class="grid grid-cols-2 gap-3 rounded-md border border-border p-3">
            <div>
              <span class="text-muted-foreground">状态：</span>
              {{ detailRow.status === 'ok' ? '正常' : '有异常' }}
            </div>
            <div>
              <span class="text-muted-foreground">异常数：</span>
              {{ detailRow.issue_count }}
            </div>
            <div>
              <span class="text-muted-foreground">活跃推荐官：</span>
              {{ detailRow.stats?.active_referrers ?? 0 }}
            </div>
            <div>
              <span class="text-muted-foreground">累计分享：</span>
              {{ detailRow.stats?.total_shares ?? 0 }}
            </div>
          </div>

          <div v-if="Array.isArray(detailRow.issues) && detailRow.issues.length">
            <h4 class="mb-2 font-medium text-foreground">异常明细</h4>
            <pre class="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">{{ JSON.stringify(detailRow.issues, null, 2) }}</pre>
          </div>
          <p v-else class="text-muted-foreground">未发现异常项。</p>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { AlertCircle, Loader2 } from 'lucide-vue-next'
import axios from '../utils/axios'
import { showPageSuccess } from '@/utils/appMessage'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const items = ref([])
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const running = ref(false)
const listError = ref('')
const detailOpen = ref(false)
const detailRow = ref(null)

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value) || 1))

function formatDate(value) {
  if (!value) return '-'
  return String(value).replace('T', ' ').slice(0, 19)
}

async function loadLogs() {
  try {
    loading.value = true
    listError.value = ''
    const response = await axios.get('/admin/referral/reconciliation/logs', {
      params: { page: currentPage.value, pageSize: pageSize.value },
    })
    items.value = response.items || []
    total.value = Number(response.total || 0)
  } catch (error) {
    console.error('加载对账日志失败:', error)
    items.value = []
    total.value = 0
    listError.value = '加载对账日志失败，请检查网络或稍后重试'
  } finally {
    loading.value = false
  }
}

function handlePageChange(page) {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
  loadLogs()
}

function openDetail(row) {
  detailRow.value = row
  detailOpen.value = true
}

async function handleRunReconciliation() {
  if (running.value) return
  running.value = true
  try {
    const response = await axios.post('/admin/referral/reconciliation/run')
    const issueCount = Number(response.issue_count || 0)
    if (issueCount === 0) {
      showPageSuccess('对账完成，未发现异常')
    } else {
      showPageSuccess(`对账完成，发现 ${issueCount} 项异常`)
    }
    currentPage.value = 1
    await loadLogs()
  } catch (error) {
    console.error('执行对账失败:', error)
    listError.value = '执行对账失败'
  } finally {
    running.value = false
  }
}

onMounted(() => {
  loadLogs()
})
</script>
