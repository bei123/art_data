<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <h2 class="text-xl font-semibold tracking-tight text-foreground">推荐优惠券</h2>

    <Card class="shadow-none ring-1">
      <CardContent class="flex flex-col gap-4 py-6">
        <h3 class="text-sm font-medium">新建模板</h3>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input v-model="form.title" placeholder="优惠券名称" />
          <Input v-model="form.discount_yuan" type="number" placeholder="优惠金额(元)" />
          <Input v-model="form.min_order_yuan" type="number" placeholder="最低订单(元)" />
          <Input v-model="form.valid_days" type="number" placeholder="有效天数" />
          <Input v-model="form.wx_brand_name" placeholder="卡券商户名(可选)" />
          <Input v-model="form.wx_logo_url" class="sm:col-span-2 lg:col-span-2" placeholder="卡券 Logo URL(可选)" />
        </div>
        <Button class="w-fit" @click="handleCreateTemplate">创建模板</Button>
      </CardContent>
    </Card>

    <Card class="shadow-none ring-1">
      <CardContent class="overflow-x-auto p-0 sm:p-6">
        <div class="mb-4 px-3 pt-4 sm:px-0 sm:pt-0">
          <h3 class="text-sm font-medium">优惠券模板 / 微信卡券</h3>
        </div>
        <table class="w-full min-w-[960px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="px-3 py-2 text-left">ID</th>
              <th class="px-3 py-2 text-left">名称</th>
              <th class="px-3 py-2 text-left">金额</th>
              <th class="px-3 py-2 text-left">门槛</th>
              <th class="px-3 py-2 text-left">微信状态</th>
              <th class="px-3 py-2 text-left">card_id</th>
              <th class="px-3 py-2 text-left">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tpl in templates" :key="tpl.id" class="border-b border-border">
              <td class="px-3 py-2">{{ tpl.id }}</td>
              <td class="px-3 py-2">{{ tpl.title }}</td>
              <td class="px-3 py-2">{{ tpl.discount_yuan }}</td>
              <td class="px-3 py-2">{{ tpl.min_order_yuan }}</td>
              <td class="px-3 py-2">{{ tpl.wx_card_status || 'none' }}</td>
              <td class="max-w-[180px] truncate px-3 py-2" :title="tpl.wx_card_id || ''">
                {{ tpl.wx_card_id || '-' }}
              </td>
              <td class="px-3 py-2">
                <div class="flex flex-wrap gap-2">
                  <Button
                    v-if="!tpl.wx_card_id"
                    size="sm"
                    variant="outline"
                    :disabled="wxBusyId === tpl.id"
                    @click="handleCreateWxCard(tpl)"
                  >
                    创建微信卡
                  </Button>
                  <Button
                    v-else
                    size="sm"
                    variant="outline"
                    :disabled="wxBusyId === tpl.id"
                    @click="handleRefreshWxCard(tpl)"
                  >
                    刷新状态
                  </Button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
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
            <option value="">选择模板</option>
            <option v-for="tpl in templates" :key="tpl.id" :value="String(tpl.id)">
              {{ tpl.title }} · {{ tpl.discount_yuan }}元
              <template v-if="tpl.wx_card_id"> · 已绑卡</template>
            </option>
          </select>
        </div>
        <Button class="w-fit" @click="handleGrant">发放优惠券</Button>
      </CardContent>
    </Card>

    <Card class="shadow-none ring-1">
      <CardContent class="overflow-x-auto p-0 sm:p-6">
        <table class="w-full min-w-[900px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="px-3 py-2 text-left">用户</th>
              <th class="px-3 py-2 text-left">名称</th>
              <th class="px-3 py-2 text-left">金额</th>
              <th class="px-3 py-2 text-left">状态</th>
              <th class="px-3 py-2 text-left">卡包</th>
              <th class="px-3 py-2 text-left">过期时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in coupons" :key="row.id" class="border-b border-border">
              <td class="px-3 py-2">{{ row.user_id }} / {{ row.nickname || '-' }}</td>
              <td class="px-3 py-2">{{ row.title }}</td>
              <td class="px-3 py-2">{{ row.discount_yuan }}</td>
              <td class="px-3 py-2">{{ row.status }}</td>
              <td class="px-3 py-2">{{ row.wx_wallet_status || 'not_added' }}</td>
              <td class="px-3 py-2">{{ formatDate(row.expires_at) }}</td>
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

const templates = ref([])
const coupons = ref([])
const wxBusyId = ref(null)
const form = reactive({
  title: '',
  discount_yuan: '',
  min_order_yuan: '0',
  valid_days: '30',
  wx_brand_name: '',
  wx_logo_url: '',
})
const grantForm = reactive({
  user_id: '',
  template_id: '',
})

function formatDate(value) {
  if (!value) return '-'
  return String(value).replace('T', ' ').slice(0, 19)
}

async function loadData() {
  const [tplRes, couponRes] = await Promise.all([
    axios.get('/admin/referral/coupon-templates'),
    axios.get('/admin/referral/coupons', { params: { page: 1, pageSize: 50 } }),
  ])
  templates.value = tplRes.items || []
  coupons.value = couponRes.items || []
}

async function handleCreateTemplate() {
  await axios.post('/admin/referral/coupon-templates', {
    title: form.title,
    discount_yuan: Number(form.discount_yuan),
    min_order_yuan: Number(form.min_order_yuan || 0),
    valid_days: Number(form.valid_days || 30),
    wx_brand_name: form.wx_brand_name || undefined,
    wx_logo_url: form.wx_logo_url || undefined,
  })
  showPageSuccess('模板已创建')
  form.title = ''
  form.discount_yuan = ''
  form.wx_brand_name = ''
  form.wx_logo_url = ''
  await loadData()
}

async function handleCreateWxCard(tpl) {
  wxBusyId.value = tpl.id
  try {
    await axios.post(`/admin/referral/coupon-templates/${tpl.id}/wx-card`, {
      action: 'create',
      wx_logo_url: tpl.wx_logo_url || form.wx_logo_url || undefined,
      wx_brand_name: tpl.wx_brand_name || form.wx_brand_name || undefined,
    })
    showPageSuccess('已提交创建微信卡券（待审核）')
    await loadData()
  } finally {
    wxBusyId.value = null
  }
}

async function handleRefreshWxCard(tpl) {
  wxBusyId.value = tpl.id
  try {
    await axios.post(`/admin/referral/coupon-templates/${tpl.id}/wx-card`, {
      action: 'refresh',
    })
    showPageSuccess('微信卡券状态已刷新')
    await loadData()
  } finally {
    wxBusyId.value = null
  }
}

async function handleGrant() {
  await axios.post('/admin/referral/coupons/grant', {
    user_id: Number(grantForm.user_id),
    template_id: grantForm.template_id ? Number(grantForm.template_id) : null,
  })
  showPageSuccess('优惠券已发放')
  grantForm.user_id = ''
  await loadData()
}

onMounted(loadData)
</script>
