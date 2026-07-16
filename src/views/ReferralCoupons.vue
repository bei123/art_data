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
        </div>
        <Button class="w-fit" @click="handleCreateTemplate">创建模板</Button>
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
            </option>
          </select>
        </div>
        <Button class="w-fit" @click="handleGrant">发放优惠券</Button>
      </CardContent>
    </Card>

    <Card class="shadow-none ring-1">
      <CardContent class="overflow-x-auto p-0 sm:p-6">
        <table class="w-full min-w-[800px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="px-3 py-2 text-left">用户</th>
              <th class="px-3 py-2 text-left">名称</th>
              <th class="px-3 py-2 text-left">金额</th>
              <th class="px-3 py-2 text-left">状态</th>
              <th class="px-3 py-2 text-left">过期时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in coupons" :key="row.id" class="border-b border-border">
              <td class="px-3 py-2">{{ row.user_id }} / {{ row.nickname || '-' }}</td>
              <td class="px-3 py-2">{{ row.title }}</td>
              <td class="px-3 py-2">{{ row.discount_yuan }}</td>
              <td class="px-3 py-2">{{ row.status }}</td>
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
const form = reactive({
  title: '',
  discount_yuan: '',
  min_order_yuan: '0',
  valid_days: '30',
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
  })
  showPageSuccess('模板已创建')
  form.title = ''
  form.discount_yuan = ''
  await loadData()
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
