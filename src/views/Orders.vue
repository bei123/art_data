<template>
  <div>
    <div class="header">
      <h3>订单管理</h3>
      <div class="filters">
        <el-input
          v-model="filters.keyword"
          class="filter-search"
          placeholder="订单号、微信交易号、用户昵称、订单摘要或用户ID"
          clearable
          style="width: 280px; margin-right: 10px;"
          aria-label="搜索订单"
          @clear="handleSearch"
          @keyup.enter="handleSearch"
        />
        <el-select v-model="filters.status" placeholder="订单状态" clearable style="width: 150px; margin-right: 10px;">
          <el-option label="全部" value="" />
          <el-option label="未支付" value="NOTPAY" />
          <el-option label="支付成功" value="SUCCESS" />
          <el-option label="转入退款" value="REFUND" />
          <el-option label="已关闭" value="CLOSED" />
          <el-option label="已撤销" value="REVOKED" />
          <el-option label="支付失败" value="PAYERROR" />
        </el-select>
        <el-select v-model="filters.type" placeholder="商品类型" clearable style="width: 150px; margin-right: 10px;">
          <el-option label="全部" value="" />
          <el-option label="权益" value="right" />
          <el-option label="数字艺术品" value="digital" />
          <el-option label="原作" value="artwork" />
        </el-select>
        <el-button type="primary" @click="handleSearch">查询</el-button>
        <el-button @click="resetFilters">重置</el-button>
      </div>
    </div>

    <el-alert
      v-if="listError && !loading"
      class="list-state-alert"
      type="error"
      :closable="false"
      show-icon
      role="alert"
      :title="listError"
    >
      <el-button type="primary" link @click="retryFetchOrders">重试</el-button>
    </el-alert>

    <div v-loading="loading" class="table-wrap">
    <el-table :data="orders" style="width: 100%">
        <template #empty>
          <el-empty v-if="!loading" description="暂无订单数据" />
        </template>
      <el-table-column prop="out_trade_no" label="订单号" width="180" />
      <el-table-column label="用户信息" width="150">
        <template #default="{ row }">
          <div class="user-info">
            <el-avatar :size="30" :src="row.user_avatar" :alt="row.user_nickname ? `${row.user_nickname} 头像` : ''" />
            <span class="user-nickname">{{ row.user_nickname || '未知用户' }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="商品信息" min-width="300">
        <template #default="{ row }">
          <div v-for="item in row.items" :key="item.id" class="order-item">
            <el-image
              lazy
              v-if="item.images && item.images.length > 0"
              :src="getImageUrl(item.images[0])"
              style="width: 50px; height: 50px; margin-right: 10px;"
              fit="cover"
              :alt="item.title ? `商品：${item.title}` : '商品图'"
            />
            <div class="item-info">
              <div class="item-title">{{ item.title }}</div>
              <div class="item-details">
                <span class="item-type">{{ getTypeLabel(item.type) }}</span>
                <span class="item-quantity">x{{ item.quantity }}</span>
                <span class="item-price">¥{{ item.price }}</span>
              </div>
              <!-- 地址信息显示 -->
              <div v-if="item.address" class="item-address">
                <el-icon><Location /></el-icon>
                <span class="address-text">{{ item.address.receiver_name }} {{ item.address.receiver_phone }}</span>
                <span class="address-detail">{{ item.address.full_address }}</span>
              </div>
              <div v-else class="item-address no-address">
                <el-icon><Location /></el-icon>
                <span class="address-text">无地址信息</span>
              </div>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="total_fee" label="订单金额" width="120">
        <template #default="{ row }">
          <span class="price">¥{{ row.total_fee }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="actual_fee" label="实付金额" width="120">
        <template #default="{ row }">
          <span class="price">¥{{ row.actual_fee }}</span>
        </template>
      </el-table-column>
      <el-table-column label="支付状态" width="120">
        <template #default="{ row }">
          <el-tag :type="getStatusType(row.pay_status.trade_state)">
            {{ getStatusLabel(row.pay_status.trade_state) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="180" />
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" size="small" @click="viewOrderDetail(row)">查看详情</el-button>
        </template>
      </el-table-column>
    </el-table>
    </div>

    <div class="pagination-wrapper">
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.limit"
        :page-sizes="[10, 20, 50, 100]"
        :total="pagination.total"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="handleSizeChange"
        @current-change="handleCurrentChange"
      />
    </div>

    <!-- 订单详情对话框 -->
    <el-dialog
      v-model="detailDialogVisible"
      title="订单详情"
      width="60%"
      :before-close="handleDetailClose"
    >
      <div v-if="selectedOrder" class="order-detail">
        <div class="detail-section">
          <h4>订单信息</h4>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="订单号">{{ selectedOrder.out_trade_no }}</el-descriptions-item>
            <el-descriptions-item label="创建时间">{{ selectedOrder.created_at }}</el-descriptions-item>
            <el-descriptions-item label="用户信息">
              <div class="user-detail-info">
                <el-avatar :size="40" :src="selectedOrder.user_avatar" />
                <span>{{ selectedOrder.user_nickname || '未知用户' }}</span>
              </div>
            </el-descriptions-item>
            <el-descriptions-item label="订单金额">¥{{ selectedOrder.total_fee }}</el-descriptions-item>
            <el-descriptions-item label="实付金额">¥{{ selectedOrder.actual_fee }}</el-descriptions-item>
            <el-descriptions-item label="抵扣金额">¥{{ selectedOrder.discount_amount || 0 }}</el-descriptions-item>
            <el-descriptions-item label="支付状态">
              <el-tag :type="getStatusType(selectedOrder.pay_status.trade_state)">
                {{ getStatusLabel(selectedOrder.pay_status.trade_state) }}
              </el-tag>
            </el-descriptions-item>
          </el-descriptions>
        </div>

        <div class="detail-section">
          <h4>支付信息</h4>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="交易状态">{{ selectedOrder.pay_status.trade_state_desc }}</el-descriptions-item>
            <el-descriptions-item label="交易ID">{{ selectedOrder.pay_status.transaction_id || '-' }}</el-descriptions-item>
            <el-descriptions-item label="支付时间">{{ selectedOrder.pay_status.success_time || '-' }}</el-descriptions-item>
            <el-descriptions-item label="支付金额">
              {{ selectedOrder.pay_status.amount ? `¥${selectedOrder.pay_status.amount.total / 100}` : '-' }}
            </el-descriptions-item>
          </el-descriptions>
        </div>

        <div class="detail-section">
          <h4>商品信息</h4>
          <div v-for="item in selectedOrder.items" :key="item.id" class="detail-item">
            <div class="item-header">
              <el-image
                lazy
                v-if="item.images && item.images.length > 0"
                :src="getImageUrl(item.images[0])"
                style="width: 80px; height: 80px;"
                fit="cover"
                :alt="item.title ? `商品：${item.title}` : '商品图'"
              />
              <div class="item-content">
                <h5>{{ item.title }}</h5>
                <p class="item-description">{{ item.description }}</p>
                <div class="item-meta">
                  <span class="item-type">{{ getTypeLabel(item.type) }}</span>
                  <span class="item-quantity">数量: {{ item.quantity }}</span>
                  <span class="item-price">单价: ¥{{ item.price }}</span>
                </div>
                <!-- 地址信息显示 -->
                <div v-if="item.address" class="item-address-detail">
                  <h6>收货地址</h6>
                  <el-descriptions :column="1" border size="small">
                    <el-descriptions-item label="收货人">{{ item.address.receiver_name }}</el-descriptions-item>
                    <el-descriptions-item label="联系电话">{{ item.address.receiver_phone }}</el-descriptions-item>
                    <el-descriptions-item label="收货地址">{{ item.address.full_address }}</el-descriptions-item>
                    <el-descriptions-item label="是否默认地址">
                      <el-tag :type="item.address.is_default ? 'success' : 'info'" size="small">
                        {{ item.address.is_default ? '默认地址' : '普通地址' }}
                      </el-tag>
                    </el-descriptions-item>
                  </el-descriptions>
                </div>
                <div v-else class="item-address-detail no-address">
                  <h6>收货地址</h6>
                  <el-empty description="无地址信息" :image-size="60" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="isOrderLogisticsEligible(selectedOrder)"
          class="detail-section logistics-section"
        >
          <h4>物流（微信物流助手）</h4>
          <p class="logistics-tip">
            含实物且已支付成功时可发货；轨迹与面单需填写与下单一致的快递公司与运单号。本页成功发货后会暂存运单号便于查询。
          </p>
          <el-space wrap>
            <el-button type="primary" @click="openShipDialog">发货</el-button>
            <el-button @click="openPathDialog">查询轨迹</el-button>
            <el-button @click="openWaybillDialog">面单</el-button>
            <el-button type="danger" plain @click="handleCancelWaybill">取消运单</el-button>
          </el-space>
        </div>
      </div>
    </el-dialog>

    <!-- 发货 -->
    <el-dialog
      v-model="shipDialogVisible"
      title="微信物流发货"
      width="720px"
      destroy-on-close
      @open="onShipDialogOpen"
    >
      <el-form label-width="110px" class="ship-form">
        <el-form-item label="快递公司" required>
          <el-select
            v-model="shipForm.delivery_id"
            placeholder="请选择"
            filterable
            style="width: 100%"
            @change="onShipDeliveryChange"
          >
            <el-option
              v-for="d in deliveryList"
              :key="d.delivery_id"
              :label="`${d.delivery_name}（${d.delivery_id}）`"
              :value="d.delivery_id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="客户编码 biz_id" required>
          <el-select v-model="shipForm.biz_id" style="width: 100%" :teleported="true">
            <el-option label="现付客户编码（SF_CASH）" value="SF_CASH" />
          </el-select>
          <div class="field-hint">暂固定为微信物流现付客户编码；与运力侧绑定一致即可。</div>
        </el-form-item>
        <el-form-item label="服务类型" required>
          <el-select
            v-model="shipServiceValue"
            placeholder="先选快递公司"
            style="width: 100%"
            :disabled="!shipForm.delivery_id || !serviceTypeOptions.length"
            @change="onShipServiceChange"
          >
            <el-option
              v-for="(s, idx) in serviceTypeOptions"
              :key="`${s.service_type}-${idx}`"
              :label="`${s.service_name}（${s.service_type}）`"
              :value="`${s.service_type}|||${s.service_name}`"
            />
          </el-select>
        </el-form-item>
        <el-form-item v-if="shipForm.delivery_id === 'SF'" label="顺丰揽件时间" required>
          <el-radio-group v-model="sfExpectMode" class="sf-expect-mode">
            <el-radio label="pickup">选择预计上门揽件时间</el-radio>
            <el-radio label="agreed">已与网点/客户约定取件（传 0）</el-radio>
          </el-radio-group>
          <el-date-picker
            v-if="sfExpectMode === 'pickup'"
            v-model="sfPickupAt"
            type="datetime"
            placeholder="选择日期与时间"
            style="width: 100%; margin-top: 10px"
            format="YYYY-MM-DD HH:mm"
            :disabled-date="disabledSfPickupDate"
            :disabled-time="disabledSfPickupTime"
          />
          <div class="field-hint">
            微信要求顺丰必传 expect_time：选时间须为<strong>晚于当前</strong>的 Unix 秒；若已由快递员约定时间请选第二项传 0。
          </div>
        </el-form-item>
        <el-divider content-position="left">保价（可选）</el-divider>
        <el-form-item label="是否保价">
          <el-switch
            v-model="shipInsured.enabled"
            active-text="保价"
            inactive-text="不保价"
          />
        </el-form-item>
        <el-form-item v-if="shipInsured.enabled" label="保价金额（元）" required>
          <el-input-number
            v-model="shipInsured.amountYuan"
            :min="0.01"
            :max="999999"
            :precision="2"
            :step="10"
            controls-position="right"
            style="width: 100%"
            placeholder="如 100 表示保价 100 元"
          />
          <div class="field-hint">微信侧保额单位为「分」，此处按「元」填写，提交时自动换算。</div>
        </el-form-item>
        <el-divider content-position="left">发件人</el-divider>
        <el-form-item label="姓名">
          <el-input v-model="shipForm.sender.name" />
        </el-form-item>
        <el-form-item label="手机" required>
          <el-input v-model="shipForm.sender.mobile" placeholder="与电话至少填一项" />
        </el-form-item>
        <el-form-item label="省市区">
          <el-input v-model="shipForm.sender.province" placeholder="省" style="width: 32%; margin-right: 2%" />
          <el-input v-model="shipForm.sender.city" placeholder="市" style="width: 32%; margin-right: 2%" />
          <el-input v-model="shipForm.sender.area" placeholder="区/县" style="width: 32%" />
        </el-form-item>
        <el-form-item label="详细地址" required>
          <el-input v-model="shipForm.sender.address" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="shipDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="shipSubmitting" @click="submitShip">提交发货</el-button>
      </template>
    </el-dialog>

    <!-- 轨迹 -->
    <el-dialog
      v-model="pathDialogVisible"
      title="运单轨迹"
      width="560px"
      destroy-on-close
    >
      <el-form label-width="100px" class="mini-form">
        <el-form-item label="快递公司">
          <el-input v-model="trackForm.delivery_id" placeholder="如 SF" />
        </el-form-item>
        <el-form-item label="运单号">
          <el-input v-model="trackForm.waybill_id" placeholder="发货成功返回的运单号" />
        </el-form-item>
      </el-form>
      <el-button type="primary" :loading="pathLoading" @click="fetchPath">查询</el-button>
      <div v-if="pathItemList.length" class="path-timeline-wrap">
        <el-timeline>
          <el-timeline-item
            v-for="(it, idx) in pathItemList"
            :key="idx"
            :timestamp="formatPathTime(it.action_time)"
            placement="top"
          >
            <div class="path-type">{{ pathActionLabel(it.action_type) }}</div>
            <div class="path-msg">{{ it.action_msg }}</div>
          </el-timeline-item>
        </el-timeline>
      </div>
      <el-empty v-else-if="pathQueried && !pathLoading" description="暂无轨迹数据" />
    </el-dialog>

    <!-- 面单 -->
    <el-dialog
      v-model="waybillDialogVisible"
      title="运单面单"
      width="640px"
      destroy-on-close
      @closed="revokeWaybillPreview"
    >
      <el-form label-width="100px" class="mini-form">
        <el-form-item label="快递公司">
          <el-input v-model="trackForm.delivery_id" />
        </el-form-item>
        <el-form-item label="运单号">
          <el-input v-model="trackForm.waybill_id" />
        </el-form-item>
        <el-form-item label="面单类型">
          <el-radio-group v-model="waybillPrintType">
            <el-radio :label="0">二联单</el-radio>
            <el-radio :label="1">一联单</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <el-button type="primary" :loading="waybillLoading" @click="fetchWaybill">获取面单</el-button>
      <div v-if="waybillPreviewUrl" class="waybill-preview">
        <iframe title="面单预览" :src="waybillPreviewUrl" class="waybill-iframe" />
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, reactive, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import axios from '../utils/axios'
import { API_BASE_URL, isOssPublicUrl } from '../config'
import { Location } from '@element-plus/icons-vue'

const WAYBILL_STORAGE_KEY = 'admin_orders_last_waybill_v1'
/** 现付客户编码（与微信物流助手运力配置一致） */
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
/** 顺丰：pickup=用户选日期时间转 Unix 秒；agreed=传 0（已约定取件） */
const sfExpectMode = ref('pickup')
const sfPickupAt = ref(null)
const shipInsured = reactive({
  enabled: false,
  amountYuan: undefined
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
    address: ''
  }
})

const pathDialogVisible = ref(false)
const pathLoading = ref(false)
const pathQueried = ref(false)
const pathItemList = ref([])
const trackForm = reactive({
  delivery_id: '',
  waybill_id: ''
})

const waybillDialogVisible = ref(false)
const waybillLoading = ref(false)
const waybillPrintType = ref(0)
const waybillPreviewUrl = ref('')

const filters = reactive({
  keyword: '',
  status: '',
  type: ''
})

const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0
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
    let params = {
      page: pagination.page,
      limit: pagination.limit
    }
    
    if (filters.status) {
      params.status = filters.status
    }

    if (filters.type) {
      params.type = filters.type
    }

    const kw = typeof filters.keyword === 'string' ? filters.keyword.trim() : ''
    if (kw) {
      params.keyword = kw
    }
    
    // 后台管理页面，始终查询所有订单
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

const handleDetailClose = () => {
  selectedOrder.value = null
  detailDialogVisible.value = false
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
  const d = deliveryList.value.find((x) => x.delivery_id === shipForm.delivery_id)
  if (!d || !Array.isArray(d.service_type)) return []
  return d.service_type
})

function defaultSfPickupDate() {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 2)
  return d
}

/** 不可选今天之前的日期 */
function disabledSfPickupDate(date) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return date.getTime() < start.getTime()
}

