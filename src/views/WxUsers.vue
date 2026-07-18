<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 class="text-xl font-semibold tracking-tight text-foreground">小程序用户管理</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          搜索用户并可永久注销账号，清除订单、推荐、钱包等全部关联数据。
        </p>
      </div>
      <div class="flex w-full max-w-md gap-2">
        <Input
          v-model="keyword"
          placeholder="用户 ID / 昵称 / 手机 / OpenID"
          class="h-9"
          @keydown.enter="handleSearch"
        />
        <Button type="button" class="shrink-0" @click="handleSearch">搜索</Button>
      </div>
    </div>

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
              <th class="px-3 py-2 text-left">ID</th>
              <th class="px-3 py-2 text-left">昵称</th>
              <th class="px-3 py-2 text-left">手机</th>
              <th class="px-3 py-2 text-left">等级</th>
              <th class="px-3 py-2 text-left">累计消费</th>
              <th class="px-3 py-2 text-left">注册时间</th>
              <th class="px-3 py-2 text-left">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in items" :key="row.id" class="border-b border-border">
              <td class="px-3 py-2">{{ row.id }}</td>
              <td class="px-3 py-2">{{ row.nickname || '-' }}</td>
              <td class="px-3 py-2">{{ row.phone || '-' }}</td>
              <td class="px-3 py-2">{{ tierLabel(row.user_tier) }}</td>
              <td class="px-3 py-2">¥{{ formatMoney(row.total_spent) }}</td>
              <td class="px-3 py-2">{{ formatDate(row.created_at) }}</td>
              <td class="px-3 py-2">
                <Button size="sm" variant="outline" @click="openDetail(row)">详情</Button>
                <Button
                  size="sm"
                  variant="destructive"
                  class="ml-2"
                  @click="openPurgeDialog(row)"
                >
                  注销
                </Button>
              </td>
            </tr>
            <tr v-if="!items.length && !loading">
              <td colspan="7" class="px-3 py-12 text-center text-muted-foreground">暂无用户</td>
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
            :disabled="currentPage <= 1 || loading"
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
            :disabled="currentPage >= totalPages || loading"
            @click="handlePageChange(currentPage + 1)"
          >
            下一页
          </Button>
        </div>
      </CardContent>
    </Card>

    <Dialog v-model:open="detailOpen">
      <DialogContent class="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>用户详情</DialogTitle>
          <DialogDescription v-if="detail?.user">
            ID {{ detail.user.id }} · {{ detail.user.nickname || '未设置昵称' }}
          </DialogDescription>
        </DialogHeader>
        <div v-if="detail?.user" class="space-y-4 text-sm">
          <div class="space-y-2">
            <p><span class="text-muted-foreground">OpenID：</span>{{ detail.user.openid }}</p>
            <p><span class="text-muted-foreground">手机：</span>{{ detail.user.phone || '-' }}</p>
            <p><span class="text-muted-foreground">等级：</span>{{ tierLabel(detail.user.user_tier) }}</p>
            <p><span class="text-muted-foreground">注册：</span>{{ formatDate(detail.user.created_at) }}</p>
          </div>

          <div class="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/30 p-3">
            <p>订单 {{ detail.stats?.order_count ?? 0 }}</p>
            <p>作为推荐人订单 {{ detail.stats?.referred_order_count ?? 0 }}</p>
            <p>推荐绑定 {{ detail.stats?.binding_count ?? 0 }}</p>
            <p>佣金记录 {{ detail.stats?.commission_count ?? 0 }}</p>
            <p>提现记录 {{ detail.stats?.withdrawal_count ?? 0 }}</p>
            <p>优惠券 {{ detail.stats?.coupon_count ?? 0 }}</p>
            <p>收藏 {{ detail.stats?.favorite_count ?? 0 }}</p>
            <p>购物车 {{ detail.stats?.cart_count ?? 0 }}</p>
          </div>

          <div class="space-y-3 rounded-md border border-border p-3">
            <h4 class="font-medium text-foreground">推荐绑定关系</h4>

            <div>
              <p class="mb-1.5 text-xs text-muted-foreground">上级推荐人（我绑定的人）</p>
              <div
                v-if="detail.referral?.referrer"
                class="rounded-md border border-border bg-muted/20 p-2.5"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-medium">
                    {{ detail.referral.referrer.nickname || '未命名' }}
                  </span>
                  <span class="text-muted-foreground tabular-nums">
                    #{{ detail.referral.referrer.user_id }}
                  </span>
                  <span class="text-xs text-muted-foreground">
                    {{ tierLabel(detail.referral.referrer.user_tier) }}
                  </span>
                  <span
                    class="rounded px-1.5 py-0.5 text-xs"
                    :class="detail.referral.referrer.is_expired
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-primary/10 text-primary'"
                  >
                    {{ detail.referral.referrer.is_expired ? '已失效' : '永久有效' }}
                  </span>
                </div>
                <div class="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  <p>手机 {{ detail.referral.referrer.phone || '-' }}</p>
                  <p>来源 {{ bindSourceLabel(detail.referral.referrer.source) }}</p>
                  <p>绑定 {{ formatDate(detail.referral.referrer.bound_at) }}</p>
                  <p>有效期 永久</p>
                </div>
              </div>
              <p v-else class="text-xs text-muted-foreground">暂无上级推荐人</p>
            </div>

            <div>
              <p class="mb-1.5 text-xs text-muted-foreground">
                下级被推荐人（绑定我的人）
                <span v-if="detail.referral?.referee_total != null" class="tabular-nums">
                  · 共 {{ detail.referral.referee_total }} 人
                </span>
              </p>
              <div
                v-if="detail.referral?.referees?.length"
                class="max-h-48 space-y-2 overflow-y-auto"
              >
                <div
                  v-for="row in detail.referral.referees"
                  :key="row.binding_id || row.user_id"
                  class="rounded-md border border-border bg-muted/20 p-2.5"
                >
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-medium">{{ row.nickname || '未命名' }}</span>
                    <span class="text-muted-foreground tabular-nums">#{{ row.user_id }}</span>
                    <span class="text-xs text-muted-foreground">{{ tierLabel(row.user_tier) }}</span>
                    <span
                      class="rounded px-1.5 py-0.5 text-xs"
                      :class="row.is_expired
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-primary/10 text-primary'"
                    >
                      {{ row.is_expired ? '已失效' : '永久有效' }}
                    </span>
                  </div>
                  <div class="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    <p>手机 {{ row.phone || '-' }}</p>
                    <p>
                      来源 {{ bindSourceLabel(row.source) }}
                      · 绑定 {{ formatDate(row.bound_at) }}
                      · 永久有效
                    </p>
                  </div>
                </div>
                <p
                  v-if="detail.referral?.referee_truncated"
                  class="text-xs text-muted-foreground"
                >
                  仅展示最近 100 条下级绑定
                </p>
              </div>
              <p v-else class="text-xs text-muted-foreground">暂无下级被推荐人</p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" @click="detailOpen = false">关闭</Button>
          <Button
            v-if="detail?.user"
            type="button"
            variant="destructive"
            @click="openPurgeDialog(detail.user)"
          >
            注销此用户
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog v-model:open="purgeOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>永久注销用户</AlertDialogTitle>
          <AlertDialogDescription>
            将删除用户「{{ purgeTarget?.nickname || purgeTarget?.id }}」的全部数据，包括订单、钱包、推荐关系、收藏与地址等。此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div class="space-y-3 py-2">
          <div>
            <label class="mb-1 block text-sm text-muted-foreground">再次输入用户 ID</label>
            <Input v-model="confirmUserId" type="number" placeholder="用户 ID" />
          </div>
          <div>
            <label class="mb-1 block text-sm text-muted-foreground">
              输入确认短语「{{ purgePhrase }}」
            </label>
            <Input v-model="confirmPhrase" :placeholder="purgePhrase" />
          </div>
        </div>
        <AlertDialogFooter class="gap-2 sm:justify-end">
          <AlertDialogCancel type="button" @click="resetPurgeForm">取消</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            :disabled="purging"
            @click="handlePurge"
          >
            <Loader2 v-if="purging" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            确认注销
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Loader2 } from 'lucide-vue-next'
import axios from '@/utils/axios'
import { showPageSuccess } from '@/utils/appMessage'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

