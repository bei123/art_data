<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <h2 class="text-xl font-semibold tracking-tight text-foreground">微信免充值代金券</h2>
    <p class="text-sm text-muted-foreground">
      创建模板将调用微信支付营销 API 制券并激活（免充值）。发放与新人欢迎券均走微信侧；结账时由微信支付自动核销。
    </p>

    <Card class="shadow-none ring-1">
      <CardContent class="flex flex-col gap-4 py-6">
        <h3 class="text-sm font-medium">新建批次模板</h3>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input v-model="form.title" placeholder="优惠券名称（最多9字）" />
          <Input v-model="form.discount_yuan" type="number" placeholder="优惠金额(元)" />
          <Input v-model="form.min_order_yuan" type="number" placeholder="最低订单(元)" />
          <Input v-model="form.valid_days" type="number" placeholder="有效天数(≤90)" />
          <Input v-model="form.max_coupons" type="number" placeholder="发放总上限(最少5)" />
          <label class="flex items-center gap-2 text-sm">
            <input v-model="form.is_welcome" type="checkbox" class="size-4" />
            设为新人欢迎券模板
          </label>
        </div>
        <Button class="w-fit" :disabled="creating" @click="handleCreateTemplate">
          {{ creating ? '创建中…' : '创建并激活' }}
        </Button>
      </CardContent>
    </Card>

    <Card class="shadow-none ring-1">
      <CardContent class="flex flex-col gap-4 py-6">
        <h3 class="text-sm font-medium">发放代金券</h3>
        <p class="text-xs text-muted-foreground leading-relaxed">
          从用户列表勾选发放，或一键发放给全部已绑定微信 openid 的用户。
        </p>
        <div class="flex flex-col gap-2 sm:max-w-md">
          <label class="text-xs text-muted-foreground">优惠券模板</label>
          <select
            v-model="grantTemplateId"
            class="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          >
            <option value="">选择已激活模板</option>
            <option
              v-for="tpl in runningTemplates"
              :key="tpl.id"
              :value="String(tpl.id)"
            >
              {{ tpl.title }} · {{ tpl.discount_yuan }}元 · {{ tpl.stock_id }}
            </option>
          </select>
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-xs text-muted-foreground">
              已选 {{ selectedGrantUsers.length }} 人
            </span>
            <div class="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" @click="openUserPicker">
                选择用户
              </Button>
              <Button
                v-if="selectedGrantUsers.length"
                type="button"
                size="sm"
                variant="ghost"
                @click="clearSelectedGrantUsers"
              >
                清空
              </Button>
            </div>
          </div>
          <div
            v-if="selectedGrantUsers.length"
            class="flex max-h-36 flex-wrap gap-2 overflow-y-auto rounded-md border border-border bg-muted/20 p-2"
          >
            <button
              v-for="user in selectedGrantUsers"
              :key="user.id"
              type="button"
              class="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-muted"
              :aria-label="`移除用户 ${user.id}`"
              @click="removeSelectedGrantUser(user.id)"
            >
              <span class="font-medium">{{ user.nickname || '未命名' }}</span>
              <span class="text-muted-foreground">#{{ user.id }}</span>
              <span class="text-muted-foreground" aria-hidden="true">×</span>
            </button>
          </div>
          <p v-else class="text-xs text-muted-foreground">尚未选择用户，请点击「选择用户」</p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            :disabled="batchGranting || !selectedGrantUsers.length"
            @click="handleGrantSelected"
          >
            {{ batchGranting && !grantingAll ? '发放中…' : '发放给已选用户' }}
          </Button>
          <Button
            type="button"
            variant="secondary"
            :disabled="batchGranting"
            @click="openGrantAllConfirm"
          >
            发放给全部用户
          </Button>
          <span v-if="batchGrantSummary" class="text-sm text-muted-foreground">
            {{ batchGrantSummary }}
          </span>
        </div>
        <div
          v-if="batchGrantFailures.length"
          class="rounded-md border border-border bg-muted/20 p-3 text-xs"
        >
          <div class="mb-2 font-medium text-foreground">失败明细（最多展示 50 条）</div>
          <ul class="space-y-1 font-mono text-muted-foreground">
            <li v-for="item in batchGrantFailures.slice(0, 50)" :key="item.user_id">
              用户 {{ item.user_id }}：{{ item.error || '失败' }}
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>

    <Dialog v-model:open="userPickerOpen">
      <DialogContent class="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>选择用户</DialogTitle>
          <DialogDescription>
            搜索并勾选要发放代金券的用户，确认后加入已选列表。
          </DialogDescription>
        </DialogHeader>
        <div class="flex flex-col gap-3">
          <div class="flex gap-2">
            <Input
              v-model="userPickerKeyword"
              placeholder="用户 ID / 昵称 / 手机 / OpenID"
              class="h-9"
              @keydown.enter="searchPickerUsers"
            />
            <Button type="button" class="shrink-0" :disabled="userPickerLoading" @click="searchPickerUsers">
              搜索
            </Button>
          </div>
          <div class="max-h-[42vh] overflow-auto rounded-md border border-border">
            <table class="w-full text-sm">
              <thead class="sticky top-0 bg-muted/80 backdrop-blur">
                <tr class="border-b border-border">
                  <th class="w-10 px-3 py-2 text-left" />
                  <th class="px-3 py-2 text-left">ID</th>
                  <th class="px-3 py-2 text-left">昵称</th>
                  <th class="px-3 py-2 text-left">手机</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in userPickerItems"
                  :key="row.id"
                  class="border-b border-border hover:bg-muted/30"
                >
                  <td class="px-3 py-2">
                    <Checkbox
                      :model-value="pickerDraftSelected.has(row.id)"
                      @update:model-value="(v) => togglePickerUser(row, v === true)"
                    />
                  </td>
                  <td class="px-3 py-2 tabular-nums">{{ row.id }}</td>
                  <td class="px-3 py-2">{{ row.nickname || '-' }}</td>
                  <td class="px-3 py-2">{{ row.phone || '-' }}</td>
                </tr>
                <tr v-if="!userPickerItems.length && !userPickerLoading">
                  <td colspan="4" class="px-3 py-8 text-center text-muted-foreground">暂无用户</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>本页勾选草稿 {{ pickerDraftSelected.size }} · 共 {{ userPickerTotal }} 人</span>
            <div class="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                :disabled="userPickerPage <= 1 || userPickerLoading"
                @click="loadPickerUsers(userPickerPage - 1)"
              >
                上一页
              </Button>
              <span class="tabular-nums">{{ userPickerPage }} / {{ userPickerTotalPages }}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                :disabled="userPickerPage >= userPickerTotalPages || userPickerLoading"
                @click="loadPickerUsers(userPickerPage + 1)"
              >
                下一页
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter class="gap-2 sm:justify-end">
          <Button type="button" variant="outline" @click="userPickerOpen = false">取消</Button>
          <Button type="button" @click="confirmPickerSelection">
            加入已选（{{ pickerDraftSelected.size }}）
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="grantAllConfirmOpen">
      <DialogContent class="max-w-[calc(100%-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>发放给全部用户</DialogTitle>
          <DialogDescription>
            将向全部已绑定微信 openid 的用户发放所选批次代金券，耗时可能较长，请确认。
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-2 text-sm">
          <p>
            可发放用户约
            <span class="font-semibold tabular-nums">{{ grantEligibleCount ?? '…' }}</span>
            人
            <span v-if="grantAllMax" class="text-muted-foreground">（上限 {{ grantAllMax }}）</span>
          </p>
          <p class="text-muted-foreground">无 openid 的用户会自动跳过；每人单独调用微信发券接口。</p>
        </div>
        <DialogFooter class="gap-2 sm:justify-end">
          <Button type="button" variant="outline" @click="grantAllConfirmOpen = false">取消</Button>
          <Button type="button" :disabled="batchGranting" @click="handleGrantAll">
            {{ grantingAll ? '发放中…' : '确认发放全部' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Card class="shadow-none ring-1">
      <CardContent class="overflow-x-auto p-0 sm:p-6">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2 px-3 pt-4 sm:px-0 sm:pt-0">
          <h3 class="text-sm font-medium">批次模板</h3>
          <Button
            size="sm"
            variant="outline"
            :disabled="syncing"
            @click="handleSyncWx"
          >
            {{ syncing ? '同步中…' : '从微信同步状态' }}
          </Button>
          <Button
            size="sm"
            variant="outline"
            :disabled="loadingCallback"
            @click="handleQueryCallback"
          >
            {{ loadingCallback ? '查询中…' : '查询回调URL' }}
          </Button>
          <Button
            size="sm"
            variant="outline"
            :disabled="settingCallback"
            @click="handleSetCallback"
          >
            {{ settingCallback ? '设置中…' : '设置回调URL' }}
          </Button>
        </div>
        <table class="w-full min-w-[900px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="px-3 py-2 text-left">名称</th>
              <th class="px-3 py-2 text-left">金额</th>
              <th class="px-3 py-2 text-left">stock_id</th>
              <th class="px-3 py-2 text-left">状态</th>
              <th class="px-3 py-2 text-left">欢迎券</th>
              <th class="px-3 py-2 text-left">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tpl in templates" :key="tpl.id" class="border-b border-border">
              <td class="px-3 py-2">{{ tpl.title }}</td>
              <td class="px-3 py-2">{{ tpl.discount_yuan }} / 满{{ tpl.min_order_yuan }}</td>
              <td class="px-3 py-2 font-mono text-xs">{{ tpl.stock_id || '-' }}</td>
              <td class="px-3 py-2">{{ tpl.wx_status || '-' }}</td>
              <td class="px-3 py-2">{{ tpl.is_welcome ? '是' : '-' }}</td>
              <td class="px-3 py-2">
                <div class="flex flex-wrap gap-2">
                  <Button
                    v-if="tpl.stock_id && (!tpl.wx_status || tpl.wx_status === 'created')"
                    size="sm"
                    variant="outline"
                    :disabled="actionId === tpl.id"
                    @click="handleStart(tpl)"
                  >
                    {{ actionId === tpl.id ? '处理中…' : '激活' }}
                  </Button>
                  <Button
                    v-if="tpl.stock_id && tpl.wx_status === 'running'"
                    size="sm"
                    variant="outline"
                    :disabled="actionId === tpl.id"
                    @click="handlePause(tpl)"
                  >
                    {{ actionId === tpl.id ? '处理中…' : '暂停' }}
                  </Button>
                  <Button
                    v-if="tpl.stock_id && tpl.wx_status === 'paused'"
                    size="sm"
                    variant="outline"
                    :disabled="actionId === tpl.id"
                    @click="handleRestart(tpl)"
                  >
                    {{ actionId === tpl.id ? '处理中…' : '重启' }}
                  </Button>
                  <Button
                    v-if="tpl.stock_id"
                    size="sm"
                    variant="ghost"
                    :disabled="actionId === tpl.id"
                    @click="handleStockDetail(tpl)"
                  >
                    详情
                  </Button>
                  <span
                    v-if="!tpl.stock_id || (tpl.wx_status && !['created','running','paused'].includes(tpl.wx_status))"
                    class="text-muted-foreground"
                  >-</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>

    <Card class="shadow-none ring-1">
      <CardContent class="overflow-x-auto p-0 sm:p-6">
        <h3 class="mb-3 px-3 pt-4 text-sm font-medium sm:px-0 sm:pt-0">发放记录</h3>
        <table class="w-full min-w-[800px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="px-3 py-2 text-left">用户</th>
              <th class="px-3 py-2 text-left">模板</th>
              <th class="px-3 py-2 text-left">coupon_id</th>
              <th class="px-3 py-2 text-left">来源</th>
              <th class="px-3 py-2 text-left">状态</th>
              <th class="px-3 py-2 text-left">时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in coupons" :key="row.id" class="border-b border-border">
              <td class="px-3 py-2">{{ row.user_id }} / {{ row.nickname || '-' }}</td>
              <td class="px-3 py-2">{{ row.template_title || row.stock_id }}</td>
              <td class="px-3 py-2 font-mono text-xs">
                <button
                  v-if="row.coupon_id"
                  type="button"
                  class="underline-offset-2 hover:underline"
                  :disabled="detailGrantId === row.id"
                  @click="handleCouponDetail(row)"
                >
                  {{ detailGrantId === row.id ? '查询中…' : row.coupon_id }}
                </button>
                <span v-else>-</span>
              </td>
              <td class="px-3 py-2">{{ row.source }}</td>
              <td class="px-3 py-2">{{ row.status }}</td>
              <td class="px-3 py-2">{{ formatDate(row.created_at) }}</td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import axios from '@/utils/axios'
import { showPageSuccess, showPageWarning } from '@/utils/appMessage'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

const templates = ref([])
const coupons = ref([])
const creating = ref(false)
const batchGranting = ref(false)
const grantingAll = ref(false)
const batchGrantSummary = ref('')
const batchGrantFailures = ref([])
const grantTemplateId = ref('')
const selectedGrantUsers = ref([])
const actionId = ref(null)
const syncing = ref(false)
const loadingCallback = ref(false)
const settingCallback = ref(false)
const detailGrantId = ref(null)

const userPickerOpen = ref(false)
const userPickerLoading = ref(false)
const userPickerKeyword = ref('')
const userPickerItems = ref([])
const userPickerTotal = ref(0)
const userPickerPage = ref(1)
const userPickerPageSize = 20
const pickerDraftSelected = ref(new Set())
const pickerDraftMeta = ref(new Map())

const grantAllConfirmOpen = ref(false)
const grantEligibleCount = ref(null)
const grantAllMax = ref(null)

const form = reactive({
  title: '',
  discount_yuan: '',
  min_order_yuan: '0',
  valid_days: '30',
  max_coupons: '10000',
  is_welcome: false,
})

const runningTemplates = computed(() =>
  (templates.value || []).filter((t) => t.wx_status === 'running' && t.stock_id)
)

const userPickerTotalPages = computed(() =>
  Math.max(1, Math.ceil((userPickerTotal.value || 0) / userPickerPageSize))
)

function formatDate(v) {
  if (!v) return '-'
  try {
    return new Date(v).toLocaleString()
  } catch {
    return String(v)
  }
}

async function loadTemplates() {
  try {
    const data = await axios.get('/admin/referral/coupon-templates')
    templates.value = data?.items || []
  } catch (error) {
    console.error('加载代金券模板失败:', error)
    templates.value = []
  }
}

async function loadCoupons() {
  try {
    const data = await axios.get('/admin/referral/coupons', { params: { pageSize: 50 } })
    coupons.value = data?.items || []
  } catch (error) {
    console.error('加载发放记录失败:', error)
    coupons.value = []
  }
}

async function handleCreateTemplate() {
  creating.value = true
  try {
    const data = await axios.post('/admin/referral/coupon-templates', {
      title: form.title,
      discount_yuan: form.discount_yuan,
      min_order_yuan: form.min_order_yuan,
      valid_days: form.valid_days,
      max_coupons: form.max_coupons,
      is_welcome: form.is_welcome,
    })
    if (data?.start_error || data?.wx_status === 'created') {
      showPageSuccess('批次已创建，卡包同步中，请稍后点「激活」')
    } else {
      showPageSuccess('批次已创建并激活')
    }
    form.title = ''
    form.discount_yuan = ''
    await loadTemplates()
  } catch (error) {
    console.error('创建代金券模板失败:', error)
  } finally {
    creating.value = false
  }
}

function clearSelectedGrantUsers() {
  selectedGrantUsers.value = []
}

function removeSelectedGrantUser(userId) {
  selectedGrantUsers.value = selectedGrantUsers.value.filter((u) => u.id !== userId)
}

async function openUserPicker() {
  userPickerOpen.value = true
  userPickerKeyword.value = ''
  pickerDraftSelected.value = new Set(selectedGrantUsers.value.map((u) => u.id))
  pickerDraftMeta.value = new Map(
    selectedGrantUsers.value.map((u) => [u.id, { id: u.id, nickname: u.nickname, phone: u.phone }])
  )
  await loadPickerUsers(1)
}

async function searchPickerUsers() {
  await loadPickerUsers(1)
}

async function loadPickerUsers(page = 1) {
  userPickerLoading.value = true
  userPickerPage.value = page
  try {
    const data = await axios.get('/admin/wx-users', {
      params: {
        page,
        pageSize: userPickerPageSize,
        keyword: userPickerKeyword.value?.trim() || undefined,
      },
      timeout: 20000,
    })
    userPickerItems.value = Array.isArray(data?.items) ? data.items : []
    userPickerTotal.value = Number(data?.total || 0)
    for (const row of userPickerItems.value) {
      if (pickerDraftSelected.value.has(row.id)) {
        pickerDraftMeta.value.set(row.id, {
          id: row.id,
          nickname: row.nickname,
          phone: row.phone,
        })
      }
    }
  } catch (error) {
    console.error('加载用户列表失败:', error)
    userPickerItems.value = []
    userPickerTotal.value = 0
  } finally {
    userPickerLoading.value = false
  }
}

function togglePickerUser(row, checked) {
  const next = new Set(pickerDraftSelected.value)
  const meta = new Map(pickerDraftMeta.value)
  if (checked) {
    next.add(row.id)
    meta.set(row.id, { id: row.id, nickname: row.nickname, phone: row.phone })
  } else {
    next.delete(row.id)
    meta.delete(row.id)
  }
  pickerDraftSelected.value = next
  pickerDraftMeta.value = meta
}

function confirmPickerSelection() {
  const list = []
  for (const id of pickerDraftSelected.value) {
    const meta = pickerDraftMeta.value.get(id)
    list.push(meta || { id, nickname: null, phone: null })
  }
  list.sort((a, b) => a.id - b.id)
  selectedGrantUsers.value = list
  userPickerOpen.value = false
}

function applyGrantResult(data) {
  const total = Number(data?.total || 0)
  const okCount = Number(data?.success_count || 0)
  const failCount = Number(data?.failed_count || 0)
  batchGrantSummary.value = `完成：成功 ${okCount} / 失败 ${failCount}（共 ${total}）`
  batchGrantFailures.value = (Array.isArray(data?.results) ? data.results : [])
    .filter((row) => row && row.ok === false)

  if (failCount === 0) {
    showPageSuccess(`发放成功（${okCount}）`)
  } else if (okCount > 0) {
    showPageWarning(`部分成功：${okCount} 成功，${failCount} 失败`)
  } else {
    showPageWarning('发放全部失败，请查看明细')
  }
}

async function handleGrantSelected() {
  if (!grantTemplateId.value) {
    showPageWarning('请选择模板')
    return
  }
  if (!selectedGrantUsers.value.length) {
    showPageWarning('请先选择用户')
    return
  }

  batchGranting.value = true
  grantingAll.value = false
  batchGrantSummary.value = ''
  batchGrantFailures.value = []
  try {
    const data = await axios.post('/admin/referral/coupons/grant-batch', {
      template_id: Number(grantTemplateId.value),
      user_ids: selectedGrantUsers.value.map((u) => u.id),
    }, { timeout: 300000 })
    applyGrantResult(data)
    await loadCoupons()
  } catch (error) {
    console.error('发放代金券失败:', error)
  } finally {
    batchGranting.value = false
  }
}

async function openGrantAllConfirm() {
  if (!grantTemplateId.value) {
    showPageWarning('请选择模板')
    return
  }
  grantEligibleCount.value = null
  grantAllMax.value = null
  grantAllConfirmOpen.value = true
  try {
    const data = await axios.get('/admin/referral/coupons/grant-eligible-count', { timeout: 15000 })
    grantEligibleCount.value = Number(data?.eligible_count || 0)
    grantAllMax.value = Number(data?.grant_all_max || 0) || null
  } catch (error) {
    console.error('查询可发放用户数失败:', error)
    grantEligibleCount.value = null
  }
}

async function handleGrantAll() {
  if (!grantTemplateId.value) {
    showPageWarning('请选择模板')
    return
  }

  batchGranting.value = true
  grantingAll.value = true
  batchGrantSummary.value = ''
  batchGrantFailures.value = []
  try {
    const data = await axios.post('/admin/referral/coupons/grant-batch', {
      template_id: Number(grantTemplateId.value),
      grant_all: true,
      confirm_grant_all: true,
    }, { timeout: 600000 })
    grantAllConfirmOpen.value = false
    applyGrantResult(data)
    await loadCoupons()
  } catch (error) {
    console.error('发放给全部用户失败:', error)
  } finally {
    batchGranting.value = false
    grantingAll.value = false
  }
}

async function handleStart(tpl) {
  if (!tpl?.id || actionId.value) return
  actionId.value = tpl.id
  try {
    await axios.post(`/admin/referral/coupon-templates/${tpl.id}/start`)
    showPageSuccess('批次已激活')
    await loadTemplates()
  } catch (error) {
    console.error('激活批次失败:', error)
  } finally {
    actionId.value = null
  }
}

async function handlePause(tpl) {
  if (!tpl?.id || actionId.value) return
  actionId.value = tpl.id
  try {
    await axios.post(`/admin/referral/coupon-templates/${tpl.id}/pause`)
    showPageSuccess('批次已暂停发放')
    await loadTemplates()
  } catch (error) {
    console.error('暂停批次失败:', error)
  } finally {
    actionId.value = null
  }
}

async function handleRestart(tpl) {
  if (!tpl?.id || actionId.value) return
  actionId.value = tpl.id
  try {
    await axios.post(`/admin/referral/coupon-templates/${tpl.id}/restart`)
    showPageSuccess('批次已重启')
    await loadTemplates()
  } catch (error) {
    console.error('重启批次失败:', error)
  } finally {
    actionId.value = null
  }
}

async function handleStockDetail(tpl) {
  if (!tpl?.stock_id || actionId.value) return
  actionId.value = tpl.id
  try {
    const [detail, merchants, items] = await Promise.all([
      axios.get(`/admin/referral/wx-stocks/${encodeURIComponent(tpl.stock_id)}`),
      axios.get(`/admin/referral/wx-stocks/${encodeURIComponent(tpl.stock_id)}/merchants`, {
        params: { offset: 0, limit: 50 },
      }),
      axios.get(`/admin/referral/wx-stocks/${encodeURIComponent(tpl.stock_id)}/items`, {
        params: { offset: 0, limit: 100 },
      }),
    ])
    const item = detail?.item
    if (!item) {
      showPageSuccess('未查到批次详情')
      return
    }
    const mchOk = merchants?.available_for_mchid
    const mchHint = mchOk == null
      ? ''
      : (mchOk ? ' · 本商户可用' : ' · 本商户不在可用列表')
    const goodsHint = items?.unrestricted
      ? ' · 全场券'
      : ` · 单品编码${items?.total ?? '-'}`
    showPageSuccess(
      `${item.stock_name || tpl.title} · ${item.status}`
        + ` · 已发${item.distributed_coupons ?? '-'}张`
        + (item.coupon_amount_yuan != null ? ` · 面额${item.coupon_amount_yuan}元` : '')
        + ` · 可用商户${merchants?.total ?? '-'}`
        + mchHint
        + goodsHint
    )
  } catch (error) {
    console.error('查询批次详情失败:', error)
  } finally {
    actionId.value = null
  }
}

async function handleSyncWx() {
  if (syncing.value) return
  syncing.value = true
  try {
    const data = await axios.post('/admin/referral/coupon-templates/sync-wx')
    showPageSuccess(`已同步，更新 ${data?.updated ?? 0} 条`)
    await loadTemplates()
  } catch (error) {
    console.error('同步微信批次失败:', error)
  } finally {
    syncing.value = false
  }
}

async function handleQueryCallback() {
  if (loadingCallback.value) return
  loadingCallback.value = true
  try {
    const data = await axios.get('/admin/referral/favor-callback')
    if (data?.unset || !data?.notify_url) {
      showPageSuccess(
        data?.recommended_url
          ? `尚未设置；推荐: ${data.recommended_url}`
          : '尚未设置营销事件回调 URL'
      )
      return
    }
    showPageSuccess(`回调URL: ${data.notify_url}`)
  } catch (error) {
    console.error('查询营销回调失败:', error)
  } finally {
    loadingCallback.value = false
  }
}

async function handleSetCallback() {
  if (settingCallback.value) return
  settingCallback.value = true
  try {
    const data = await axios.post('/admin/referral/favor-callback', {})
    showPageSuccess(`已设置回调: ${data?.notify_url || ''}`)
  } catch (error) {
    console.error('设置营销回调失败:', error)
  } finally {
    settingCallback.value = false
  }
}

async function handleCouponDetail(row) {
  if (!row?.coupon_id || !row?.user_id || detailGrantId.value) return
  detailGrantId.value = row.id
  try {
    const data = await axios.get(
      `/admin/referral/coupons/${encodeURIComponent(row.coupon_id)}`,
      { params: { user_id: row.user_id } }
    )
    const item = data?.item
    if (!item) {
      showPageSuccess('未查到券详情')
      return
    }
    showPageSuccess(
      `${item.title || '代金券'} · ${item.status}`
        + (item.discount_yuan != null ? ` · ${item.discount_yuan}元` : '')
        + (item.min_order_yuan != null ? ` · 满${item.min_order_yuan}` : '')
    )
  } catch (error) {
    console.error('查询券详情失败:', error)
  } finally {
    detailGrantId.value = null
  }
}

onMounted(async () => {
  await Promise.all([loadTemplates(), loadCoupons()])
})
</script>