/** 若选「今天」，禁用当前时间之前的小时/分钟 */
function disabledSfPickupTime(date) {
  const now = new Date()
  if (date.getDate() !== now.getDate() || date.getMonth() !== now.getMonth() || date.getFullYear() !== now.getFullYear()) {
    return { disabledHours: () => [], disabledMinutes: () => [], disabledSeconds: () => [] }
  }
  const afterHour = []
  for (let h = 0; h < now.getHours(); h++) afterHour.push(h)
  return {
    disabledHours: () => afterHour,
    disabledMinutes: (hour) => {
      if (hour > now.getHours()) return []
      if (hour < now.getHours()) return [...Array(60).keys()]
      const afterMin = []
      for (let m = 0; m < now.getMinutes(); m++) afterMin.push(m)
      return afterMin
    },
    disabledSeconds: () => []
  }
}

function resetShipForm() {
  shipForm.delivery_id = ''
  shipForm.biz_id = LOGISTICS_BIZ_ID_CASH
  shipForm.service_type = null
  shipForm.service_name = ''
  sfExpectMode.value = 'pickup'
  sfPickupAt.value = null
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
    sfPickupAt.value = defaultSfPickupDate()
  } else {
    sfPickupAt.value = null
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

async function onShipDialogOpen() {
  resetShipForm()
  if (!deliveryList.value.length) await fetchDeliveryList()
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
  let expectTimeUnix = undefined
  if (shipForm.delivery_id === 'SF') {
    if (sfExpectMode.value === 'agreed') {
      expectTimeUnix = 0
    } else {
      if (!sfPickupAt.value) {
        ElMessage.warning('请选择顺丰预计上门揽件时间')
        return
      }
      const d = sfPickupAt.value instanceof Date ? sfPickupAt.value : new Date(sfPickupAt.value)
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
      insured_value: Math.round(yuan * 100)
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
      address: shipForm.sender.address?.trim()
    },
    add_source: 0
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
  400002: '订单滞留'
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
        add_source: 0
      },
      { timeout: 25000 }
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
      print_type: waybillPrintType.value
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

async function handleCancelWaybill() {
  if (!selectedOrder.value) return
  if (!trackForm.delivery_id?.trim() || !trackForm.waybill_id?.trim()) {
    ElMessage.warning('请先填写快递公司与运单号（可与发货记录一致）')
    return
  }
  try {
    await ElMessageBox.confirm('确认向微信发起取消运单？', '取消运单', {
      type: 'warning',
      confirmButtonText: '确认取消',
      cancelButtonText: '关闭'
    })
  } catch {
    return
  }
  try {
    await axios.post(
      '/wx/logistics/order/cancel',
      {
        internal_order_id: selectedOrder.value.id,
        delivery_id: trackForm.delivery_id.trim(),
        waybill_id: trackForm.waybill_id.trim(),
        add_source: 0
      },
      { timeout: 25000 }
    )
    ElMessage.success('取消运单成功')
  } catch (e) {
    const msg = e?.response?.data?.error || e?.message || '取消运单失败'
    ElMessage.error(msg)
  }
}

const getImageUrl = (url) => {
  if (!url) return '';
  if (isOssPublicUrl(url)) {
    return url;
  }
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`;
}

const getStatusType = (status) => {
  const statusMap = {
    'SUCCESS': 'success',
    'NOTPAY': 'warning',
    'REFUND': 'info',
    'CLOSED': 'danger',
    'REVOKED': 'danger',
    'PAYERROR': 'danger'
  }
  return statusMap[status] || 'info'
}

const getStatusLabel = (status) => {
  const statusMap = {
    'SUCCESS': '支付成功',
    'NOTPAY': '未支付',
    'REFUND': '转入退款',
    'CLOSED': '已关闭',
    'REVOKED': '已撤销',
    'PAYERROR': '支付失败'
  }
  return statusMap[status] || '未知状态'
}

const getTypeLabel = (type) => {
  const typeMap = {
    'right': '权益',
    'digital': '数字艺术品',
    'artwork': '原作'
  }
  return typeMap[type] || type
}

onMounted(() => {
  fetchOrders()
})
</script>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.filters {
  display: flex;
  align-items: center;
}

.order-item {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}

.order-item:last-child {
  margin-bottom: 0;
}

.item-info {
  flex: 1;
}

.item-title {
  font-weight: 500;
  margin-bottom: 5px;
}

.item-details {
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: #666;
}

.item-type {
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 3px;
}

.price {
  font-weight: 500;
  color: #e6a23c;
}

.pagination-wrapper {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}

.order-detail {
  max-height: 70vh;
  overflow-y: auto;
}

.detail-section {
  margin-bottom: 30px;
}

.detail-section h4 {
  margin-bottom: 15px;
  color: #303133;
  border-bottom: 1px solid #ebeef5;
  padding-bottom: 10px;
}

.detail-item {
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 15px;
  margin-bottom: 15px;
}

.item-header {
  display: flex;
  gap: 15px;
}

.item-content {
  flex: 1;
}

.item-content h5 {
  margin: 0 0 10px 0;
  color: #303133;
}

.item-description {
  color: #606266;
  margin: 0 0 10px 0;
  font-size: 14px;
}

.item-meta {
  display: flex;
  gap: 15px;
  font-size: 12px;
  color: #909399;
}

.item-meta span {
  background: #f5f7fa;
  padding: 4px 8px;
  border-radius: 3px;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-nickname {
  font-size: 12px;
  color: #606266;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-detail-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.item-address {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 10px;
  font-size: 12px;
  color: #606266;
}

.item-address .address-text {
  font-weight: 500;
  color: #303133;
}

.item-address .address-detail {
  font-size: 12px;
  color: #909399;
}

.item-address.no-address {
  color: #909399;
}

.item-address-detail {
  margin-top: 20px;
}

.item-address-detail h6 {
  margin-bottom: 10px;
  color: #303133;
  font-size: 14px;
}

.list-state-alert {
  margin-bottom: 12px;
}

.table-wrap {
  min-height: 200px;
}

.logistics-section .logistics-tip {
  font-size: 13px;
  color: #909399;
  margin: 0 0 12px;
  line-height: 1.5;
}

.ship-form .field-hint {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.mini-form {
  margin-bottom: 12px;
}

.path-timeline-wrap {
  margin-top: 16px;
  max-height: 420px;
  overflow-y: auto;
}

.path-type {
  font-size: 12px;
  color: #909399;
  margin-bottom: 4px;
}

.path-msg {
  font-size: 14px;
  color: #303133;
}

.waybill-preview {
  margin-top: 16px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  overflow: hidden;
}

.waybill-iframe {
  width: 100%;
  min-height: 480px;
  border: 0;
}

.sf-expect-mode {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
</style>