const PURGE_PHRASE = '确认注销'

const items = ref([])
const keyword = ref('')
const loading = ref(false)
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(20)
const detailOpen = ref(false)
const detail = ref(null)
const purgeOpen = ref(false)
const purgeTarget = ref(null)
const confirmUserId = ref('')
const confirmPhrase = ref('')
const purging = ref(false)
const purgePhrase = PURGE_PHRASE

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value) || 1))

const tierMap = {
  normal: '普通用户',
  recommender: '推荐官',
  vip_collector: 'VIP 收藏家',
  art_advisor: '艺术顾问',
}

function tierLabel(tier) {
  return tierMap[tier] || tier || '-'
}

function bindSourceLabel(source) {
  const map = {
    link: '链接',
    code: '推荐码',
    poster: '海报',
  }
  return map[source] || source || '-'
}

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN')
}

function formatMoney(value) {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

async function loadItems() {
  loading.value = true
  try {
    const response = await axios.get('/admin/wx-users', {
      params: {
        page: currentPage.value,
        pageSize: pageSize.value,
        keyword: keyword.value.trim() || undefined,
      },
    })
    items.value = response.items || []
    total.value = Number(response.total || 0)
    if (response.page) currentPage.value = Number(response.page) || currentPage.value
    if (response.pageSize) pageSize.value = Number(response.pageSize) || pageSize.value
  } catch (error) {
    console.error('加载小程序用户失败:', error)
    items.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  currentPage.value = 1
  loadItems()
}

function handlePageChange(page) {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
  loadItems()
}

async function openDetail(row) {
  const response = await axios.get(`/admin/wx-users/${row.id}`)
  detail.value = response
  detailOpen.value = true
}

function resetPurgeForm() {
  confirmUserId.value = ''
  confirmPhrase.value = ''
  purgeTarget.value = null
}

function openPurgeDialog(row) {
  purgeTarget.value = row
  confirmUserId.value = String(row.id)
  confirmPhrase.value = ''
  purgeOpen.value = true
  detailOpen.value = false
}

async function handlePurge() {
  if (!purgeTarget.value) return
  purging.value = true
  try {
    await axios.post(`/admin/wx-users/${purgeTarget.value.id}/purge`, {
      confirm_user_id: confirmUserId.value,
      confirm_phrase: confirmPhrase.value,
    })
    showPageSuccess('用户已注销，关联数据已清除')
    purgeOpen.value = false
    resetPurgeForm()
    detail.value = null
    await loadItems()
  } catch (error) {
    const message = error?.response?.data?.error || '注销失败'
    ElMessage.error(message)
  } finally {
    purging.value = false
  }
}

onMounted(() => {
  loadItems()
})
</script>
