<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <h2 class="text-xl font-semibold tracking-tight text-foreground">艺术顾问申请</h2>
      <select
        v-model="filterStatus"
        class="flex h-9 w-full max-w-[10rem] rounded-md border border-input bg-background px-3 py-1 text-sm"
        @change="loadItems"
      >
        <option value="">全部</option>
        <option value="pending">待审核</option>
        <option value="approved">已通过</option>
        <option value="rejected">已驳回</option>
      </select>
    </div>

    <Card class="relative overflow-hidden shadow-none ring-1">
      <CardContent class="overflow-x-auto p-0 sm:p-6">
        <table class="w-full min-w-[960px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="px-3 py-2 text-left">ID</th>
              <th class="px-3 py-2 text-left">用户</th>
              <th class="px-3 py-2 text-left">姓名/手机</th>
              <th class="px-3 py-2 text-left">公司/职业</th>
              <th class="px-3 py-2 text-left">状态</th>
              <th class="px-3 py-2 text-left">申请时间</th>
              <th class="px-3 py-2 text-left">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in items" :key="row.id" class="border-b border-border">
              <td class="px-3 py-2">{{ row.id }}</td>
              <td class="px-3 py-2">{{ row.user_id }} / {{ row.nickname || '-' }}</td>
              <td class="px-3 py-2">{{ row.real_name }} / {{ row.phone }}</td>
              <td class="px-3 py-2">{{ row.company_name }} · {{ row.profession }}</td>
              <td class="px-3 py-2">{{ statusLabel(row.status) }}</td>
              <td class="px-3 py-2">{{ formatDate(row.created_at) }}</td>
              <td class="px-3 py-2">
                <div v-if="row.status === 'pending'" class="flex items-center gap-2">
                  <Input
                    v-model="rateById[row.id]"
                    type="number"
                    step="0.01"
                    class="h-8 w-24"
                    placeholder="佣金率"
                  />
                  <Button size="sm" @click="handleApprove(row)">通过</Button>
                  <Button size="sm" variant="outline" @click="handleReject(row)">驳回</Button>
                </div>
                <span v-else-if="row.status === 'approved'" class="text-muted-foreground">
                  {{ formatRate(row.commission_rate) }}
                </span>
                <span v-else class="text-muted-foreground">{{ row.reject_reason || '-' }}</span>
              </td>
            </tr>
            <tr v-if="!items.length">
              <td colspan="7" class="px-3 py-12 text-center text-muted-foreground">暂无申请</td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import axios from '@/utils/axios'
import { showPageSuccess } from '@/utils/appMessage'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const items = ref([])
const filterStatus = ref('pending')
const rateById = reactive({})

function formatDate(value) {
  if (!value) return '-'
  return String(value).replace('T', ' ').slice(0, 19)
}

function formatRate(rate) {
  if (rate == null) return '-'
  return `${(Number(rate) * 100).toFixed(1)}%`
}

function statusLabel(status) {
  const map = {
    pending: '待审核',
    approved: '已通过',
    rejected: '已驳回',
  }
  return map[status] || status
}

async function loadItems() {
  const params = { page: 1, pageSize: 50 }
  if (filterStatus.value) params.status = filterStatus.value
  const response = await axios.get('/admin/referral/advisor-applications', { params })
  items.value = response.items || []
  const defaultRate = response.rate_range?.min || 0.15
  for (const row of items.value) {
    if (!rateById[row.id]) rateById[row.id] = String(defaultRate)
  }
}

async function handleApprove(row) {
  const rate = parseFloat(rateById[row.id])
  await axios.post(`/admin/referral/advisor-applications/${row.id}/approve`, {
    commission_rate: rate,
  })
  showPageSuccess('已通过并升级为艺术顾问')
  await loadItems()
}

async function handleReject(row) {
  const reason = window.prompt('驳回原因（可选）', '资料不符合要求')
  if (reason === null) return
  await axios.post(`/admin/referral/advisor-applications/${row.id}/reject`, { reason })
  showPageSuccess('已驳回')
  await loadItems()
}

onMounted(loadItems)
</script>
