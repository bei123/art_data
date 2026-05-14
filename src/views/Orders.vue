<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div class="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <h2 class="text-xl font-semibold tracking-tight text-foreground">
        订单管理
      </h2>
      <div class="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <div class="flex w-full min-w-0 flex-col gap-2 lg:max-w-md">
          <Label for="ord-keyword" class="sr-only">搜索订单</Label>
          <Input
            id="ord-keyword"
            v-model="filters.keyword"
            placeholder="订单号、微信交易号、用户昵称、订单摘要或用户ID"
            autocomplete="off"
            @keydown.enter.prevent="handleSearch"
          />
        </div>
        <div class="flex flex-wrap items-end gap-2">
          <div class="flex min-w-[9rem] flex-col gap-1.5">
            <span class="text-xs text-muted-foreground">订单状态</span>
            <select
              v-model="filters.status"
              class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">全部</option>
              <option value="NOTPAY">未支付</option>
              <option value="SUCCESS">支付成功</option>
              <option value="REFUND">转入退款</option>
              <option value="CLOSED">已关闭</option>
              <option value="REVOKED">已撤销</option>
              <option value="PAYERROR">支付失败</option>
            </select>
          </div>
          <div class="flex min-w-[9rem] flex-col gap-1.5">
            <span class="text-xs text-muted-foreground">商品类型</span>
            <select
              v-model="filters.type"
              class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">全部</option>
              <option value="right">权益</option>
              <option value="digital">数字艺术品</option>
              <option value="artwork">原作</option>
            </select>
          </div>
          <Button type="button" @click="handleSearch">
            查询
          </Button>
          <Button type="button" variant="outline" @click="resetFilters">
            重置
          </Button>
        </div>
      </div>
    </div>

    <Alert v-if="listError && !loading" variant="destructive">
      <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
      <AlertTitle>{{ listError }}</AlertTitle>
      <AlertDescription class="mt-2">
        <Button type="button" variant="secondary" size="sm" @click="retryFetchOrders">
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
        <table class="w-full min-w-[1100px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="h-10 w-44 px-3 text-left font-medium">订单号</th>
              <th class="h-10 w-36 px-3 text-left font-medium">用户</th>
              <th class="h-10 min-w-[16rem] px-3 text-left font-medium">商品信息</th>
              <th class="h-10 w-28 px-3 text-left font-medium">订单金额</th>
              <th class="h-10 w-28 px-3 text-left font-medium">实付金额</th>
              <th class="h-10 w-28 px-3 text-left font-medium">支付状态</th>
              <th class="h-10 w-44 px-3 text-left font-medium">创建时间</th>
              <th class="h-10 w-28 px-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in orders"
              :key="row.id"
              class="border-b border-border transition-colors hover:bg-muted/30"
            >
              <td class="px-3 py-2.5 font-mono text-xs text-muted-foreground">{{ row.out_trade_no }}</td>
              <td class="px-3 py-2">
                <div class="flex max-w-[8rem] items-center gap-2">
                  <div class="size-8 shrink-0 overflow-hidden rounded-full border border-border bg-muted">
                    <img
                      v-if="row.user_avatar"
                      :src="row.user_avatar"
                      :alt="row.user_nickname ? `${row.user_nickname} 头像` : ''"
                      class="size-full object-cover"
                      loading="lazy"
                    >
                  </div>
                  <span class="truncate text-xs text-muted-foreground">{{ row.user_nickname || '未知用户' }}</span>
                </div>
              </td>
              <td class="px-3 py-2">
                <div v-for="item in row.items" :key="item.id" class="mb-3 flex gap-2 last:mb-0">
                  <div class="size-12 shrink-0 overflow-hidden rounded-md border border-border bg-muted/30">
                    <img
                      v-if="item.images && item.images.length > 0"
                      :src="getImageUrl(item.images[0])"
                      :alt="item.title ? `商品：${item.title}` : '商品图'"
                      class="size-full object-cover"
                      loading="lazy"
                    >
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="font-medium leading-snug">{{ item.title }}</div>
                    <div class="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary" class="font-normal">{{ getTypeLabel(item.type) }}</Badge>
                      <span>x{{ item.quantity }}</span>
                      <span class="tabular-nums text-foreground">¥{{ item.price }}</span>
                    </div>
                    <div v-if="item.address" class="mt-1 flex flex-wrap items-start gap-1 text-xs text-muted-foreground">
                      <MapPin class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      <span>
                        <span class="font-medium text-foreground">{{ item.address.receiver_name }} {{ item.address.receiver_phone }}</span>
                        <span class="block text-muted-foreground">{{ item.address.full_address }}</span>
                      </span>
                    </div>
                    <div v-else class="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin class="size-3.5 shrink-0" aria-hidden="true" />
                      <span>无地址信息</span>
                    </div>
                  </div>
                </div>
              </td>
              <td class="px-3 py-2.5 tabular-nums font-medium text-amber-600 dark:text-amber-500">
                ¥{{ row.total_fee }}
              </td>
              <td class="px-3 py-2.5 tabular-nums font-medium text-amber-600 dark:text-amber-500">
                ¥{{ row.actual_fee }}
              </td>
              <td class="px-3 py-2.5">
                <Badge :variant="getStatusBadgeVariant(row.pay_status?.trade_state)">
                  {{ getStatusLabel(row.pay_status?.trade_state) }}
                </Badge>
              </td>
              <td class="px-3 py-2.5 tabular-nums text-muted-foreground">{{ row.created_at }}</td>
              <td class="px-3 py-2.5 text-right">
                <Button size="sm" type="button" @click="viewOrderDetail(row)">
                  查看详情
                </Button>
              </td>
            </tr>
            <tr v-if="orders.length === 0 && !loading">
              <td colspan="8" class="px-3 py-12 text-center text-muted-foreground">
                暂无订单数据
              </td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>

    <Card class="shadow-none ring-1">
      <CardContent class="flex flex-col gap-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <span class="text-sm text-muted-foreground">共 {{ pagination.total }} 条</span>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm text-muted-foreground">每页</span>
          <Select
            :model-value="String(pagination.limit)"
            @update:model-value="(v) => handleSizeChange(Number(v))"
          >
            <SelectTrigger class="h-8 w-[88px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            type="button"
            :disabled="pagination.page <= 1"
            @click="handleCurrentChange(pagination.page - 1)"
          >
            上一页
          </Button>
          <span class="min-w-[5rem] text-center text-sm tabular-nums">
            {{ pagination.page }} / {{ totalPages }}
          </span>
          <Button
            size="sm"
            variant="outline"
            type="button"
            :disabled="pagination.page >= totalPages"
            @click="handleCurrentChange(pagination.page + 1)"
          >
            下一页
          </Button>
        </div>
      </CardContent>
    </Card>

    <Dialog v-model:open="detailDialogVisible">
      <DialogContent class="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>订单详情</DialogTitle>
        </DialogHeader>

        <div v-if="selectedOrder" class="max-h-[calc(90vh-8rem)] space-y-6 overflow-y-auto pr-1">
          <div>
            <h3 class="mb-3 border-b border-border pb-2 text-base font-semibold text-foreground">
              订单信息
            </h3>
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="rounded-lg border border-border p-3">
                <div class="text-xs text-muted-foreground">订单号</div>
                <div class="mt-1 font-mono text-sm break-all">{{ selectedOrder.out_trade_no }}</div>
              </div>
              <div class="rounded-lg border border-border p-3">
                <div class="text-xs text-muted-foreground">创建时间</div>
                <div class="mt-1 text-sm">{{ selectedOrder.created_at }}</div>
              </div>
              <div class="rounded-lg border border-border p-3 sm:col-span-2">
                <div class="text-xs text-muted-foreground">用户信息</div>
                <div class="mt-2 flex items-center gap-3">
                  <div class="size-10 shrink-0 overflow-hidden rounded-full border border-border bg-muted">
                    <img
                      v-if="selectedOrder.user_avatar"
                      :src="selectedOrder.user_avatar"
                      alt=""
                      class="size-full object-cover"
                    >
                  </div>
                  <span class="text-sm font-medium">{{ selectedOrder.user_nickname || '未知用户' }}</span>
                </div>
              </div>
              <div class="rounded-lg border border-border p-3">
                <div class="text-xs text-muted-foreground">订单金额</div>
                <div class="mt-1 tabular-nums font-medium">¥{{ selectedOrder.total_fee }}</div>
              </div>
              <div class="rounded-lg border border-border p-3">
                <div class="text-xs text-muted-foreground">实付金额</div>
                <div class="mt-1 tabular-nums font-medium">¥{{ selectedOrder.actual_fee }}</div>
              </div>
              <div class="rounded-lg border border-border p-3">
                <div class="text-xs text-muted-foreground">抵扣金额</div>
                <div class="mt-1 tabular-nums">¥{{ selectedOrder.discount_amount || 0 }}</div>
              </div>
              <div class="rounded-lg border border-border p-3">
                <div class="text-xs text-muted-foreground">支付状态</div>
                <div class="mt-2">
                  <Badge :variant="getStatusBadgeVariant(selectedOrder.pay_status?.trade_state)">
                    {{ getStatusLabel(selectedOrder.pay_status?.trade_state) }}
                  </Badge>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h3 class="mb-3 border-b border-border pb-2 text-base font-semibold text-foreground">
              支付信息
            </h3>
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="rounded-lg border border-border p-3">
                <div class="text-xs text-muted-foreground">交易状态</div>
                <div class="mt-1 text-sm">{{ selectedOrder.pay_status?.trade_state_desc }}</div>
              </div>
              <div class="rounded-lg border border-border p-3">
                <div class="text-xs text-muted-foreground">交易 ID</div>
                <div class="mt-1 font-mono text-xs break-all">{{ selectedOrder.pay_status?.transaction_id || '—' }}</div>
              </div>
              <div class="rounded-lg border border-border p-3">
                <div class="text-xs text-muted-foreground">支付时间</div>
                <div class="mt-1 text-sm">{{ selectedOrder.pay_status?.success_time || '—' }}</div>
              </div>
              <div class="rounded-lg border border-border p-3">
                <div class="text-xs text-muted-foreground">支付金额</div>
                <div class="mt-1 text-sm">
                  {{ selectedOrder.pay_status?.amount ? `¥${selectedOrder.pay_status.amount.total / 100}` : '—' }}
                </div>
              </div>
            </div>
          </div>

          <div>
            <h3 class="mb-3 border-b border-border pb-2 text-base font-semibold text-foreground">
              商品信息
            </h3>
            <div
              v-for="item in selectedOrder.items"
              :key="item.id"
              class="mb-4 rounded-lg border border-border p-4 last:mb-0"
            >
              <div class="flex flex-col gap-4 sm:flex-row">
                <div class="size-20 shrink-0 overflow-hidden rounded-md border border-border bg-muted/30">
                  <img
                    v-if="item.images && item.images.length > 0"
                    :src="getImageUrl(item.images[0])"
                    :alt="item.title ? `商品：${item.title}` : '商品图'"
                    class="size-full object-cover"
                    loading="lazy"
                  >
                </div>
                <div class="min-w-0 flex-1">
                  <div class="font-semibold leading-snug">{{ item.title }}</div>
                  <p class="mt-2 text-sm text-muted-foreground">{{ item.description }}</p>
                  <div class="mt-2 flex flex-wrap gap-2 text-xs">
                    <Badge variant="secondary">{{ getTypeLabel(item.type) }}</Badge>
                    <span class="text-muted-foreground">数量: {{ item.quantity }}</span>
                    <span class="tabular-nums text-foreground">单价: ¥{{ item.price }}</span>
                  </div>
                  <div v-if="item.address" class="mt-4">
                    <div class="mb-2 text-sm font-medium text-foreground">
                      收货地址
                    </div>
                    <div class="grid gap-2 rounded-md border border-border bg-muted/20 p-3 text-sm">
                      <div><span class="text-muted-foreground">收货人：</span>{{ item.address.receiver_name }}</div>
                      <div><span class="text-muted-foreground">联系电话：</span>{{ item.address.receiver_phone }}</div>
                      <div><span class="text-muted-foreground">收货地址：</span>{{ item.address.full_address }}</div>
                      <div class="flex items-center gap-2">
                        <span class="text-muted-foreground">是否默认：</span>
                        <Badge :variant="item.address.is_default ? 'default' : 'secondary'">
                          {{ item.address.is_default ? '默认地址' : '普通地址' }}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div v-else class="mt-4 rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    无地址信息
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="isOrderLogisticsEligible(selectedOrder)" class="rounded-lg border border-border bg-muted/10 p-4">
            <h3 class="mb-2 text-base font-semibold text-foreground">
              物流（微信物流助手）
            </h3>
            <p class="mb-3 text-sm text-muted-foreground leading-relaxed">
              含实物且已支付成功时可发货；轨迹与面单需填写与下单一致的快递公司与运单号。本页成功发货后会暂存运单号便于查询。
            </p>
            <div class="flex flex-wrap gap-2">
              <Button type="button" @click="openShipDialog">
                发货
              </Button>
              <Button type="button" variant="secondary" @click="openPathDialog">
                查询轨迹
              </Button>
              <Button type="button" variant="secondary" @click="openWaybillDialog">
                面单
              </Button>
              <Button type="button" variant="destructive" @click="openCancelWaybillDialog">
                取消运单
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="shipDialogVisible">
      <DialogContent class="max-h-[92vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>微信物流发货</DialogTitle>
        </DialogHeader>

        <div class="grid max-h-[calc(92vh-10rem)] gap-4 overflow-y-auto py-2 pr-1">
          <div class="flex flex-col gap-2">
            <Label>快递公司 <span class="text-destructive">*</span></Label>
            <Select
              :model-value="shipForm.delivery_id ? String(shipForm.delivery_id) : undefined"
              @update:model-value="(v) => {
                shipForm.delivery_id = v != null && v !== '' ? String(v) : ''
                onShipDeliveryChange()
              }"
            >
              <SelectTrigger class="w-full">
                <SelectValue placeholder="请选择快递公司" />
              </SelectTrigger>
              <SelectContent class="z-[100]" @pointer-down-outside.prevent>
                <SelectItem
                  v-for="d in deliveryList"
                  :key="String(d.delivery_id)"
                  :value="String(d.delivery_id)"
                >
                  {{ d.delivery_name }}（{{ d.delivery_id }}）
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex flex-col gap-2">
            <Label>客户编码 biz_id <span class="text-destructive">*</span></Label>
            <select
              v-model="shipForm.biz_id"
              class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            >
              <option value="SF_CASH">现付客户编码（SF_CASH）</option>
            </select>
            <p class="text-xs text-muted-foreground">暂固定为微信物流现付客户编码；与运力侧绑定一致即可。</p>
          </div>
          <div class="flex flex-col gap-2">
            <Label>服务类型 <span class="text-destructive">*</span></Label>
            <Select
              :disabled="!shipForm.delivery_id || !serviceTypeOptions.length"
              :model-value="shipServiceValue || undefined"
              @update:model-value="(v) => {
                const s = typeof v === 'string' ? v : ''
                shipServiceValue = s
                onShipServiceChange(s)
              }"
            >
              <SelectTrigger class="w-full">
                <SelectValue placeholder="先选快递公司" />
              </SelectTrigger>
              <SelectContent class="z-[100]" @pointer-down-outside.prevent>
                <SelectItem
                  v-for="(s, idx) in serviceTypeOptions"
                  :key="`${s.service_type}-${idx}`"
                  :value="`${s.service_type}|||${s.service_name}`"
                >
                  {{ s.service_name }}（{{ s.service_type }}）
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div v-if="shipForm.delivery_id === 'SF'" class="flex flex-col gap-2">
            <Label>顺丰揽件时间 <span class="text-destructive">*</span></Label>
            <div class="flex flex-col gap-2">
              <div class="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  :variant="sfExpectMode === 'pickup' ? 'default' : 'outline'"
                  @click="sfExpectMode = 'pickup'"
                >
                  选择预计上门揽件时间
                </Button>
                <Button
                  type="button"
                  size="sm"
                  :variant="sfExpectMode === 'agreed' ? 'default' : 'outline'"
                  @click="sfExpectMode = 'agreed'"
                >
                  已与网点/客户约定取件（传 0）
                </Button>
              </div>
              <Input
                v-if="sfExpectMode === 'pickup'"
                v-model="sfPickupLocalStr"
                type="datetime-local"
                class="font-mono text-sm"
              />
              <p class="text-xs text-muted-foreground leading-relaxed">
                微信要求顺丰必传 expect_time：须为<strong>晚于当前</strong>的时间；若已由快递员约定时间请选第二项传 0。
              </p>
            </div>
          </div>

          <Separator />
          <div class="text-sm font-medium text-foreground">
            保价（可选）
          </div>
          <label class="flex cursor-pointer items-center gap-2 text-sm">
            <input v-model="shipInsured.enabled" type="checkbox" class="size-4 rounded border-input">
            <span>保价</span>
          </label>
          <div v-if="shipInsured.enabled" class="flex flex-col gap-2">
            <Label for="insured-yuan">保价金额（元） <span class="text-destructive">*</span></Label>
            <Input
              id="insured-yuan"
              v-model.number="shipInsured.amountYuan"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="如 100 表示保价 100 元"
            />
            <p class="text-xs text-muted-foreground">微信侧保额单位为「分」，此处按「元」填写，提交时自动换算。</p>
          </div>

          <Separator />
          <div class="text-sm font-medium text-foreground">
            发件人
          </div>
          <div class="flex flex-col gap-2">
            <Label for="snd-name">姓名</Label>
            <Input id="snd-name" v-model="shipForm.sender.name" autocomplete="off" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="snd-mobile">手机 <span class="text-destructive">*</span></Label>
            <Input id="snd-mobile" v-model="shipForm.sender.mobile" placeholder="与电话至少填一项" autocomplete="off" />
          </div>
          <div class="grid gap-2 sm:grid-cols-3">
            <div class="flex flex-col gap-2">
              <Label for="snd-prov">省</Label>
              <Input id="snd-prov" v-model="shipForm.sender.province" placeholder="省" autocomplete="off" />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="snd-city">市</Label>
              <Input id="snd-city" v-model="shipForm.sender.city" placeholder="市" autocomplete="off" />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="snd-area">区/县</Label>
              <Input id="snd-area" v-model="shipForm.sender.area" placeholder="区/县" autocomplete="off" />
            </div>
          </div>
          <div class="flex flex-col gap-2">
            <Label for="snd-addr">详细地址 <span class="text-destructive">*</span></Label>
            <Textarea id="snd-addr" v-model="shipForm.sender.address" class="min-h-20" rows="2" />
          </div>
        </div>

        <DialogFooter class="gap-2 sm:justify-end">
          <Button type="button" variant="outline" @click="shipDialogVisible = false">
            取消
          </Button>
          <Button type="button" :disabled="shipSubmitting" @click="submitShip">
            <Loader2 v-if="shipSubmitting" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            提交发货
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="pathDialogVisible">
      <DialogContent class="max-h-[90vh] max-w-[calc(100%-2rem)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>运单轨迹</DialogTitle>
        </DialogHeader>
        <div class="grid gap-3 py-2">
          <div class="flex flex-col gap-2">
            <Label for="path-delivery">快递公司</Label>
            <Input id="path-delivery" v-model="trackForm.delivery_id" placeholder="如 SF" autocomplete="off" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="path-waybill">运单号</Label>
            <Input id="path-waybill" v-model="trackForm.waybill_id" placeholder="发货成功返回的运单号" autocomplete="off" />
          </div>
          <Button type="button" class="w-fit" :disabled="pathLoading" @click="fetchPath">
            <Loader2 v-if="pathLoading" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            查询
          </Button>
          <div v-if="pathItemList.length" class="max-h-[420px] space-y-0 overflow-y-auto border-l-2 border-border pl-4">
            <div
              v-for="(it, idx) in pathItemList"
              :key="idx"
              class="relative pb-6 pl-2 last:pb-0"
            >
              <span class="absolute -left-[9px] top-1.5 size-2 rounded-full bg-primary" aria-hidden="true" />
              <div class="text-xs text-muted-foreground">{{ formatPathTime(it.action_time) }}</div>
              <div class="text-xs text-muted-foreground">{{ pathActionLabel(it.action_type) }}</div>
              <div class="text-sm text-foreground">{{ it.action_msg }}</div>
            </div>
          </div>
          <div v-else-if="pathQueried && !pathLoading" class="rounded-md border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            暂无轨迹数据
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="waybillDialogVisible">
      <DialogContent class="max-h-[92vh] max-w-[calc(100%-2rem)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>运单面单</DialogTitle>
        </DialogHeader>
        <div class="grid gap-3 py-2">
          <div class="flex flex-col gap-2">
            <Label for="wb-delivery">快递公司</Label>
            <Input id="wb-delivery" v-model="trackForm.delivery_id" autocomplete="off" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="wb-waybill">运单号</Label>
            <Input id="wb-waybill" v-model="trackForm.waybill_id" autocomplete="off" />
          </div>
          <div class="flex flex-col gap-2">
            <Label>面单类型</Label>
            <div class="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                :variant="waybillPrintType === 0 ? 'default' : 'outline'"
                @click="waybillPrintType = 0"
              >
                二联单
              </Button>
              <Button
                type="button"
                size="sm"
                :variant="waybillPrintType === 1 ? 'default' : 'outline'"
                @click="waybillPrintType = 1"
              >
                一联单
              </Button>
            </div>
          </div>
          <Button type="button" class="w-fit" :disabled="waybillLoading" @click="fetchWaybill">
            <Loader2 v-if="waybillLoading" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            获取面单
          </Button>
          <div v-if="waybillPreviewUrl" class="overflow-hidden rounded-md border border-border">
            <iframe title="面单预览" :src="waybillPreviewUrl" class="h-[min(480px,50vh)] w-full border-0" />
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <AlertDialog v-model:open="cancelWaybillDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>取消运单</AlertDialogTitle>
          <AlertDialogDescription>
            确认向微信发起取消运单？需已填写与发货一致的快递公司与运单号。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter class="gap-2 sm:justify-end">
          <AlertDialogCancel type="button">
            关闭
          </AlertDialogCancel>
          <Button type="button" variant="destructive" :disabled="cancelWaybillSubmitting" @click="confirmCancelWaybill">
            <Loader2 v-if="cancelWaybillSubmitting" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            确认取消
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup>
import { ref, onMounted, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { AlertCircle, Loader2, MapPin } from 'lucide-vue-next'
import axios from '../utils/axios'
import { API_BASE_URL, isOssPublicUrl } from '../config'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const WAYBILL_STORAGE_KEY = 'admin_orders_last_waybill_v1'
const LOGISTICS_BIZ_ID_CASH = 'SF_CASH'

const orders = ref([])
const loading = ref(false)
const listError = ref('')
const detailDialogVisible = ref(false)
const selectedOrder = ref(null)

const deliveryList = ref([])
const shipDialogVisible = ref(false)
const shipSubmitting = ref(false)
const shipServiceValue = ref('')
const sfExpectMode = ref('pickup')
const sfPickupLocalStr = ref('')
const shipInsured = reactive({
  enabled: false,
  amountYuan: undefined,
})
const shipForm = reactive({
  delivery_id: '',
  biz_id: LOGISTICS_BIZ_ID_CASH,
  service_type: null,
  service_name: '',
  sender: {
    name: '',
    mobile: '',
    province: '',
    city: '',
    area: '',
    address: '',
  },
})

const pathDialogVisible = ref(false)
const pathLoading = ref(false)
const pathQueried = ref(false)
const pathItemList = ref([])
const trackForm = reactive({
  delivery_id: '',
  waybill_id: '',
})

const waybillDialogVisible = ref(false)
const waybillLoading = ref(false)
const waybillPrintType = ref(0)
const waybillPreviewUrl = ref('')

const cancelWaybillDialogOpen = ref(false)
const cancelWaybillSubmitting = ref(false)

const filters = reactive({
  keyword: '',
  status: '',
  type: '',
})

const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0,
})

