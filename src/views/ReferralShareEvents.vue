<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <h2 class="text-xl font-semibold tracking-tight text-foreground">
        分享记录
      </h2>
      <div class="flex flex-wrap items-end gap-3">
        <div class="flex w-full max-w-[10rem] flex-col gap-2 sm:w-auto">
          <Label for="share-filter-user" class="text-muted-foreground">用户 ID</Label>
          <Input
            id="share-filter-user"
            v-model="filterUserId"
            type="number"
            placeholder="用户 ID"
            class="h-9"
            @keydown.enter="handleFilterChange"
          />
        </div>
        <div class="flex w-full max-w-[10rem] flex-col gap-2 sm:w-auto">
          <Label for="share-filter-type" class="text-muted-foreground">作品类型</Label>
          <select
            id="share-filter-type"
            v-model="filterItemType"
            class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            @change="handleFilterChange"
          >
            <option value="">全部</option>
            <option value="right">版权实物</option>
            <option value="artwork">原作</option>
            <option value="digital">数字艺术品</option>
          </select>
        </div>
        <div class="flex w-full max-w-[10rem] flex-col gap-2 sm:w-auto">
          <Label for="share-filter-channel" class="text-muted-foreground">渠道</Label>
          <select
            id="share-filter-channel"
            v-model="filterChannel"
            class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            @change="handleFilterChange"
          >
            <option value="">全部</option>
            <option value="miniprogram">小程序</option>
            <option value="link">链接</option>
            <option value="poster">海报</option>
          </select>
        </div>
        <Button type="button" variant="secondary" class="h-9" @click="handleFilterChange">
          查询
        </Button>
      </div>
    </div>

    <Alert v-if="listError && !loading" variant="destructive">
      <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
      <AlertTitle>{{ listError }}</AlertTitle>
      <AlertDescription class="mt-2">
        <Button type="button" variant="secondary" size="sm" @click="loadShareEvents">
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
        <table class="w-full min-w-[800px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40 text-left text-muted-foreground">
              <th class="px-3 py-2.5 font-medium">ID</th>
              <th class="px-3 py-2.5 font-medium">用户</th>
              <th class="px-3 py-2.5 font-medium">作品类型</th>
              <th class="px-3 py-2.5 font-medium">作品 ID</th>
              <th class="px-3 py-2.5 font-medium">渠道</th>
              <th class="px-3 py-2.5 font-medium">时间</th>
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
                {{ row.user_nickname || `用户 #${row.user_id}` }}
              </td>
              <td class="px-3 py-2.5 text-muted-foreground">{{ itemTypeLabel(row.item_type) }}</td>
              <td class="max-w-[12rem] truncate px-3 py-2.5" :title="row.item_id">{{ row.item_id }}</td>
              <td class="px-3 py-2.5 text-muted-foreground">{{ channelLabel(row.channel) }}</td>
              <td class="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{{ formatDate(row.created_at) }}</td>
            </tr>
            <tr v-if="items.length === 0 && !loading">
              <td colspan="6" class="px-3 py-10 text-center text-muted-foreground">
                暂无分享记录
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
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { AlertCircle, Loader2 } from 'lucide-vue-next'
import axios from '../utils/axios'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const items = ref([])
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const listError = ref('')
const filterUserId = ref('')
const filterItemType = ref('')
const filterChannel = ref('')

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value) || 1))

function itemTypeLabel(type) {
  const map = { right: '版权实物', artwork: '原作', digital: '数字艺术品' }
  return map[type] || type || '-'
}

function channelLabel(channel) {
  const map = { link: '链接', poster: '海报', miniprogram: '小程序' }
  return map[channel] || channel || '-'
}

function formatDate(value) {
  if (!value) return '-'
  return String(value).replace('T', ' ').slice(0, 19)
}

async function loadShareEvents() {
  try {
    loading.value = true
    listError.value = ''
    const params = {
      page: currentPage.value,
      pageSize: pageSize.value,
    }
    if (filterUserId.value) params.user_id = filterUserId.value
    if (filterItemType.value) params.item_type = filterItemType.value
    if (filterChannel.value) params.channel = filterChannel.value

    const response = await axios.get('/admin/referral/share-events', { params })
    items.value = response.items || []
    total.value = Number(response.total || 0)
  } catch (error) {
    console.error('加载分享记录失败:', error)
    items.value = []
    total.value = 0
    listError.value = '加载分享记录失败，请检查网络或稍后重试'
  } finally {
    loading.value = false
  }
}

function handleFilterChange() {
  currentPage.value = 1
  loadShareEvents()
}

function handlePageChange(page) {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
  loadShareEvents()
}

onMounted(() => {
  loadShareEvents()
})
</script>
