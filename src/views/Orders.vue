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
            <span class="text-xs text-muted-foreground">支付状态</span>
            <select
              v-model="filters.status"
              class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">全部</option>
              <option value="NOTPAY">未支付</option>
              <option value="SUCCESS">支付成功</option>
              <option value="REFUND">已退款</option>
              <option value="CLOSED">已关闭</option>
              <option value="REVOKED">已撤销</option>
              <option value="PAYERROR">支付失败</option>
            </select>
          </div>
          <div class="flex min-w-[9rem] flex-col gap-1.5">
            <span class="text-xs text-muted-foreground">履约状态</span>
            <select
              v-model="filters.fulfillment"
              class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">全部</option>
              <option value="created">创建订单</option>
              <option value="awaiting_shipment">待发货</option>
              <option value="awaiting_delivery">待交付</option>
              <option value="shipped">已发货</option>
              <option value="in_transit">运输中</option>
              <option value="received">已收货</option>
              <option value="delivered">已交付</option>
              <option value="completed">订单完成</option>
              <option value="refunding">退款中</option>
              <option value="refunded">已退款</option>
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

    <Alert
      v-if="wxTradeMgmtChecked && wxTradeMgmtCompleted === false"
      variant="destructive"
    >
      <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
      <AlertTitle>微信小程序尚未完成交易结算管理确认</AlertTitle>
      <AlertDescription class="mt-1 text-sm leading-relaxed">
        关联商户号的订单需通过发货信息管理服务发货。请登录
        <a
          href="https://mp.weixin.qq.com/"
          target="_blank"
          rel="noopener noreferrer"
          class="underline underline-offset-2"
        >微信公众平台</a>
        完成订单管理授权，或在小程序后台发货信息管理页确认。
      </AlertDescription>
    </Alert>

    <Card v-if="wxTradeMgmtChecked" class="shadow-none ring-1">
      <CardHeader class="pb-3">
        <CardTitle class="text-base">微信发货消息配置</CardTitle>
        <CardDescription>
          设置发货/确认收货消息点击后跳转的小程序页面；平台会自动追加 transaction_id 等参数。
        </CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div class="grid flex-1 gap-2">
            <Label for="wx-jump-path">消息跳转路径 path</Label>
            <Input
              id="wx-jump-path"
              v-model="wxJumpPath"
              placeholder="pages/orders/detail"
              autocomplete="off"
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            :disabled="wxJumpPathSubmitting"
            @click="submitWxJumpPath"
          >
            <Loader2 v-if="wxJumpPathSubmitting" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            保存跳转路径
          </Button>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" @click="openWxOrderListDialog('pending')">
            微信待发货订单
          </Button>
          <Button type="button" variant="outline" size="sm" @click="openWxOrderListDialog()">
            微信订单列表
          </Button>
          <Button type="button" variant="outline" size="sm" @click="openWxCombinedShippingDialog">
            合单发货补录
          </Button>
        </div>
      </CardContent>
    </Card>

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
        <table class="w-full min-w-[1200px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="h-10 w-44 px-3 text-left font-medium">订单号</th>
              <th class="h-10 w-36 px-3 text-left font-medium">用户</th>
              <th class="h-10 min-w-[16rem] px-3 text-left font-medium">商品信息</th>
              <th class="h-10 w-28 px-3 text-left font-medium">订单金额</th>
              <th class="h-10 w-28 px-3 text-left font-medium">实付金额</th>
              <th class="h-10 w-28 px-3 text-left font-medium">支付状态</th>
              <th class="h-10 w-28 px-3 text-left font-medium">履约状态</th>
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
                      :src="getListThumbnailUrl(getImageUrl(item.images[0]))"
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
              <td class="px-3 py-2.5">
                <Badge :variant="getFulfillmentBadgeVariant(row.fulfillment_status?.code)">
                  {{ getFulfillmentLabel(row.fulfillment_status) }}
                </Badge>
              </td>
              <td class="px-3 py-2.5 tabular-nums text-muted-foreground">{{ row.created_at }}</td>
              <td class="px-3 py-2.5 text-right">
                <div class="flex flex-wrap justify-end gap-1.5">
                  <Button
                    v-if="canOrderRefund(row)"
                    size="sm"
                    type="button"
                    variant="destructive"
                    @click="openRefundDialog(row)"
                  >
                    退款
                  </Button>
                  <Button size="sm" type="button" @click="viewOrderDetail(row)">
                    查看详情
                  </Button>
                </div>
              </td>
            </tr>
            <tr v-if="orders.length === 0 && !loading">
              <td colspan="9" class="px-3 py-12 text-center text-muted-foreground">
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
          <div
            v-if="detailLoading"
            class="flex items-center justify-center py-12 text-sm text-muted-foreground"
            aria-busy="true"
          >
            <Loader2 class="mr-2 size-4 animate-spin" aria-hidden="true" />
            加载订单详情…
          </div>
          <template v-else>
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
              <div class="rounded-lg border border-border p-3">
                <div class="text-xs text-muted-foreground">履约状态</div>
                <div class="mt-2">
                  <Badge :variant="getFulfillmentBadgeVariant(selectedOrder.fulfillment_status?.code)">
                    {{ getFulfillmentLabel(selectedOrder.fulfillment_status) }}
                  </Badge>
                </div>
                <p
                  v-if="selectedOrder.fulfillment_status?.hint"
                  class="mt-2 text-xs text-muted-foreground leading-relaxed"
                >
                  {{ selectedOrder.fulfillment_status.hint }}
                </p>
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

          <div v-if="selectedOrder.refunds?.length || canOrderRefund(selectedOrder)" class="rounded-lg border border-border bg-muted/10 p-4">
            <h3 class="mb-2 text-base font-semibold text-foreground">
              退款
            </h3>
            <p class="mb-3 text-sm text-muted-foreground leading-relaxed">
              对已支付成功的订单发起全额退款，将自动提交至微信并恢复库存。
            </p>
            <div v-if="selectedOrder.refunds?.length" class="mb-4 space-y-2">
              <div
                v-for="refund in selectedOrder.refunds"
                :key="refund.id"
                class="rounded-md border border-border bg-background p-3 text-sm"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-xs text-muted-foreground">{{ refund.out_refund_no }}</span>
                  <Badge :variant="getRefundStatusBadgeVariant(refund.status)">
                    {{ getRefundStatusText(refund.status) }}
                  </Badge>
                </div>
                <div class="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <span>退款金额：¥{{ refund.refund_amount_yuan ?? '—' }}</span>
                  <span v-if="refund.reason">原因：{{ refund.reason }}</span>
                  <span v-if="refund.created_at">申请：{{ formatRefundDate(refund.created_at) }}</span>
                </div>
                <div v-if="refund.status === 'PROCESSING'" class="mt-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    :disabled="syncingRefundId === refund.id"
                    @click="syncOrderRefundStatus(refund)"
                  >
                    <Loader2
                      v-if="syncingRefundId === refund.id"
                      class="mr-1.5 size-3.5 animate-spin"
                      aria-hidden="true"
                    />
                    刷新退款状态
                  </Button>
                </div>
              </div>
            </div>
            <Button
              v-if="canOrderRefund(selectedOrder)"
              type="button"
              variant="destructive"
              @click="openRefundDialog(selectedOrder)"
            >
              发起退款
            </Button>
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
                    :src="getListThumbnailUrl(getImageUrl(item.images[0]))"
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
                  <div
                    v-if="item.type === 'digital'"
                    class="mt-4 rounded-lg border border-border bg-muted/10 p-4"
                  >
                    <div class="mb-2 text-sm font-medium text-foreground">
                      数字藏品交付二维码
                    </div>
                    <p class="mb-3 text-xs text-muted-foreground leading-relaxed">
                      用户微信支付成功后，请上传藏品领取二维码；保存后用户可在订单详情与购买记录中查看。
                    </p>
                    <div v-if="!isOrderPaid(selectedOrder)" class="text-sm text-muted-foreground">
                      订单尚未支付成功，暂不可上传。
                    </div>
                    <template v-else>
                      <div v-if="item.qr_code_url || item.delivery_qr_code_url" class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start">
                        <div class="size-28 shrink-0 overflow-hidden rounded-md border border-border bg-background p-1">
                          <img
                            :src="getImageUrl(item.qr_code_url || item.delivery_qr_code_url)"
                            alt="已上传的交付二维码"
                            class="size-full object-contain"
                          >
                        </div>
                        <div class="text-xs text-muted-foreground">
                          <div>已上传</div>
                          <div v-if="item.qr_code_uploaded_at || item.delivery_qr_code_at" class="mt-1 tabular-nums">
                            {{ item.qr_code_uploaded_at || item.delivery_qr_code_at }}
                          </div>
                        </div>
                      </div>
                      <div class="flex flex-wrap items-center gap-2">
                        <input
                          :id="`qr-upload-${item.id}`"
                          type="file"
                          accept="image/*"
                          class="sr-only"
                          :disabled="qrUploadingItemId === item.id"
                          @change="(e) => handleDigitalQrUpload(item, e)"
                        >
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          :disabled="qrUploadingItemId === item.id"
                          @click="triggerQrFileInput(item.id)"
                        >
                          <Loader2
                            v-if="qrUploadingItemId === item.id"
                            class="mr-1.5 size-3.5 animate-spin"
                            aria-hidden="true"
                          />
                          {{ item.qr_code_url || item.delivery_qr_code_url ? '重新上传二维码' : '上传二维码' }}
                        </Button>
                      </div>
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="isOrderLogisticsEligible(selectedOrder)" class="rounded-lg border border-border bg-muted/10 p-4">
            <h3 class="mb-2 text-base font-semibold text-foreground">
              物流（顺丰 + 微信发货管理）
            </h3>
            <p class="mb-3 text-sm text-muted-foreground leading-relaxed">
              含实物且已支付成功时可发货；顺丰下单成功后会自动向微信录入发货信息。
            </p>
            <div v-if="selectedOrder.shipments?.length" class="mb-4 space-y-2">
              <div
                v-for="shipment in selectedOrder.shipments"
                :key="shipment.id || `${shipment.delivery_id}-${shipment.waybill_id}`"
                class="rounded-md border border-border bg-background p-3 text-sm"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{{ shipment.delivery_id }}</Badge>
                  <span v-if="shipment.company_name" class="text-muted-foreground">{{ shipment.company_name }}</span>
                  <Badge :variant="shipment.status === 'active' ? 'default' : 'outline'">
                    {{ shipment.status === 'active' ? '有效' : shipment.status }}
                  </Badge>
                </div>
                <div class="mt-2 font-mono text-xs break-all">
                  运单号：{{ shipment.waybill_id }}
                </div>
                <div v-if="shipment.created_at" class="mt-1 text-xs text-muted-foreground tabular-nums">
                  发货时间：{{ shipment.created_at }}
                </div>
              </div>
            </div>
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

            <div class="mt-4 border-t border-border pt-4">
              <h4 class="mb-2 text-sm font-semibold text-foreground">
                微信小程序发货状态
              </h4>
              <p class="mb-3 text-xs text-muted-foreground leading-relaxed">
                查询微信侧订单发货状态；补录用于顺丰已成功但微信录入失败的情况；确认收货提醒每个订单仅可发送一次。
              </p>

              <div
                v-if="wxOrderShipping.order"
                class="mb-3 rounded-md border border-border bg-background p-3 text-sm"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    {{ wxOrderShipping.order.order_state_label || `状态 ${wxOrderShipping.order.order_state}` }}
                  </Badge>
                  <span
                    v-if="wxOrderShipping.order.in_complaint"
                    class="text-xs text-destructive"
                  >
                    交易纠纷中
                  </span>
                </div>
                <div
                  v-if="wxOrderShipping.order.shipping?.shipping_list?.length"
                  class="mt-2 space-y-1 text-xs text-muted-foreground"
                >
                  <div
                    v-for="(ship, idx) in wxOrderShipping.order.shipping.shipping_list"
                    :key="`${ship.tracking_no}-${idx}`"
                    class="font-mono break-all"
                  >
                    {{ ship.express_company }} · {{ ship.tracking_no }}
                    <span v-if="ship.goods_desc"> · {{ ship.goods_desc }}</span>
                  </div>
                </div>
                <p v-else-if="wxOrderShipping.order.shipping" class="mt-2 text-xs text-muted-foreground">
                  微信侧暂无物流单详情
                </p>
              </div>

              <div class="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  :disabled="wxOrderShippingLoading"
                  @click="fetchWxOrderShippingStatus"
                >
                  <Loader2
                    v-if="wxOrderShippingLoading"
                    class="mr-1.5 size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                  查询微信发货状态
                </Button>
                <Button
                  v-if="selectedOrder.shipments?.length"
                  type="button"
                  variant="outline"
                  size="sm"
                  :disabled="wxUploadShippingSubmitting"
                  @click="submitWxUploadShippingInfo"
                >
                  <Loader2
                    v-if="wxUploadShippingSubmitting"
                    class="mr-1.5 size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                  补录微信发货信息
                </Button>
                <Button
                  v-if="selectedOrder.shipments?.length"
                  type="button"
                  variant="outline"
                  size="sm"
                  @click="openWxConfirmReceiveDialog"
                >
                  确认收货提醒
                </Button>
              </div>
            </div>
          </div>
          </template>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="refundDialogVisible">
      <DialogContent class="max-w-[calc(100%-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>发起退款</DialogTitle>
        </DialogHeader>

        <div class="grid gap-4 py-2">
          <div class="grid gap-1 text-sm">
            <span class="text-muted-foreground">订单号</span>
            <span class="font-mono text-xs break-all">{{ refundForm.out_trade_no }}</span>
          </div>
          <div class="grid gap-1 text-sm">
            <span class="text-muted-foreground">预计退款金额（服务端按微信实付计算）</span>
            <span class="font-medium tabular-nums">¥{{ refundForm.display_payable_yuan }}</span>
          </div>
          <div class="flex flex-col gap-2">
            <Label for="refund-reason">退款原因 <span class="text-destructive">*</span></Label>
            <Textarea
              id="refund-reason"
              v-model="refundForm.reason"
              placeholder="例如：用户申请退款、重复下单等"
              class="min-h-24"
              rows="3"
            />
          </div>
        </div>

        <DialogFooter class="gap-2 sm:justify-end">
          <Button type="button" variant="outline" @click="refundDialogVisible = false">
            取消
          </Button>
          <Button type="button" variant="destructive" :disabled="refundSubmitting" @click="submitOrderRefund">
            <Loader2 v-if="refundSubmitting" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            确认退款
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="shipDialogVisible">
      <DialogContent class="max-h-[92vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>顺丰物流发货</DialogTitle>
        </DialogHeader>

        <div class="grid max-h-[calc(92vh-10rem)] gap-4 overflow-y-auto py-2 pr-1">
          <div class="flex flex-col gap-2">
            <Label>快递公司</Label>
            <Input model-value="顺丰速运（SF）" readonly class="bg-muted" />
          </div>
          <div class="flex flex-col gap-2">
            <Label>付款方式 / 月结卡号</Label>
            <select
              v-model="shipForm.biz_id"
              class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            >
              <option value="SF_CASH">寄方现付（无月结卡）</option>
            </select>
            <p class="text-xs text-muted-foreground">
              沙箱可先选现付；有月结卡时在 .env 配置 SF_MONTHLY_CARD，或后续扩展此下拉。
            </p>
          </div>
          <div class="flex flex-col gap-2">
            <Label>快件产品 <span class="text-destructive">*</span></Label>
            <Select
              :disabled="!serviceTypeOptions.length"
              :model-value="shipServiceValue || undefined"
              @update:model-value="(v) => {
                const s = typeof v === 'string' ? v : ''
                shipServiceValue = s
                onShipServiceChange(s)
              }"
            >
              <SelectTrigger class="w-full">
                <SelectValue placeholder="加载产品中…" />
              </SelectTrigger>
              <SelectContent>
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

          <Separator />
          <div class="text-sm font-medium text-foreground">
            运费时效查询
          </div>
          <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div class="flex flex-1 flex-col gap-2">
              <Label for="ship-weight">预估重量（千克）</Label>
              <Input
                id="ship-weight"
                v-model.number="shipCargoWeight"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="默认 1"
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              class="w-full sm:w-auto"
              :disabled="deliverTmLoading"
              @click="queryShipDeliverTm"
            >
              <Loader2 v-if="deliverTmLoading" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
              查询运费时效
            </Button>
          </div>
          <p class="text-xs text-muted-foreground leading-relaxed">
            根据发件人地址与订单收货地址查询顺丰时效与参考运费；已选快件产品时会按该产品查询，未选则返回默认可选产品列表。
          </p>
          <div v-if="deliverTmList.length" class="space-y-2 rounded-md border border-border bg-muted/20 p-3">
            <div
              v-for="row in deliverTmList"
              :key="`${row.business_type}-${row.business_type_desc}`"
              class="rounded-md border border-border bg-background p-3 text-sm"
            >
              <div class="font-medium text-foreground">
                {{ row.business_type_desc || '快件产品' }}
                <span class="text-muted-foreground">（{{ row.business_type }}）</span>
              </div>
              <div v-if="row.deliver_time" class="mt-1 text-xs text-muted-foreground">
                承诺时效：{{ row.deliver_time }}
              </div>
              <div v-if="row.close_time" class="mt-0.5 text-xs text-muted-foreground">
                截单时间：{{ row.close_time }}
              </div>
              <div class="mt-1 text-sm font-medium tabular-nums text-foreground">
                <template v-if="row.fee != null">参考运费：¥{{ row.fee }}</template>
                <template v-else>未返回价格（可配置月结卡或检查 search_price）</template>
              </div>
            </div>
          </div>
          <div
            v-else-if="deliverTmQueried && !deliverTmLoading"
            class="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground"
          >
            未查询到可用时效产品
          </div>

          <div class="flex flex-col gap-2">
            <Label>上门揽件时间 <span class="text-destructive">*</span></Label>
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
                顺丰下单须传上门揽件时间：须为<strong>晚于当前</strong>的时间；若已与快递员约定取件请选第二项（不传具体时间）。
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
            <p class="text-xs text-muted-foreground">顺丰保价金额单位为元，此处按「元」填写。</p>
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
            <Label for="path-waybill">运单号（可选）</Label>
            <Input id="path-waybill" v-model="trackForm.waybill_id" placeholder="留空则按订单号查询" autocomplete="off" />
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
              <div v-if="it.sf_secondary_status_name || it.sf_first_status_name" class="text-xs font-medium text-foreground">
                {{ it.sf_secondary_status_name || it.sf_first_status_name }}
              </div>
              <div v-else class="text-xs text-muted-foreground">{{ pathActionLabel(it.action_type) }}</div>
              <div class="text-sm text-foreground">{{ it.action_msg }}</div>
              <div v-if="it.sf_accept_address" class="text-xs text-muted-foreground">{{ it.sf_accept_address }}</div>
            </div>
          </div>
          <div v-else-if="pathQueried && !pathLoading" class="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            <p>暂无轨迹数据</p>
            <p v-if="pathEmptyHint" class="mt-2 text-left text-xs leading-relaxed">{{ pathEmptyHint }}</p>
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
            <Label for="wb-waybill">运单号（可选）</Label>
            <Input id="wb-waybill" v-model="trackForm.waybill_id" autocomplete="off" />
          </div>
          <p class="text-xs text-muted-foreground">
            顺丰云打印面单（COM_RECE_CLOUD_PRINT_HTML）；运单号留空时按订单号查询。
          </p>
          <p v-if="waybillPrintSource" class="text-xs text-muted-foreground">
            面单来源：{{ waybillPrintSource === 'cloud_print' ? '云打印 HTML' : '简易预览（云打印失败时回退）' }}
          </p>
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
            确认向顺丰取消该订单运单？将使用当前订单的客户订单号，运单号可选填。
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

    <Dialog v-model:open="wxConfirmReceiveDialogVisible">
      <DialogContent class="max-w-[calc(100%-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>微信确认收货提醒</DialogTitle>
        </DialogHeader>
        <p class="text-sm text-muted-foreground leading-relaxed">
          向买家发送确认收货提醒（每个订单仅可调用一次）。签收时间须晚于发货时间。
        </p>
        <div class="grid gap-2 py-2">
          <Label for="wx-received-time">快递签收时间</Label>
          <Input
            id="wx-received-time"
            v-model="wxConfirmReceiveForm.receivedTimeLocal"
            type="datetime-local"
          />
        </div>
        <DialogFooter class="gap-2 sm:justify-end">
          <Button type="button" variant="outline" @click="wxConfirmReceiveDialogVisible = false">
            取消
          </Button>
          <Button
            type="button"
            :disabled="wxConfirmReceiveSubmitting"
            @click="submitWxConfirmReceive"
          >
            <Loader2
              v-if="wxConfirmReceiveSubmitting"
              class="mr-1.5 size-3.5 animate-spin"
              aria-hidden="true"
            />
            发送提醒
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="wxOrderListDialogVisible">
      <DialogContent class="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>微信订单列表</DialogTitle>
        </DialogHeader>
        <p class="text-sm text-muted-foreground leading-relaxed">
          从微信发货信息管理服务拉取支付单列表，可用于对账或查找待发货订单。
        </p>
        <div class="grid gap-3 py-2 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="wx-list-order-state">微信订单状态</Label>
            <select
              id="wx-list-order-state"
              v-model="wxOrderListForm.order_state"
              class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            >
              <option value="">全部</option>
              <option value="1">待发货</option>
              <option value="2">已发货</option>
              <option value="3">确认收货</option>
              <option value="4">交易完成</option>
              <option value="5">已退款</option>
              <option value="6">资金待结算</option>
            </select>
          </div>
          <div class="grid gap-2">
            <Label for="wx-list-page-size">每页条数</Label>
            <Input
              id="wx-list-page-size"
              v-model.number="wxOrderListForm.page_size"
              type="number"
              min="1"
              max="100"
            />
          </div>
          <div class="grid gap-2">
            <Label for="wx-list-openid">买家 openid（可选）</Label>
            <Input id="wx-list-openid" v-model="wxOrderListForm.openid" autocomplete="off" />
          </div>
          <div class="grid gap-2">
            <Label for="wx-list-begin">支付开始时间（可选）</Label>
            <Input id="wx-list-begin" v-model="wxOrderListForm.beginTimeLocal" type="datetime-local" />
          </div>
          <div class="grid gap-2 sm:col-span-2">
            <Label for="wx-list-end">支付结束时间（可选）</Label>
            <Input id="wx-list-end" v-model="wxOrderListForm.endTimeLocal" type="datetime-local" />
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button type="button" :disabled="wxOrderListLoading" @click="fetchWxOrderList(true)">
            <Loader2 v-if="wxOrderListLoading" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            查询
          </Button>
          <Button
            v-if="wxOrderListHasMore"
            type="button"
            variant="outline"
            :disabled="wxOrderListLoading"
            @click="fetchWxOrderList(false)"
          >
            加载更多
          </Button>
        </div>
        <div v-if="wxOrderListRows.length" class="overflow-x-auto rounded-md border border-border">
          <table class="w-full min-w-[720px] text-sm">
            <thead>
              <tr class="border-b border-border bg-muted/40">
                <th class="h-9 px-3 text-left font-medium">商户订单号</th>
                <th class="h-9 px-3 text-left font-medium">微信状态</th>
                <th class="h-9 px-3 text-left font-medium">金额</th>
                <th class="h-9 px-3 text-left font-medium">支付时间</th>
                <th class="h-9 px-3 text-left font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in wxOrderListRows"
                :key="row.transaction_id || row.merchant_trade_no"
                class="border-b border-border last:border-0"
              >
                <td class="px-3 py-2 font-mono text-xs break-all">{{ row.merchant_trade_no || '—' }}</td>
                <td class="px-3 py-2">
                  <Badge variant="secondary">
                    {{ row.order_state_label || row.order_state }}
                  </Badge>
                </td>
                <td class="px-3 py-2 tabular-nums">
                  {{ row.paid_amount != null ? `¥${(row.paid_amount / 100).toFixed(2)}` : '—' }}
                </td>
                <td class="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                  {{ formatWxPayTime(row.pay_time) }}
                </td>
                <td class="px-3 py-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    @click="searchLocalOrderFromWxRow(row)"
                  >
                    查本地订单
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else-if="wxOrderListQueried && !wxOrderListLoading" class="text-sm text-muted-foreground">
          暂无数据
        </p>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="wxCombinedShippingDialogVisible">
      <DialogContent class="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>微信合单发货信息补录</DialogTitle>
        </DialogHeader>
        <p class="text-sm text-muted-foreground leading-relaxed">
          合单支付场景使用 uploadCombinedShippingInfo。请按微信文档填写 JSON；upload_time 留空则由服务端自动生成。
        </p>
        <div class="grid gap-2 py-2">
          <Label for="wx-combined-json">请求 JSON</Label>
          <Textarea
            id="wx-combined-json"
            v-model="wxCombinedShippingJson"
            class="min-h-[280px] font-mono text-xs"
            spellcheck="false"
          />
        </div>
        <DialogFooter class="gap-2 sm:justify-end">
          <Button type="button" variant="outline" @click="wxCombinedShippingDialogVisible = false">
            取消
          </Button>
          <Button
            type="button"
            :disabled="wxCombinedShippingSubmitting"
            @click="submitWxCombinedShippingInfo"
          >
            <Loader2
              v-if="wxCombinedShippingSubmitting"
              class="mr-1.5 size-3.5 animate-spin"
              aria-hidden="true"
            />
            提交合单发货
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { AlertCircle, Loader2, MapPin } from 'lucide-vue-next'
import axios from '../utils/axios'
import { API_BASE_URL, isOssPublicUrl } from '../config'
import { getListThumbnailUrl } from '@/utils/listImageUrl'
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { uploadImageToWebpLimit5MB } from '../utils/image'

