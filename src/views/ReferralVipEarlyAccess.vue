<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <h2 class="text-xl font-semibold tracking-tight text-foreground">VIP 优先购设置</h2>

    <Card class="shadow-none ring-1">
      <CardContent class="flex flex-col gap-4 py-6">
        <p class="text-sm text-muted-foreground">
          开启后，在截止时间前仅 VIP 收藏家与艺术顾问可购买该商品。
        </p>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <select
            v-model="form.product_type"
            class="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          >
            <option value="right">版画</option>
            <option value="artwork">原作</option>
            <option value="digital">数字艺术</option>
          </select>
          <Input v-model="form.product_id" type="number" placeholder="商品 ID" />
          <select
            v-model="form.vip_early_access"
            class="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          >
            <option value="1">开启 VIP 优先购</option>
            <option value="0">关闭</option>
          </select>
          <Input
            v-model="form.vip_early_until"
            type="datetime-local"
            placeholder="截止时间（可选）"
          />
        </div>
        <div class="flex gap-2">
          <Button @click="handleSave">保存设置</Button>
          <Button variant="outline" @click="handleLoad">查询当前</Button>
        </div>
        <div v-if="current" class="rounded-md border border-border bg-muted/30 p-3 text-sm">
          <p>商品：{{ current.title || current.product_id }}</p>
          <p>状态：{{ current.vip_early_access ? 'VIP 优先购' : '全员可购' }}</p>
          <p>截止：{{ current.vip_early_until || '无（长期）' }}</p>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import axios from '@/utils/axios'
import { showPageSuccess } from '@/utils/appMessage'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const current = ref(null)
const form = reactive({
  product_type: 'right',
  product_id: '',
  vip_early_access: '1',
  vip_early_until: '',
})

async function handleLoad() {
  const id = parseInt(form.product_id, 10)
  if (!id) return
  current.value = await axios.get('/admin/referral/vip-early-access', {
    params: { product_type: form.product_type, product_id: id },
  })
}

async function handleSave() {
  const id = parseInt(form.product_id, 10)
  if (!id) return
  await axios.put('/admin/referral/vip-early-access', {
    product_type: form.product_type,
    product_id: id,
    vip_early_access: form.vip_early_access === '1',
    vip_early_until: form.vip_early_until || null,
  })
  showPageSuccess('已保存')
  await handleLoad()
}
</script>