const totalPages = computed(() => Math.max(1, Math.ceil(pagination.total / pagination.limit)))

watch(detailDialogVisible, (v) => {
  if (!v) selectedOrder.value = null
})

watch(waybillDialogVisible, (v) => {
  if (!v) revokeWaybillPreview()
})

watch(shipDialogVisible, (open) => {
  if (!open) return
  resetShipForm()
  if (!deliveryList.value.length) void fetchDeliveryList()
})

const retryFetchOrders = () => {
  listError.value = ''
  fetchOrders()
}

const handleSearch = () => {
  pagination.page = 1
  fetchOrders()
}

const fetchOrders = async () => {
  loading.value = true
  listError.value = ''
  try {
    const params = {
      page: pagination.page,
      limit: pagination.limit,
    }

    if (filters.status) params.status = filters.status
    if (filters.type) params.type = filters.type

    const kw = typeof filters.keyword === 'string' ? filters.keyword.trim() : ''
    if (kw) params.keyword = kw

    const response = await axios.get('/wx/pay/admin/orders', { params })

    if (response.success) {
      orders.value = response.data.orders
      pagination.total = response.data.pagination.total
    } else {
      orders.value = []
      pagination.total = 0
      listError.value = response.error || '获取订单列表失败'
    }
  } catch (error) {
    console.error('获取订单列表失败:', error)
    orders.value = []
    pagination.total = 0
    listError.value = '获取订单列表失败，请检查网络或稍后重试'
  } finally {
    loading.value = false
  }
}