const WAYBILL_STORAGE_KEY = 'admin_orders_last_waybill_v1'
const DELIVERY_ID_SF = 'SF'

function formatSfApiError(e, fallback = '请求失败') {
  const data = e?.response?.data
  if (!data) return e?.message || fallback
  let msg = data.error || fallback
  if (data.sf_error?.suggestion) msg = `${msg}：${data.sf_error.suggestion}`
  return msg
}

function formatWxApiError(e, fallback = '请求失败') {
  const data = e?.response?.data
  if (!data) return e?.message || fallback
  const msg = data.error || data.errmsg || fallback
  if (data.errcode != null) return `${msg}（${data.errcode}）`
  return msg
}

const orders = ref([])
const loading = ref(false)
const listError = ref('')
const detailDialogVisible = ref(false)
const detailLoading = ref(false)
const selectedOrder = ref(null)
const qrUploadingItemId = ref(null)

const refundDialogVisible = ref(false)
const refundSubmitting = ref(false)
const syncingRefundId = ref(null)
const refundForm = reactive({
  orderId: null,
  out_trade_no: '',
  display_payable_yuan: '',
  reason: '',
})

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
const shipCargoWeight = ref(1)
const deliverTmLoading = ref(false)
const deliverTmQueried = ref(false)
const deliverTmList = ref([])
const shipForm = reactive({
  delivery_id: DELIVERY_ID_SF,
  biz_id: 'SF_CASH',
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
  delivery_id: DELIVERY_ID_SF,
  waybill_id: '',
})

