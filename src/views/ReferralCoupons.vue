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
        <h3 class="text-sm font-medium">发放给用户</h3>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input v-model="grantForm.user_id" type="number" placeholder="用户 ID" />
          <select
            v-model="grantForm.template_id"
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
        <Button class="w-fit" :disabled="granting" @click="handleGrant">
          {{ granting ? '发放中…' : '发放代金券' }}
        </Button>
      </CardContent>
    </Card>

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
import { showPageSuccess } from '@/utils/appMessage'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const templates = ref([])
const coupons = ref([])
const creating = ref(false)
const granting = ref(false)
const actionId = ref(null)
const syncing = ref(false)
const loadingCallback = ref(false)
const settingCallback = ref(false)
const detailGrantId = ref(null)
const form = reactive({
  title: '',
  discount_yuan: '',
  min_order_yuan: '0',
  valid_days: '30',
  max_coupons: '10000',
  is_welcome: false,
})
const grantForm = reactive({
  user_id: '',
  template_id: '',
})

const runningTemplates = computed(() =>
  (templates.value || []).filter((t) => t.wx_status === 'running' && t.stock_id)
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

async function handleGrant() {
  granting.value = true
  try {
    await axios.post('/admin/referral/coupons/grant', {
      user_id: Number(grantForm.user_id),
      template_id: Number(grantForm.template_id),
    })
    showPageSuccess('已发放')
    await loadCoupons()
  } catch (error) {
    console.error('发放代金券失败:', error)
  } finally {
    granting.value = false
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
