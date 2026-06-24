<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 class="text-xl font-semibold tracking-tight text-foreground">
          佣金比例规则
        </h2>
        <p class="text-sm text-muted-foreground">
          按品类与价格带配置基础佣金比例；VIP 收藏家额外 +2%，艺术顾问使用独立审批比例。
        </p>
      </div>
      <Button type="button" variant="outline" :disabled="loading" @click="loadRules">
        刷新
      </Button>
    </div>

    <Alert v-if="listError && !loading" variant="destructive">
      <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
      <AlertTitle>{{ listError }}</AlertTitle>
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
        <table class="w-full min-w-[900px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="h-10 w-16 px-3 text-left font-medium">ID</th>
              <th class="h-10 w-28 px-3 text-left font-medium">品类</th>
              <th class="h-10 w-28 px-3 text-left font-medium">最低价</th>
              <th class="h-10 w-28 px-3 text-left font-medium">最高价</th>
              <th class="h-10 w-32 px-3 text-left font-medium">基础比例</th>
              <th class="h-10 w-28 px-3 text-left font-medium">结算天数</th>
              <th class="h-10 w-24 px-3 text-left font-medium">启用</th>
              <th class="h-10 w-28 px-3 text-left font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rules"
              :key="row.id"
              class="border-b border-border transition-colors hover:bg-muted/30"
            >
              <td class="px-3 py-2.5 tabular-nums text-muted-foreground">{{ row.id }}</td>
              <td class="px-3 py-2.5">{{ productTypeLabel(row.product_type) }}</td>
              <td class="px-3 py-2.5 tabular-nums">{{ formatMoney(row.min_price) }}</td>
              <td class="px-3 py-2.5 tabular-nums">{{ row.max_price == null ? '无上限' : formatMoney(row.max_price) }}</td>
              <td class="px-3 py-2.5">
                <Input
                  v-model="editState[row.id].base_rate_percent"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  class="h-8 w-24"
                />
              </td>
              <td class="px-3 py-2.5">
                <Input
                  v-model="editState[row.id].settlement_days"
                  type="number"
                  min="0"
                  max="90"
                  class="h-8 w-20"
                />
              </td>
              <td class="px-3 py-2.5">
                <input
                  v-model="editState[row.id].is_active"
                  type="checkbox"
                  class="size-4 rounded border-input"
                  :aria-label="`规则 ${row.id} 启用状态`"
                >
              </td>
              <td class="px-3 py-2.5">
                <Button
                  size="sm"
                  type="button"
                  :disabled="savingId === row.id"
                  @click="handleSave(row)"
                >
                  <Loader2 v-if="savingId === row.id" class="mr-1 size-3 animate-spin" aria-hidden="true" />
                  保存
                </Button>
              </td>
            </tr>
            <tr v-if="rules.length === 0 && !loading">
              <td colspan="8" class="px-3 py-12 text-center text-muted-foreground">
                暂无规则
              </td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { AlertCircle, Loader2 } from 'lucide-vue-next'
import axios from '@/utils/axios'
import { showPageSuccess } from '@/utils/appMessage'
import { Alert, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const loading = ref(false)
const listError = ref('')
const rules = ref([])
const editState = reactive({})
const savingId = ref(null)

function productTypeLabel(type) {
  const map = { right: '版权实物', artwork: '原作', digital: '数字艺术品' }
  return map[type] || type || '-'
}

function formatMoney(value) {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

function syncEditState(items) {
  for (const key of Object.keys(editState)) {
    delete editState[key]
  }
  for (const row of items) {
    editState[row.id] = {
      base_rate_percent: String((parseFloat(row.base_rate) * 100).toFixed(2)),
      settlement_days: String(row.settlement_days),
      is_active: row.is_active === 1 || row.is_active === true,
    }
  }
}

async function loadRules() {
  try {
    loading.value = true
    listError.value = ''
    const response = await axios.get('/admin/referral/commission-rules')
    rules.value = response.items || []
    syncEditState(rules.value)
  } catch (error) {
    console.error('加载佣金规则失败:', error)
    rules.value = []
    listError.value = '加载佣金规则失败'
  } finally {
    loading.value = false
  }
}

async function handleSave(row) {
  const state = editState[row.id]
  if (!state) return

  const baseRatePercent = parseFloat(state.base_rate_percent)
  const settlementDays = parseInt(state.settlement_days, 10)
  if (!Number.isFinite(baseRatePercent) || baseRatePercent <= 0 || baseRatePercent > 100) {
    listError.value = '基础比例需在 0~100 之间'
    return
  }
  if (!Number.isFinite(settlementDays) || settlementDays < 0 || settlementDays > 90) {
    listError.value = '结算天数需在 0~90 之间'
    return
  }

  savingId.value = row.id
  listError.value = ''
  try {
    await axios.put(`/admin/referral/commission-rules/${row.id}`, {
      base_rate: baseRatePercent / 100,
      settlement_days: settlementDays,
      is_active: state.is_active,
    })
    showPageSuccess('规则已更新')
    await loadRules()
  } catch (error) {
    console.error('更新佣金规则失败:', error)
    listError.value = '更新佣金规则失败'
  } finally {
    savingId.value = null
  }
}

onMounted(() => {
  loadRules()
})
</script>