const waybillDialogVisible = ref(false)
const waybillLoading = ref(false)
const waybillPreviewUrl = ref('')
const waybillPrintSource = ref('')
const pathEmptyHint = ref('')

const cancelWaybillDialogOpen = ref(false)
const cancelWaybillSubmitting = ref(false)

const wxTradeMgmtChecked = ref(false)
const wxTradeMgmtCompleted = ref(null)
const wxJumpPath = ref('pages/orders/detail')
const wxJumpPathSubmitting = ref(false)

const wxOrderShippingLoading = ref(false)
const wxOrderShipping = ref({ order: null })
const wxUploadShippingSubmitting = ref(false)

const wxConfirmReceiveDialogVisible = ref(false)
const wxConfirmReceiveSubmitting = ref(false)
const wxConfirmReceiveForm = reactive({
  receivedTimeLocal: '',
})

const wxOrderListDialogVisible = ref(false)
const wxOrderListLoading = ref(false)
const wxOrderListQueried = ref(false)
const wxOrderListRows = ref([])
const wxOrderListHasMore = ref(false)
const wxOrderListLastIndex = ref('')
const wxOrderListForm = reactive({
  order_state: '',
  openid: '',
  beginTimeLocal: '',
  endTimeLocal: '',
  page_size: 20,
})

