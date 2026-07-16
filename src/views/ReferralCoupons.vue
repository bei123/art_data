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
          <Input v-model="form.max_coupons" type="number" placeholder="发放总上限" />
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
        <h3 class="mb-3 px-3 pt-4 text-sm font-medium sm:px-0 sm:pt-0">批次模板</h3>
        <table class="w-full min-w-[900px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="px-3 py-2 text-left">名称</th>
              <th class="px-3 py-2 text-left">金额</th>
              <th class="px-3 py-2 text-left">stock_id</th>
              <th class="px-3 py-2 text-left">状态</th>
              <th class="px-3 py-2 text-left">欢迎券</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tpl in templates" :key="tpl.id" class="border-b border-border">
              <td class="px-3 py-2">{{ tpl.title }}</td>
              <td class="px-3 py-2">{{ tpl.discount_yuan }} / 满{{ tpl.min_order_yuan }}</td>
              <td class="px-3 py-2 font-mono text-xs">{{ tpl.stock_id || '-' }}</td>
              <td class="px-3 py-2">{{ tpl.wx_status || '-' }}</td>
              <td class="px-3 py-2">{{ tpl.is_welcome ? '是' : '-' }}</td>
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
              <td class="px-3 py-2 font-mono text-xs">{{ row.coupon_id || '-' }}</td>
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
  const { data } = await axios.get('/admin/referral/coupon-templates')
  templates.value = data.items || []
}

async function loadCoupons() {
  const { data } = await axios.get('/admin/referral/coupons', { params: { pageSize: 50 } })
  coupons.value = data.items || []
}

async function handleCreateTemplate() {
  creating.value = true
  try {
    await axios.post('/admin/referral/coupon-templates', {
      title: form.title,
      discount_yuan: form.discount_yuan,
      min_order_yuan: form.min_order_yuan,
      valid_days: form.valid_days,
      max_coupons: form.max_coupons,
      is_welcome: form.is_welcome,
    })
    showPageSuccess('批次已创建')
    form.title = ''
    form.discount_yuan = ''
    await loadTemplates()
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
  } finally {
    granting.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadTemplates(), loadCoupons()])
})
</script>