const resetFilters = () => {
  filters.keyword = ''
  filters.status = ''
  filters.type = ''
  pagination.page = 1
  fetchOrders()
}

const handleSizeChange = (size) => {
  pagination.limit = size
  pagination.page = 1
  fetchOrders()
}

const handleCurrentChange = (page) => {
  pagination.page = page
  fetchOrders()
}

const viewOrderDetail = (order) => {
  selectedOrder.value = order
  detailDialogVisible.value = true
  prefillTrackFormFromStorage(order.id)
}

function readWaybillMap() {
  try {
    const raw = sessionStorage.getItem(WAYBILL_STORAGE_KEY)
    if (!raw) return {}
    const o = JSON.parse(raw)
    return typeof o === 'object' && o ? o : {}
  } catch {
    return {}
  }
}

function writeWaybillMap(map) {
  try {
    sessionStorage.setItem(WAYBILL_STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

function saveLastWaybill(orderId, delivery_id, waybill_id) {
  const map = readWaybillMap()
  map[String(orderId)] = { delivery_id, waybill_id }
  writeWaybillMap(map)
}

function getLastWaybill(orderId) {
  const map = readWaybillMap()
  return map[String(orderId)] || null
}

function prefillTrackFormFromStorage(orderId) {
  const w = getLastWaybill(orderId)
  if (w) {
    trackForm.delivery_id = w.delivery_id || ''
    trackForm.waybill_id = w.waybill_id || ''
  }
}

function isOrderLogisticsEligible(order) {
  if (!order || !order.items || !Array.isArray(order.items)) return false
  const state = order.pay_status?.trade_state || order.trade_state
  if (state !== 'SUCCESS') return false
  return order.items.some((it) => it.type === 'right' || it.type === 'artwork')
}

const serviceTypeOptions = computed(() => {
  const id = shipForm.delivery_id != null && shipForm.delivery_id !== ''
    ? String(shipForm.delivery_id)
    : ''
  if (!id) return []
  const d = deliveryList.value.find((x) => String(x.delivery_id) === id)
  if (!d || !Array.isArray(d.service_type)) return []
  return d.service_type
})

function defaultSfPickupDate() {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 2)
  return d
}

function formatDatetimeLocalValue(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function resetShipForm() {
  shipForm.delivery_id = ''
  shipForm.biz_id = LOGISTICS_BIZ_ID_CASH
  shipForm.service_type = null
  shipForm.service_name = ''
  sfExpectMode.value = 'pickup'
  sfPickupLocalStr.value = ''
  shipServiceValue.value = ''
  shipForm.sender.name = ''
  shipForm.sender.mobile = ''
  shipForm.sender.province = ''
  shipForm.sender.city = ''
  shipForm.sender.area = ''
  shipForm.sender.address = ''
  shipInsured.enabled = false
  shipInsured.amountYuan = undefined
}

async function fetchDeliveryList() {
  try {
    const data = await axios.get('/wx/logistics/deliveries', { timeout: 20000 })
    deliveryList.value = Array.isArray(data?.data) ? data.data : []
  } catch (e) {
    deliveryList.value = []
    const msg = e?.response?.data?.error || '获取快递公司列表失败'
    ElMessage.error(msg)
  }
}

function onShipDeliveryChange() {
  shipServiceValue.value = ''
  shipForm.service_type = null
  shipForm.service_name = ''
  if (shipForm.delivery_id === 'SF') {
    sfExpectMode.value = 'pickup'
    sfPickupLocalStr.value = formatDatetimeLocalValue(defaultSfPickupDate())
  } else {
    sfPickupLocalStr.value = ''
  }
}

function onShipServiceChange(val) {
  if (!val || typeof val !== 'string') {
    shipForm.service_type = null
    shipForm.service_name = ''
    return
  }
  const [t, ...rest] = val.split('|||')
  shipForm.service_type = Number(t)
  shipForm.service_name = rest.join('|||')
}

function openShipDialog() {
  if (!selectedOrder.value) return
  shipDialogVisible.value = true
}

function openPathDialog() {
  if (!selectedOrder.value) return
  prefillTrackFormFromStorage(selectedOrder.value.id)
  pathItemList.value = []
  pathQueried.value = false
  pathDialogVisible.value = true
}

function openWaybillDialog() {
  if (!selectedOrder.value) return
  prefillTrackFormFromStorage(selectedOrder.value.id)
  waybillPrintType.value = 0
  revokeWaybillPreview()
  waybillDialogVisible.value = true
}

function revokeWaybillPreview() {
  if (waybillPreviewUrl.value) {
    URL.revokeObjectURL(waybillPreviewUrl.value)
    waybillPreviewUrl.value = ''
  }
}

async function submitShip() {
  if (!selectedOrder.value) return
  if (!shipForm.delivery_id) {
    ElMessage.warning('请选择快递公司')
    return
  }
  if (!shipForm.biz_id?.trim()) {
    ElMessage.warning('请选择客户编码 biz_id')
    return
  }
  if (shipForm.service_type == null || !shipForm.service_name?.trim()) {
    ElMessage.warning('请选择服务类型')
    return
  }
  if (!shipForm.sender.mobile?.trim()) {
    ElMessage.warning('请填写发件人手机')
    return
  }
  if (!shipForm.sender.address?.trim()) {
    ElMessage.warning('请填写发件人详细地址')
    return
  }
  let expectTimeUnix
  if (shipForm.delivery_id === 'SF') {
    if (sfExpectMode.value === 'agreed') {
      expectTimeUnix = 0
    } else {
      if (!sfPickupLocalStr.value?.trim()) {
        ElMessage.warning('请选择顺丰预计上门揽件时间')
        return
      }
      const d = new Date(sfPickupLocalStr.value)
      if (Number.isNaN(d.getTime())) {
        ElMessage.warning('揽件时间无效')
        return
      }
      expectTimeUnix = Math.floor(d.getTime() / 1000)
      if (expectTimeUnix <= Math.floor(Date.now() / 1000)) {
        ElMessage.warning('揽件时间须晚于当前时间')
        return
      }
    }
  }

  let insuredPayload = null
  if (shipInsured.enabled) {
    const yuan = Number(shipInsured.amountYuan)
    if (!Number.isFinite(yuan) || yuan <= 0) {
      ElMessage.warning('开启保价时请填写大于 0 的保价金额（元）')
      return
    }
    insuredPayload = {
      use_insured: 1,
      insured_value: Math.round(yuan * 100),
    }
  }

  const payload = {
    internal_order_id: selectedOrder.value.id,
    delivery_id: shipForm.delivery_id.trim(),
    biz_id: shipForm.biz_id.trim() || LOGISTICS_BIZ_ID_CASH,
    service_type: shipForm.service_type,
    service_name: shipForm.service_name.trim(),
    sender: {
      name: shipForm.sender.name?.trim() || undefined,
      mobile: shipForm.sender.mobile?.trim(),
      province: shipForm.sender.province?.trim() || undefined,
      city: shipForm.sender.city?.trim() || undefined,
      area: shipForm.sender.area?.trim() || undefined,
      address: shipForm.sender.address?.trim(),
    },
    add_source: 0,
  }
  if (shipForm.delivery_id === 'SF') payload.expect_time = expectTimeUnix
  if (insuredPayload) payload.insured = insuredPayload

  shipSubmitting.value = true
  try {
    const res = await axios.post('/wx/logistics/orders', payload, { timeout: 60000 })
    if (res?.waybill_id) {
      saveLastWaybill(selectedOrder.value.id, shipForm.delivery_id.trim(), String(res.waybill_id))
      prefillTrackFormFromStorage(selectedOrder.value.id)
      ElMessage.success(`发货成功，运单号：${res.waybill_id}`)
    } else {
      ElMessage.success('发货请求已提交')
    }
    shipDialogVisible.value = false
  } catch (e) {
    const msg = e?.response?.data?.error || e?.message || '发货失败'
    ElMessage.error(msg)
  } finally {
    shipSubmitting.value = false
  }
}

const PATH_ACTION_MAP = {
  100001: '揽件成功',
  100002: '揽件失败',
  100003: '分配业务员',
  200001: '运输轨迹',
  300002: '开始派送',
  300003: '签收成功',
  300004: '签收失败',
  400001: '订单取消',
  400002: '订单滞留',
}

function pathActionLabel(type) {
  if (type == null) return ''
  return PATH_ACTION_MAP[type] || `类型 ${type}`
}

function formatPathTime(ts) {
  if (ts == null || Number.isNaN(Number(ts))) return ''
  const d = new Date(Number(ts) * 1000)
  return d.toLocaleString('zh-CN')
}

async function fetchPath() {
  if (!selectedOrder.value) return
  if (!trackForm.delivery_id?.trim() || !trackForm.waybill_id?.trim()) {
    ElMessage.warning('请填写快递公司与运单号')
    return
  }
  pathLoading.value = true
  pathQueried.value = true
  pathItemList.value = []
  try {
    const res = await axios.post(
      '/wx/logistics/path',
      {
        internal_order_id: selectedOrder.value.id,
        delivery_id: trackForm.delivery_id.trim(),
        waybill_id: trackForm.waybill_id.trim(),
        add_source: 0,
      },
      { timeout: 25000 },
    )
    const list = Array.isArray(res?.path_item_list) ? res.path_item_list : []
    pathItemList.value = [...list].sort((a, b) => Number(b.action_time) - Number(a.action_time))
    if (!pathItemList.value.length) ElMessage.info('暂无轨迹节点')
  } catch (e) {
    const msg = e?.response?.data?.error || e?.message || '查询轨迹失败'
    ElMessage.error(msg)
  } finally {
    pathLoading.value = false
  }
}

function decodePrintHtmlBase64(b64) {
  if (!b64 || typeof b64 !== 'string') return ''
  try {
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return ''
  }
}

async function fetchWaybill() {
  if (!selectedOrder.value) return
  if (!trackForm.delivery_id?.trim()) {
    ElMessage.warning('请填写快递公司')
    return
  }
  revokeWaybillPreview()
  waybillLoading.value = true
  try {
    const body = {
      internal_order_id: selectedOrder.value.id,
      delivery_id: trackForm.delivery_id.trim(),
      add_source: 0,
      print_type: waybillPrintType.value,
    }
    if (trackForm.waybill_id?.trim()) body.waybill_id = trackForm.waybill_id.trim()
    const res = await axios.post('/wx/logistics/order/get', body, { timeout: 30000 })
    const html = decodePrintHtmlBase64(res?.print_html)
    if (!html) {
      ElMessage.warning('未返回可解码的面单 HTML')
      return
    }
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    waybillPreviewUrl.value = URL.createObjectURL(blob)
  } catch (e) {
    const msg = e?.response?.data?.error || e?.message || '获取面单失败'
    ElMessage.error(msg)
  } finally {
    waybillLoading.value = false
  }
}

function openCancelWaybillDialog() {
  if (!selectedOrder.value) return
  if (!trackForm.delivery_id?.trim() || !trackForm.waybill_id?.trim()) {
    ElMessage.warning('请先填写快递公司与运单号（可与发货记录一致）')
    return
  }
  cancelWaybillDialogOpen.value = true
}

async function confirmCancelWaybill() {
  if (!selectedOrder.value) return
  cancelWaybillSubmitting.value = true
  try {
    await axios.post(
      '/wx/logistics/order/cancel',
      {
        internal_order_id: selectedOrder.value.id,
        delivery_id: trackForm.delivery_id.trim(),
        waybill_id: trackForm.waybill_id.trim(),
        add_source: 0,
      },
      { timeout: 25000 },
    )
    ElMessage.success('取消运单成功')
    cancelWaybillDialogOpen.value = false
  } catch (e) {
    const msg = e?.response?.data?.error || e?.message || '取消运单失败'
    ElMessage.error(msg)
  } finally {
    cancelWaybillSubmitting.value = false
  }
}

const getImageUrl = (url) => {
  if (!url) return ''
  if (isOssPublicUrl(url)) return url
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`
}

function getStatusBadgeVariant(status) {
  const map = {
    SUCCESS: 'default',
    NOTPAY: 'outline',
    REFUND: 'secondary',
    CLOSED: 'destructive',
    REVOKED: 'destructive',
    PAYERROR: 'destructive',
  }
  return map[status] || 'secondary'
}

const getStatusLabel = (status) => {
  const statusMap = {
    SUCCESS: '支付成功',
    NOTPAY: '未支付',
    REFUND: '转入退款',
    CLOSED: '已关闭',
    REVOKED: '已撤销',
    PAYERROR: '支付失败',
  }
  return statusMap[status] || '未知状态'
}

const getTypeLabel = (type) => {
  const typeMap = {
    right: '权益',
    digital: '数字艺术品',
    artwork: '原作',
  }
  return typeMap[type] || type
}

onMounted(() => {
  fetchOrders()
})
</script>