const wxCombinedShippingDialogVisible = ref(false)
const wxCombinedShippingSubmitting = ref(false)
const wxCombinedShippingJson = ref('')

const WX_COMBINED_SHIPPING_TEMPLATE = `{
  "order_key": {
    "order_number_type": 1,
    "mchid": "商户号",
    "out_trade_no": "合单主单号"
  },
  "sub_orders": [
    {
      "order_key": {
        "order_number_type": 1,
        "mchid": "商户号",
        "out_trade_no": "子单01"
      },
      "delivery_mode": 1,
      "logistics_type": 1,
      "shipping_list": [
        {
          "tracking_no": "运单号",
          "express_company": "SF",
          "item_desc": "商品*1",
          "contact": { "receiver_contact": "138****5678" }
        }
      ]
    }
  ],
  "payer": { "openid": "用户openid" }
}`

const filters = reactive({
  keyword: '',
  status: '',
  fulfillment: '',
  type: '',
})

const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0,
})

const totalPages = computed(() => Math.max(1, Math.ceil(pagination.total / pagination.limit)))

watch(detailDialogVisible, (v) => {
  if (!v) {
    selectedOrder.value = null
    wxOrderShipping.value = { order: null }
  }
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
      let rows = response.data.orders || []
      if (filters.fulfillment) {
        rows = rows.filter((row) => row.fulfillment_status?.code === filters.fulfillment)
      }
      orders.value = rows
      pagination.total = filters.fulfillment
        ? rows.length
        : response.data.pagination.total
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
  filters.fulfillment = ''
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

const viewOrderDetail = async (order) => {
  selectedOrder.value = order
  detailDialogVisible.value = true
  detailLoading.value = true
  prefillTrackFormFromOrder(order)
  try {
    await refreshSelectedOrderDetail(order.id)
  } finally {
    detailLoading.value = false
  }
}

function mapDetailItemsToOrderItems(detailItems) {
  return (detailItems || []).map((item) => ({
    ...item,
    address: item.address_snapshot || item.fulfillment?.address_snapshot || item.address || null,
    qr_code_url: item.qr_code_url || item.delivery_qr_code_url,
    delivery_qr_code_url: item.delivery_qr_code_url || item.qr_code_url,
  }))
}

function mergeAdminOrderDetail(listOrder, data) {
  const payStatus = {
    ...(data.pay_status || listOrder.pay_status || {}),
    transaction_id: data.payment?.transaction_id ?? listOrder.pay_status?.transaction_id,
    success_time: data.payment?.success_time ?? listOrder.pay_status?.success_time,
    amount: data.payment?.amount_total_fen != null
      ? { total: data.payment.amount_total_fen, currency: data.payment?.currency || 'CNY' }
      : listOrder.pay_status?.amount,
  }

  return {
    ...listOrder,
    ...data,
    id: listOrder.id,
    user_nickname: listOrder.user_nickname ?? data.order?.user_nickname,
    user_avatar: listOrder.user_avatar ?? data.order?.user_avatar,
    actual_fee: data.fee?.amount_payable_yuan ?? listOrder.actual_fee,
    discount_amount: data.fee?.discount_yuan ?? listOrder.discount_amount,
    total_fee: data.fee?.order_total_before_discount_yuan ?? listOrder.total_fee ?? data.total_fee,
    pay_status: payStatus,
    fulfillment_status: data.fulfillment_status || listOrder.fulfillment_status,
    items: mapDetailItemsToOrderItems(data.detail_items?.length ? data.detail_items : listOrder.items),
    refunds: data.refunds || [],
    shipments: data.shipments || [],
  }
}

function getLatestActiveShipment(order) {
  const list = order?.shipments
  if (!Array.isArray(list) || !list.length) return null
  const active = list.filter((row) => row?.status === 'active' && row?.waybill_id)
  if (!active.length) return list.find((row) => row?.waybill_id) || null
  return active[0]
}

function prefillTrackFormFromOrder(order) {
  const shipment = getLatestActiveShipment(order)
  if (shipment) {
    trackForm.delivery_id = shipment.delivery_id || ''
    trackForm.waybill_id = shipment.waybill_id || ''
    return
  }
  if (order?.id) prefillTrackFormFromStorage(order.id)
}

async function refreshSelectedOrderDetail(orderId) {
  const response = await axios.get(`/wx/pay/admin/orders/${orderId}`)
  if (!response.success || !response.data) {
    throw new Error(response.error || '获取订单详情失败')
  }

  const listOrder = orders.value.find((row) => row.id === orderId) || selectedOrder.value
  selectedOrder.value = mergeAdminOrderDetail(listOrder || { id: orderId }, response.data)
  orders.value = orders.value.map((order) => {
    if (order.id !== orderId) return order
    return {
      ...order,
      fulfillment_status: selectedOrder.value.fulfillment_status,
    }
  })
  prefillTrackFormFromOrder(selectedOrder.value)
  if (isOrderLogisticsEligible(selectedOrder.value)) {
    await fetchWxOrderShippingStatus({ silent: true })
  }
  return selectedOrder.value
}

const BLOCKING_REFUND_STATUSES = ['PENDING', 'APPROVED', 'PROCESSING', 'SUCCESS']

function getOrderTradeState(order) {
  if (!order) return ''
  return order.pay_status?.trade_state || order.trade_state || ''
}

function hasBlockingRefund(order) {
  const refunds = order?.refunds || []
  return refunds.some((refund) => BLOCKING_REFUND_STATUSES.includes(refund.status))
}

function canOrderRefund(order) {
  if (!order) return false
  const state = getOrderTradeState(order)
  if (state !== 'SUCCESS') return false
  if (hasBlockingRefund(order)) return false
  const refundStatus = order.refund_status?.status
  if (refundStatus && BLOCKING_REFUND_STATUSES.includes(refundStatus)) return false
  return true
}

function openRefundDialog(order) {
  if (!canOrderRefund(order)) {
    ElMessage.warning('当前订单不可退款')
    return
  }

  refundForm.orderId = order.id
  refundForm.out_trade_no = order.out_trade_no || ''
  refundForm.display_payable_yuan = String(order.actual_fee ?? order.fee?.amount_payable_yuan ?? '')
  refundForm.reason = ''
  refundDialogVisible.value = true
}

async function submitOrderRefund() {
  if (!refundForm.orderId) return
  const reason = typeof refundForm.reason === 'string' ? refundForm.reason.trim() : ''
  if (!reason) {
    ElMessage.warning('请填写退款原因')
    return
  }

  refundSubmitting.value = true
  try {
    const response = await axios.post(`/wx/pay/admin/orders/${refundForm.orderId}/refund`, {
      reason,
    })

    if (response.success) {
      const status = response.data?.status
      if (status === 'SUCCESS') ElMessage.success('退款已完成')
      else if (status === 'FAILED') ElMessage.warning('微信侧退款失败，请到退款审批页查看')
      else ElMessage.success(response.data?.message || '退款已提交，处理中')

      refundDialogVisible.value = false
      await fetchOrders()
      if (detailDialogVisible.value && selectedOrder.value?.id === refundForm.orderId) {
        detailLoading.value = true
        try {
          await refreshSelectedOrderDetail(refundForm.orderId)
        } finally {
          detailLoading.value = false
        }
      }
    } else {
      ElMessage.error(response.error || '发起退款失败')
    }
  } catch (error) {
    console.error('发起退款失败:', error)
    ElMessage.error(error?.response?.data?.error || error?.message || '发起退款失败')
  } finally {
    refundSubmitting.value = false
  }
}

async function syncOrderRefundStatus(refund) {
  if (!refund?.id) return
  syncingRefundId.value = refund.id
  try {
    const response = await axios.get(`/wx/pay/refund/requests/${refund.id}`)
    if (!response.success) {
      ElMessage.error(response.error || '刷新退款状态失败')
      return
    }

    const nextStatus = response.data?.status
    if (selectedOrder.value?.refunds?.length) {
      selectedOrder.value = {
        ...selectedOrder.value,
        refunds: selectedOrder.value.refunds.map((row) => (
          row.id === refund.id ? { ...row, ...response.data } : row
        )),
      }
    }

    if (nextStatus === 'SUCCESS') {
      ElMessage.success('退款已完成')
      await fetchOrders()
      if (selectedOrder.value?.id) {
        await refreshSelectedOrderDetail(selectedOrder.value.id)
      }
    } else if (nextStatus === 'FAILED') {
      ElMessage.warning('微信侧退款失败')
    } else if (nextStatus === 'PENDING') {
      ElMessage.warning('微信侧未找到退款单，已退回待审批')
    } else {
      ElMessage.info('微信侧仍在处理中，请稍后再试')
    }
  } catch (error) {
    console.error('刷新退款状态失败:', error)
    ElMessage.error('刷新退款状态失败')
  } finally {
    syncingRefundId.value = null
  }
}

function getRefundStatusBadgeVariant(status) {
  const variants = {
    PENDING: 'outline',
    APPROVED: 'default',
    REJECTED: 'destructive',
    PROCESSING: 'secondary',
    SUCCESS: 'default',
    FAILED: 'destructive',
  }
  return variants[status] || 'secondary'
}

function getRefundStatusText(status) {
  const texts = {
    PENDING: '待审批',
    APPROVED: '已批准',
    REJECTED: '已拒绝',
    PROCESSING: '处理中',
    SUCCESS: '退款成功',
    FAILED: '退款失败',
  }
  return texts[status] || status
}

function formatRefundDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleString()
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

function isOrderPaid(order) {
  if (!order) return false
  const state = order.pay_status?.trade_state || order.trade_state
  return state === 'SUCCESS'
}

function triggerQrFileInput(itemId) {
  const input = document.getElementById(`qr-upload-${itemId}`)
  if (input) input.click()
}

function syncOrderItemQrCode(orderId, itemId, payload) {
  const patchItem = (item) => {
    if (!item || item.id !== itemId) return item
    return {
      ...item,
      qr_code_url: payload.qr_code_url,
      delivery_qr_code_url: payload.qr_code_url,
      qr_code_uploaded_at: payload.qr_code_uploaded_at,
      delivery_qr_code_at: payload.qr_code_uploaded_at,
      fulfillment: payload.fulfillment || item.fulfillment,
    }
  }

  if (selectedOrder.value && selectedOrder.value.id === orderId && Array.isArray(selectedOrder.value.items)) {
    selectedOrder.value = {
      ...selectedOrder.value,
      items: selectedOrder.value.items.map(patchItem),
    }
  }

  orders.value = orders.value.map((order) => {
    if (order.id !== orderId || !Array.isArray(order.items)) return order
    return {
      ...order,
      items: order.items.map(patchItem),
    }
  })
}

async function handleDigitalQrUpload(item, event) {
  const file = event?.target?.files?.[0]
  if (!file || !selectedOrder.value || !item?.id) return

  qrUploadingItemId.value = item.id
  try {
    const processedFile = await uploadImageToWebpLimit5MB(file)
    if (!processedFile) return

    const formData = new FormData()
    formData.append('file', processedFile)

    const uploadRes = await axios.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    const uploadedUrl = uploadRes?.url
    if (!uploadedUrl) {
      ElMessage.error('图片上传失败')
      return
    }

    const saveRes = await axios.patch(
      `/wx/pay/admin/orders/${selectedOrder.value.id}/items/${item.id}/qr-code`,
      { qr_code_url: uploadedUrl }
    )

    if (!saveRes?.success) {
      ElMessage.error(saveRes?.error || '保存二维码失败')
      return
    }

    const saved = saveRes.data || {}
    syncOrderItemQrCode(selectedOrder.value.id, item.id, {
      qr_code_url: saved.qr_code_url,
      qr_code_uploaded_at: saved.qr_code_uploaded_at,
      fulfillment: saved.fulfillment,
    })
    await refreshSelectedOrderDetail(selectedOrder.value.id)
    ElMessage.success('二维码已保存，用户可在订单中查看')
  } catch (error) {
    console.error('上传数字藏品二维码失败:', error)
    ElMessage.error(error.response?.data?.error || '上传二维码失败')
  } finally {
    qrUploadingItemId.value = null
    if (event?.target) event.target.value = ''
  }
}

const serviceTypeOptions = computed(() => {
  const d = deliveryList.value.find((x) => String(x.delivery_id) === DELIVERY_ID_SF)
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
  shipForm.delivery_id = DELIVERY_ID_SF
  shipForm.biz_id = 'SF_CASH'
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
  shipCargoWeight.value = 1
  deliverTmList.value = []
  deliverTmQueried.value = false
}

function getShipReceiverAddress(order) {
  const items = order?.items
  if (!Array.isArray(items)) return null
  for (const item of items) {
    const addr = item?.address
    if (!addr) continue
    if (addr.province || addr.city || addr.detail_address || addr.full_address) return addr
  }
  return null
}

function buildShipDeliverTmAddresses() {
  const receiver = getShipReceiverAddress(selectedOrder.value)
  if (!receiver) return { error: '订单无收货地址，无法查询运费时效' }

  const srcProvince = shipForm.sender.province?.trim()
  const srcCity = shipForm.sender.city?.trim()
  const srcAddress = shipForm.sender.address?.trim()
  if (!srcProvince && !srcCity && !srcAddress) {
    return { error: '请先填写发件人省市区或详细地址' }
  }

  const destProvince = receiver.province?.trim()
  const destCity = receiver.city?.trim()
  const destAddress = receiver.detail_address?.trim() || receiver.full_address?.trim()
  if (!destProvince && !destCity && !destAddress) {
    return { error: '订单收货地址不完整，无法查询运费时效' }
  }

  return {
    src_address: {
      province: srcProvince || undefined,
      city: srcCity || undefined,
      district: shipForm.sender.area?.trim() || undefined,
      address: srcAddress || undefined,
    },
    dest_address: {
      province: destProvince || undefined,
      city: destCity || undefined,
      district: receiver.district?.trim() || undefined,
      address: destAddress || undefined,
    },
  }
}

function resolveShipConsignedTimeUnix() {
  if (sfExpectMode.value !== 'pickup' || !sfPickupLocalStr.value?.trim()) return undefined
  const d = new Date(sfPickupLocalStr.value)
  if (Number.isNaN(d.getTime())) return undefined
  return Math.floor(d.getTime() / 1000)
}

async function queryShipDeliverTm() {
  if (!selectedOrder.value) return
  const addresses = buildShipDeliverTmAddresses()
  if (addresses.error) {
    ElMessage.warning(addresses.error)
    return
  }

  const weight = Number(shipCargoWeight.value)
  deliverTmLoading.value = true
  deliverTmQueried.value = true
  deliverTmList.value = []

  try {
    const body = {
      delivery_id: DELIVERY_ID_SF,
      search_price: '1',
      biz_id: shipForm.biz_id?.trim() || 'SF_CASH',
      src_address: addresses.src_address,
      dest_address: addresses.dest_address,
      weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
    }
    if (shipForm.service_type != null) body.business_type = shipForm.service_type
    const consignedTime = resolveShipConsignedTimeUnix()
    if (consignedTime != null) body.consigned_time = consignedTime

    const res = await axios.post('/wx/logistics/query-deliver-tm', body, { timeout: 30000 })
    deliverTmList.value = Array.isArray(res?.deliver_tm_list) ? res.deliver_tm_list : []
    if (!deliverTmList.value.length) {
      ElMessage.info('未查询到可用时效产品')
    }
  } catch (e) {
    ElMessage.error(formatSfApiError(e, '查询运费时效失败'))
  } finally {
    deliverTmLoading.value = false
  }
}

async function fetchDeliveryList() {
  try {
    const data = await axios.get('/wx/logistics/deliveries', { timeout: 20000 })
    deliveryList.value = Array.isArray(data?.data) ? data.data : []
    if (!data?.configured) {
      ElMessage.warning(data?.error || '顺丰接口未配置，请在 .env 填写 SF_PARTNER_ID 与 SF_CHECK_WORD')
    }
    shipForm.delivery_id = DELIVERY_ID_SF
    if (!shipForm.service_type && serviceTypeOptions.value.length) {
      const first = serviceTypeOptions.value[0]
      shipForm.service_type = first.service_type
      shipForm.service_name = first.service_name
      shipServiceValue.value = `${first.service_type}|||${first.service_name}`
    }
    sfExpectMode.value = 'pickup'
    sfPickupLocalStr.value = formatDatetimeLocalValue(defaultSfPickupDate())
  } catch (e) {
    deliveryList.value = []
    const msg = e?.response?.data?.error || '获取顺丰产品列表失败'
    ElMessage.error(msg)
  }
}

function onShipDeliveryChange() {
  shipServiceValue.value = ''
  shipForm.service_type = null
  shipForm.service_name = ''
  sfExpectMode.value = 'pickup'
  sfPickupLocalStr.value = formatDatetimeLocalValue(defaultSfPickupDate())
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
  deliverTmList.value = []
  deliverTmQueried.value = false
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
  revokeWaybillPreview()
  waybillDialogVisible.value = true
}

function revokeWaybillPreview() {
  if (waybillPreviewUrl.value) {
    URL.revokeObjectURL(waybillPreviewUrl.value)
    waybillPreviewUrl.value = ''
  }
  waybillPrintSource.value = ''
}

async function submitShip() {
  if (!selectedOrder.value) return
  if (shipForm.service_type == null || !shipForm.service_name?.trim()) {
    ElMessage.warning('请选择快件产品')
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
  if (sfExpectMode.value === 'agreed') {
    expectTimeUnix = 0
  } else {
    if (!sfPickupLocalStr.value?.trim()) {
      ElMessage.warning('请选择预计上门揽件时间')
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
    delivery_id: DELIVERY_ID_SF,
    delivery_name: '顺丰速运',
    biz_id: shipForm.biz_id.trim() || 'SF_CASH',
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
    expect_time: expectTimeUnix,
  }
  if (insuredPayload) payload.insured = insuredPayload

  shipSubmitting.value = true
  try {
    const res = await axios.post('/wx/logistics/orders', payload, { timeout: 60000 })
    if (res?.waybill_id) {
      saveLastWaybill(selectedOrder.value.id, DELIVERY_ID_SF, String(res.waybill_id))
      ElMessage.success(`发货成功，运单号：${res.waybill_id}`)
      if (res.filter_warning) ElMessage.warning(res.filter_warning)
      if (res.shipment_persisted === false) {
        ElMessage.warning('运单号未能写入数据库，请联系管理员检查 order_shipments 表')
      }
      if (res.wx_shipping_upload?.ok === false) {
        ElMessage.warning(`微信发货信息录入失败：${res.wx_shipping_upload.error || '请稍后在「补录发货信息」重试'}`)
      }
    } else {
      ElMessage.success('发货请求已提交')
    }
    shipDialogVisible.value = false
    await refreshSelectedOrderDetail(selectedOrder.value.id)
  } catch (e) {
    ElMessage.error(formatSfApiError(e, '发货失败'))
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
  if (!trackForm.delivery_id?.trim()) {
    ElMessage.warning('请填写快递公司')
    return
  }
  pathLoading.value = true
  pathQueried.value = true
  pathItemList.value = []
  pathEmptyHint.value = ''
  try {
    const body = {
      internal_order_id: selectedOrder.value.id,
      delivery_id: trackForm.delivery_id.trim() || DELIVERY_ID_SF,
    }
    if (trackForm.waybill_id?.trim()) {
      body.waybill_id = trackForm.waybill_id.trim()
    } else {
      body.tracking_type = 2
    }
    const res = await axios.post('/wx/logistics/path', body, { timeout: 25000 })
    const list = Array.isArray(res?.path_item_list) ? res.path_item_list : []
    pathItemList.value = [...list].sort((a, b) => Number(b.action_time) - Number(a.action_time))
    if (!pathItemList.value.length) {
      pathEmptyHint.value = res?.routes_empty_hint || ''
      ElMessage.info(pathEmptyHint.value || '暂无轨迹节点')
    }
  } catch (e) {
    ElMessage.error(formatSfApiError(e, '查询轨迹失败'))
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
      delivery_id: trackForm.delivery_id.trim() || DELIVERY_ID_SF,
    }
    if (trackForm.waybill_id?.trim()) body.waybill_id = trackForm.waybill_id.trim()
    const res = await axios.post('/wx/logistics/order/get', body, { timeout: 30000 })
    const html = decodePrintHtmlBase64(res?.print_html)
    if (!html) {
      ElMessage.warning('未返回可解码的面单 HTML')
      return
    }
    waybillPrintSource.value = res?.print_source || ''
    if (res?.cloud_print_error && res?.print_source !== 'cloud_print') {
      ElMessage.warning(`云打印失败，已回退简易预览：${res.cloud_print_error}`)
    }
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    waybillPreviewUrl.value = URL.createObjectURL(blob)
  } catch (e) {
    ElMessage.error(formatSfApiError(e, '获取面单失败'))
  } finally {
    waybillLoading.value = false
  }
}

function openCancelWaybillDialog() {
  if (!selectedOrder.value) return
  cancelWaybillDialogOpen.value = true
}

async function confirmCancelWaybill() {
  if (!selectedOrder.value) return
  cancelWaybillSubmitting.value = true
  try {
    const body = {
      internal_order_id: selectedOrder.value.id,
      delivery_id: trackForm.delivery_id.trim() || DELIVERY_ID_SF,
    }
    if (trackForm.waybill_id?.trim()) body.waybill_id = trackForm.waybill_id.trim()
    await axios.post('/wx/logistics/order/cancel', body, { timeout: 25000 })
    ElMessage.success('取消运单成功')
    cancelWaybillDialogOpen.value = false
    await refreshSelectedOrderDetail(selectedOrder.value.id)
  } catch (e) {
    ElMessage.error(formatSfApiError(e, '取消运单失败'))
  } finally {
    cancelWaybillSubmitting.value = false
  }
}

async function fetchWxTradeManagementStatus() {
  try {
    const res = await axios.post('/wx/logistics/wechat-order/is-trade-management-completed', {}, { timeout: 15000 })
    wxTradeMgmtCompleted.value = res?.completed === true
  } catch {
    wxTradeMgmtCompleted.value = null
  } finally {
    wxTradeMgmtChecked.value = true
  }
}

async function submitWxJumpPath() {
  const path = wxJumpPath.value?.trim()
  if (!path) {
    ElMessage.warning('请填写消息跳转路径')
    return
  }
  wxJumpPathSubmitting.value = true
  try {
    await axios.post('/wx/logistics/wechat-order/set-msg-jump-path', { path }, { timeout: 15000 })
    ElMessage.success('消息跳转路径已保存')
  } catch (e) {
    ElMessage.error(formatWxApiError(e, '保存跳转路径失败'))
  } finally {
    wxJumpPathSubmitting.value = false
  }
}

async function fetchWxOrderShippingStatus(options = {}) {
  const silent = options.silent === true
  if (!selectedOrder.value?.id) return
  wxOrderShippingLoading.value = true
  try {
    const res = await axios.post(
      '/wx/logistics/wechat-order/get',
      { internal_order_id: selectedOrder.value.id },
      { timeout: 15000 },
    )
    wxOrderShipping.value = { order: res?.order || null }
    if (!silent) {
      if (res?.order?.order_state_label) {
        ElMessage.success(`微信发货状态：${res.order.order_state_label}`)
      } else {
        ElMessage.success('已查询微信发货状态')
      }
    }
  } catch (e) {
    wxOrderShipping.value = { order: null }
    if (!silent) ElMessage.error(formatWxApiError(e, '查询微信发货状态失败'))
  } finally {
    wxOrderShippingLoading.value = false
  }
}

async function submitWxUploadShippingInfo() {
  if (!selectedOrder.value?.id) return
  wxUploadShippingSubmitting.value = true
  try {
    await axios.post(
      '/wx/logistics/upload-shipping-info',
      { internal_order_id: selectedOrder.value.id },
      { timeout: 20000 },
    )
    ElMessage.success('微信发货信息补录成功')
    await fetchWxOrderShippingStatus({ silent: true })
  } catch (e) {
    ElMessage.error(formatWxApiError(e, '补录微信发货信息失败'))
  } finally {
    wxUploadShippingSubmitting.value = false
  }
}

function openWxConfirmReceiveDialog() {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  wxConfirmReceiveForm.receivedTimeLocal = now.toISOString().slice(0, 16)
  wxConfirmReceiveDialogVisible.value = true
}

async function submitWxConfirmReceive() {
  if (!selectedOrder.value?.id) return
  if (!wxConfirmReceiveForm.receivedTimeLocal?.trim()) {
    ElMessage.warning('请选择签收时间')
    return
  }
  const receivedDate = new Date(wxConfirmReceiveForm.receivedTimeLocal)
  if (Number.isNaN(receivedDate.getTime())) {
    ElMessage.warning('签收时间无效')
    return
  }
  wxConfirmReceiveSubmitting.value = true
  try {
    await axios.post(
      '/wx/logistics/wechat-order/notify-confirm-receive',
      {
        internal_order_id: selectedOrder.value.id,
        received_time: Math.floor(receivedDate.getTime() / 1000),
      },
      { timeout: 15000 },
    )
    ElMessage.success('确认收货提醒已发送')
    wxConfirmReceiveDialogVisible.value = false
    await fetchWxOrderShippingStatus({ silent: true })
  } catch (e) {
    ElMessage.error(formatWxApiError(e, '发送确认收货提醒失败'))
  } finally {
    wxConfirmReceiveSubmitting.value = false
  }
}

function formatWxPayTime(ts) {
  if (ts == null || Number.isNaN(Number(ts))) return '—'
  return new Date(Number(ts) * 1000).toLocaleString('zh-CN')
}

function buildWxOrderListRequestBody(reset) {
  const body = {
    page_size: Number(wxOrderListForm.page_size) > 0 ? Number(wxOrderListForm.page_size) : 20,
  }
  if (wxOrderListForm.order_state) body.order_state = Number(wxOrderListForm.order_state)
  if (wxOrderListForm.openid?.trim()) body.openid = wxOrderListForm.openid.trim()
  if (!reset && wxOrderListLastIndex.value) body.last_index = wxOrderListLastIndex.value

  const payTimeRange = {}
  if (wxOrderListForm.beginTimeLocal) {
    payTimeRange.begin_time = Math.floor(new Date(wxOrderListForm.beginTimeLocal).getTime() / 1000)
  }
  if (wxOrderListForm.endTimeLocal) {
    payTimeRange.end_time = Math.floor(new Date(wxOrderListForm.endTimeLocal).getTime() / 1000)
  }
  if (Object.keys(payTimeRange).length) body.pay_time_range = payTimeRange
  return body
}

function openWxOrderListDialog(preset) {
  wxOrderListForm.order_state = preset === 'pending' ? '1' : ''
  wxOrderListDialogVisible.value = true
  wxOrderListRows.value = []
  wxOrderListLastIndex.value = ''
  wxOrderListHasMore.value = false
  wxOrderListQueried.value = false
  if (preset === 'pending') fetchWxOrderList(true)
}

async function fetchWxOrderList(reset = true) {
  wxOrderListLoading.value = true
  try {
    const res = await axios.post(
      '/wx/logistics/wechat-order/list',
      buildWxOrderListRequestBody(reset),
      { timeout: 20000 },
    )
    const list = Array.isArray(res?.order_list) ? res.order_list : []
    wxOrderListRows.value = reset ? list : [...wxOrderListRows.value, ...list]
    wxOrderListHasMore.value = res?.has_more === true
    wxOrderListLastIndex.value = res?.last_index || ''
    wxOrderListQueried.value = true
    if (reset) ElMessage.success(`已加载 ${list.length} 条微信订单`)
  } catch (e) {
    ElMessage.error(formatWxApiError(e, '查询微信订单列表失败'))
  } finally {
    wxOrderListLoading.value = false
  }
}

function searchLocalOrderFromWxRow(row) {
  const keyword = row?.merchant_trade_no || row?.transaction_id || ''
  if (!keyword) {
    ElMessage.warning('该行缺少可搜索的订单号')
    return
  }
  filters.keyword = keyword
  wxOrderListDialogVisible.value = false
  pagination.page = 1
  fetchOrders()
  ElMessage.info(`已在本地订单中搜索：${keyword}`)
}

function openWxCombinedShippingDialog() {
  if (!wxCombinedShippingJson.value?.trim()) {
    wxCombinedShippingJson.value = WX_COMBINED_SHIPPING_TEMPLATE
  }
  wxCombinedShippingDialogVisible.value = true
}

async function submitWxCombinedShippingInfo() {
  const raw = wxCombinedShippingJson.value?.trim()
  if (!raw) {
    ElMessage.warning('请填写合单发货 JSON')
    return
  }
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    ElMessage.error('JSON 格式无效')
    return
  }
  if (!payload?.order_key || !Array.isArray(payload?.sub_orders) || !payload.sub_orders.length) {
    ElMessage.warning('须包含 order_key 与 sub_orders')
    return
  }
  wxCombinedShippingSubmitting.value = true
  try {
    await axios.post('/wx/logistics/upload-combined-shipping-info', payload, { timeout: 25000 })
    ElMessage.success('合单发货信息已提交')
    wxCombinedShippingDialogVisible.value = false
  } catch (e) {
    ElMessage.error(formatWxApiError(e, '合单发货信息提交失败'))
  } finally {
    wxCombinedShippingSubmitting.value = false
  }
}

const getImageUrl = (url) => {
  if (!url) return ''
  if (isOssPublicUrl(url)) return url
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`
}

function getFulfillmentBadgeVariant(code) {
  const map = {
    created: 'outline',
    awaiting_payment: 'outline',
    payment_failed: 'destructive',
    awaiting_shipment: 'secondary',
    awaiting_delivery: 'secondary',
    shipped: 'default',
    in_transit: 'default',
    received: 'default',
    delivered: 'default',
    completed: 'default',
    cancelled: 'destructive',
    closed: 'destructive',
    refunding: 'outline',
    refunded: 'secondary',
  }
  return map[code] || 'secondary'
}

function getFulfillmentLabel(fulfillment) {
  if (!fulfillment) return '—'
  if (fulfillment.text) return fulfillment.text
  const map = {
    created: '创建订单',
    awaiting_payment: '待支付',
    payment_failed: '支付失败',
    awaiting_shipment: '待发货',
    awaiting_delivery: '待交付',
    shipped: '已发货',
    in_transit: '运输中',
    received: '已收货',
    delivered: '已交付',
    completed: '订单完成',
    cancelled: '已撤销',
    closed: '已关闭',
    refunding: '退款中',
    refunded: '已退款',
  }
  return map[fulfillment.code] || '未知状态'
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
    REFUND: '已退款',
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
  fetchWxTradeManagementStatus()
})
</script>
