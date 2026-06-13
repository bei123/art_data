<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div class="flex flex-col gap-2">
      <h2 class="text-xl font-semibold tracking-tight text-foreground">
        订阅消息 · 模板管理
      </h2>
      <p class="text-sm text-muted-foreground">
        从微信公共模板库选用模板到小程序私有库；发送消息时使用私有模板 ID（priTmplId）。用户须在小程序内主动订阅后方可收到推送。
      </p>
    </div>

    <Card class="shadow-none ring-1">
      <CardHeader class="pb-3">
        <CardTitle class="text-base">已接入的业务场景</CardTitle>
        <CardDescription>
          以下场景会在后端自动下发；数字艺术品使用「虚拟发货」服务卡片（notify_type 2003），用户点击卡片进入订单详情查看领取二维码。
        </CardDescription>
      </CardHeader>
      <CardContent class="overflow-x-auto p-0 sm:p-6 sm:pt-0">
        <table class="w-full min-w-[720px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="h-10 px-3 text-left font-medium">场景</th>
              <th class="h-10 px-3 text-left font-medium">模板标题</th>
              <th class="h-10 px-3 text-left font-medium">触发时机</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in scenarioRows" :key="row.key" class="border-b border-border">
              <td class="px-3 py-2.5 font-medium">{{ row.scene }}</td>
              <td class="px-3 py-2.5 text-muted-foreground">{{ row.title }}</td>
              <td class="px-3 py-2.5 text-muted-foreground">{{ row.trigger }}</td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>

    <Tabs v-model="activeTab" class="flex flex-col gap-4">
      <TabsList class="w-full max-w-md">
        <TabsTrigger value="private" class="flex-1">
          私有模板
        </TabsTrigger>
        <TabsTrigger value="add" class="flex-1">
          从公共库添加
        </TabsTrigger>
      </TabsList>

      <TabsContent value="private" class="mt-0 flex flex-col gap-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-sm text-muted-foreground">
            共 {{ privateTemplates.length }} 个模板
          </p>
          <Button type="button" variant="outline" :disabled="privateLoading" @click="fetchPrivateTemplates">
            <Loader2 v-if="privateLoading" class="size-4 shrink-0 animate-spin" aria-hidden="true" />
            刷新列表
          </Button>
        </div>

        <Alert v-if="privateError && !privateLoading" variant="destructive">
          <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
          <AlertTitle>{{ privateError }}</AlertTitle>
          <AlertDescription class="mt-2">
            <Button type="button" variant="secondary" size="sm" @click="fetchPrivateTemplates">
              重试
            </Button>
          </AlertDescription>
        </Alert>

        <Card class="relative overflow-hidden shadow-none ring-1">
          <div
            v-if="privateLoading"
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
                  <th class="h-10 min-w-[10rem] px-3 text-left font-medium">标题</th>
                  <th class="h-10 min-w-[16rem] px-3 text-left font-medium">模板 ID</th>
                  <th class="h-10 w-28 px-3 text-left font-medium">类型</th>
                  <th class="h-10 min-w-[14rem] px-3 text-left font-medium">内容</th>
                  <th class="h-10 w-40 px-3 text-left font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in privateTemplates"
                  :key="row.priTmplId"
                  class="border-b border-border transition-colors hover:bg-muted/30"
                >
                  <td class="px-3 py-2.5 font-medium">{{ row.title }}</td>
                  <td class="px-3 py-2.5">
                    <code class="break-all rounded bg-muted px-1.5 py-0.5 text-xs">{{ row.priTmplId }}</code>
                  </td>
                  <td class="px-3 py-2.5">
                    <Badge :variant="row.type === 3 ? 'default' : 'secondary'">
                      {{ formatTemplateType(row.type) }}
                    </Badge>
                  </td>
                  <td class="max-w-xs px-3 py-2.5">
                    <p class="line-clamp-2 whitespace-pre-line text-muted-foreground" :title="row.content">
                      {{ row.content || '—' }}
                    </p>
                  </td>
                  <td class="px-3 py-2.5">
                    <div class="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="secondary" type="button" @click="handleCopyPriTmplId(row.priTmplId)">
                        复制 ID
                      </Button>
                      <Button size="sm" variant="destructive" type="button" @click="openDeleteDialog(row)">
                        删除
                      </Button>
                    </div>
                  </td>
                </tr>
                <tr v-if="privateTemplates.length === 0 && !privateLoading">
                  <td colspan="5" class="px-3 py-12 text-center text-muted-foreground">
                    暂无私有模板，请切换到「从公共库添加」选用模板
                  </td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="add" class="mt-0 flex flex-col gap-4">
        <Card class="shadow-none ring-1">
          <CardHeader class="pb-3">
            <CardTitle class="text-base">筛选公共模板</CardTitle>
            <CardDescription>
              先选择小程序类目，再浏览该类目下的公共模板标题
            </CardDescription>
          </CardHeader>
          <CardContent class="flex flex-col gap-4">
            <div class="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
              <div class="flex min-w-[12rem] flex-col gap-1.5">
                <Label for="sm-category">类目</Label>
                <select
                  id="sm-category"
                  v-model="selectedCategoryId"
                  class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :disabled="categoriesLoading || categories.length === 0"
                  @change="handleCategoryChange"
                >
                  <option value="">
                    {{ categoriesLoading ? '加载类目中…' : '请选择类目' }}
                  </option>
                  <option v-for="cat in categories" :key="cat.id" :value="String(cat.id)">
                    {{ cat.name }}（{{ cat.id }}）
                  </option>
                </select>
              </div>
              <Button
                type="button"
                :disabled="!selectedCategoryId || publicLoading"
                @click="fetchPublicTemplates(true)"
              >
                查询模板
              </Button>
            </div>

            <Alert v-if="publicError && !publicLoading" variant="destructive">
              <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
              <AlertTitle>{{ publicError }}</AlertTitle>
            </Alert>
          </CardContent>
        </Card>

        <Card class="relative overflow-hidden shadow-none ring-1">
          <div
            v-if="publicLoading"
            class="absolute inset-0 z-10 flex items-center justify-center bg-background/70 backdrop-blur-[1px]"
            aria-busy="true"
            aria-label="加载中"
          >
            <Loader2 class="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
          <CardHeader class="flex flex-row flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <div>
              <CardTitle class="text-base">公共模板</CardTitle>
              <CardDescription v-if="publicTotal > 0">
                共 {{ publicTotal }} 条，当前第 {{ publicPage }} 页
              </CardDescription>
            </div>
            <div v-if="publicTotal > publicLimit" class="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                :disabled="publicStart === 0 || publicLoading"
                @click="goPublicPrevPage"
              >
                上一页
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                :disabled="publicStart + publicLimit >= publicTotal || publicLoading"
                @click="goPublicNextPage"
              >
                下一页
              </Button>
            </div>
          </CardHeader>
          <CardContent class="overflow-x-auto p-0 sm:p-6">
            <table class="w-full min-w-[640px] text-sm">
              <thead>
                <tr class="border-b border-border bg-muted/40">
                  <th class="h-10 min-w-[12rem] px-3 text-left font-medium">标题</th>
                  <th class="h-10 w-24 px-3 text-left font-medium tabular-nums">标题 ID</th>
                  <th class="h-10 w-28 px-3 text-left font-medium">类型</th>
                  <th class="h-10 w-28 px-3 text-left font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in publicTemplates"
                  :key="row.tid"
                  class="border-b border-border transition-colors hover:bg-muted/30"
                >
                  <td class="px-3 py-2.5 font-medium">{{ row.title }}</td>
                  <td class="px-3 py-2.5 tabular-nums text-muted-foreground">{{ row.tid }}</td>
                  <td class="px-3 py-2.5">
                    <Badge :variant="row.type === 3 ? 'default' : 'secondary'">
                      {{ formatTemplateType(row.type) }}
                    </Badge>
                  </td>
                  <td class="px-3 py-2.5">
                    <Button size="sm" type="button" @click="openAddDialog(row)">
                      选用
                    </Button>
                  </td>
                </tr>
                <tr v-if="publicTemplates.length === 0 && !publicLoading">
                  <td colspan="4" class="px-3 py-12 text-center text-muted-foreground">
                    {{ selectedCategoryId ? '暂无公共模板' : '请先选择类目并查询' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>

    <Dialog v-model:open="addDialogOpen">
      <DialogContent class="flex max-h-[92vh] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader class="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle>选用模板</DialogTitle>
          <DialogDescription>
            「{{ addForm.title }}」— 请选择 2～5 个关键词并填写场景描述（15 字以内）
          </DialogDescription>
        </DialogHeader>

        <ScrollArea class="max-h-[min(56vh,480px)]">
          <div class="flex flex-col gap-4 p-6">
            <div v-if="keywordsLoading" class="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 class="mr-2 size-5 animate-spin" aria-hidden="true" />
              加载关键词…
            </div>

            <Alert v-else-if="keywordsError" variant="destructive">
              <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
              <AlertTitle>{{ keywordsError }}</AlertTitle>
            </Alert>

            <fieldset v-else class="flex flex-col gap-3">
              <legend class="mb-1 text-sm font-medium">关键词（已选 {{ selectedKidList.length }} / 5）</legend>
              <label
                v-for="kw in keywordOptions"
                :key="kw.kid"
                class="flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2.5 transition-colors hover:bg-muted/40"
              >
                <Checkbox
                  :checked="selectedKidList.includes(kw.kid)"
                  class="mt-0.5"
                  @update:checked="(checked) => handleKeywordToggle(kw.kid, checked)"
                />
                <span class="flex min-w-0 flex-col gap-0.5">
                  <span class="text-sm font-medium">{{ kw.name }}</span>
                  <span class="text-xs text-muted-foreground">
                    kid {{ kw.kid }} · {{ kw.rule }} · 示例：{{ kw.example || '—' }}
                  </span>
                </span>
              </label>
              <p v-if="keywordOptions.length === 0" class="text-sm text-muted-foreground">
                该模板暂无可用关键词
              </p>
            </fieldset>

            <div class="flex flex-col gap-2">
              <Label for="sm-scene-desc">
                服务场景描述 <span class="text-destructive">*</span>
              </Label>
              <Input
                id="sm-scene-desc"
                v-model="addForm.sceneDesc"
                maxlength="15"
                placeholder="例如：订单发货通知"
                autocomplete="off"
              />
              <p class="text-xs text-muted-foreground">
                {{ addForm.sceneDesc.length }} / 15 字
              </p>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter class="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-end">
          <Button type="button" variant="outline" :disabled="addSubmitting" @click="addDialogOpen = false">
            取消
          </Button>
          <Button type="button" :disabled="addSubmitting || keywordsLoading" @click="handleAddTemplate">
            <Loader2 v-if="addSubmitting" class="size-4 shrink-0 animate-spin" aria-hidden="true" />
            确认选用
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog v-model:open="deleteDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除私有模板</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除「{{ deleteTarget?.title }}」？删除后无法再使用该 priTmplId 发送消息。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter class="gap-2 sm:justify-end">
          <AlertDialogCancel type="button" :disabled="deleteSubmitting">
            取消
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            :disabled="deleteSubmitting"
            @click="handleConfirmDelete"
          >
            <Loader2 v-if="deleteSubmitting" class="size-4 shrink-0 animate-spin" aria-hidden="true" />
            删除
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { AlertCircle, Loader2 } from 'lucide-vue-next'
import axios from '@/utils/axios'
import { showLayoutSuccess } from '@/utils/appMessage'
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
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const activeTab = ref('private')

const scenarioRows = [
  { key: 'paid', scene: '支付成功', title: '订单支付成功通知', trigger: '微信支付成功回调' },
  { key: 'pending', scene: '待付款', title: '待付款提醒', trigger: '统一下单成功（创建 NOTPAY 订单）' },
  { key: 'shipped', scene: '发货', title: '订单发货提醒', trigger: '管理端微信物流发货成功' },
  { key: 'refund', scene: '退款', title: '退款结果通知', trigger: '退款成功回调 / 审批完成' },
  { key: 'cancel', scene: '取消', title: '订单取消通知', trigger: '关闭未支付订单' },
  { key: 'virtual', scene: '数字艺术品交付', title: '购物（虚拟发货）服务动态', trigger: '支付成功激活「备货中」；管理员上传领取二维码后更新为「已发货」' },
]

const privateTemplates = ref([])
const privateLoading = ref(false)
const privateError = ref('')

const categories = ref([])
const categoriesLoading = ref(false)
const selectedCategoryId = ref('')

const publicTemplates = ref([])
const publicLoading = ref(false)
const publicError = ref('')
const publicTotal = ref(0)
const publicStart = ref(0)
const publicLimit = 30

const addDialogOpen = ref(false)
const addForm = ref({ tid: '', title: '', sceneDesc: '' })
const keywordOptions = ref([])
const selectedKidList = ref([])
const keywordsLoading = ref(false)
const keywordsError = ref('')
const addSubmitting = ref(false)

const deleteDialogOpen = ref(false)
const deleteTarget = ref(null)
const deleteSubmitting = ref(false)

const publicPage = ref(1)

function formatTemplateType(type) {
  if (type === 3) return '长期订阅'
  if (type === 2) return '一次性订阅'
  return type != null ? String(type) : '—'
}

function extractErrorMessage(error, fallback = '操作失败') {
  return error?.response?.data?.error || error?.message || fallback
}

async function fetchPrivateTemplates() {
  privateLoading.value = true
  privateError.value = ''
  try {
    const res = await axios.get('/wx/subscribe-message/templates', { timeout: 20000 })
    privateTemplates.value = Array.isArray(res?.data) ? res.data : []
  } catch (error) {
    privateError.value = extractErrorMessage(error, '加载私有模板失败')
    privateTemplates.value = []
  } finally {
    privateLoading.value = false
  }
}

async function fetchCategories() {
  categoriesLoading.value = true
  try {
    const res = await axios.get('/wx/subscribe-message/categories', { timeout: 20000 })
    categories.value = Array.isArray(res?.data) ? res.data : []
  } catch (error) {
    ElMessage.error(extractErrorMessage(error, '加载类目失败'))
    categories.value = []
  } finally {
    categoriesLoading.value = false
  }
}

function handleCategoryChange() {
  publicTemplates.value = []
  publicTotal.value = 0
  publicStart.value = 0
  publicPage.value = 1
  publicError.value = ''
}

async function fetchPublicTemplates(resetStart = false) {
  if (!selectedCategoryId.value) {
    ElMessage.warning('请先选择类目')
    return
  }
  if (resetStart) {
    publicStart.value = 0
    publicPage.value = 1
  }

  publicLoading.value = true
  publicError.value = ''
  try {
    const res = await axios.get('/wx/subscribe-message/templates/public', {
      timeout: 20000,
      params: {
        ids: selectedCategoryId.value,
        start: publicStart.value,
        limit: publicLimit,
      },
    })
    publicTemplates.value = Array.isArray(res?.data) ? res.data : []
    publicTotal.value = typeof res?.count === 'number' ? res.count : publicTemplates.value.length
    publicPage.value = Math.floor(publicStart.value / publicLimit) + 1
  } catch (error) {
    publicError.value = extractErrorMessage(error, '加载公共模板失败')
    publicTemplates.value = []
    publicTotal.value = 0
  } finally {
    publicLoading.value = false
  }
}

function goPublicPrevPage() {
  if (publicStart.value === 0) return
  publicStart.value = Math.max(0, publicStart.value - publicLimit)
  fetchPublicTemplates(false)
}

function goPublicNextPage() {
  if (publicStart.value + publicLimit >= publicTotal.value) return
  publicStart.value += publicLimit
  fetchPublicTemplates(false)
}

async function openAddDialog(row) {
  addForm.value = {
    tid: String(row.tid),
    title: row.title || '',
    sceneDesc: '',
  }
  selectedKidList.value = []
  keywordOptions.value = []
  keywordsError.value = ''
  addDialogOpen.value = true
  keywordsLoading.value = true

  try {
    const res = await axios.get(`/wx/subscribe-message/templates/public/${row.tid}/keywords`, {
      timeout: 20000,
    })
    keywordOptions.value = Array.isArray(res?.data) ? res.data : []
  } catch (error) {
    keywordsError.value = extractErrorMessage(error, '加载关键词失败')
    keywordOptions.value = []
  } finally {
    keywordsLoading.value = false
  }
}

function handleKeywordToggle(kid, checked) {
  const id = Number(kid)
  if (Number.isNaN(id)) return

  if (checked) {
    if (selectedKidList.value.includes(id)) return
    if (selectedKidList.value.length >= 5) {
      ElMessage.warning('最多选择 5 个关键词')
      return
    }
    selectedKidList.value = [...selectedKidList.value, id]
    return
  }

  selectedKidList.value = selectedKidList.value.filter((item) => item !== id)
}

async function handleAddTemplate() {
  const sceneDesc = addForm.value.sceneDesc.trim()
  if (selectedKidList.value.length < 2) {
    ElMessage.warning('请至少选择 2 个关键词')
    return
  }
  if (selectedKidList.value.length > 5) {
    ElMessage.warning('最多选择 5 个关键词')
    return
  }
  if (!sceneDesc) {
    ElMessage.warning('请填写服务场景描述')
    return
  }
  if (sceneDesc.length > 15) {
    ElMessage.warning('场景描述不能超过 15 个字')
    return
  }

  addSubmitting.value = true
  try {
    const res = await axios.post('/wx/subscribe-message/templates', {
      tid: addForm.value.tid,
      kidList: selectedKidList.value,
      sceneDesc,
    }, { timeout: 20000 })

    addDialogOpen.value = false
    const priTmplId = res?.priTmplId
    if (priTmplId) {
      showLayoutSuccess(`模板已添加，ID：${priTmplId}`)
    } else {
      showLayoutSuccess('模板已添加')
    }
    activeTab.value = 'private'
    await fetchPrivateTemplates()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error, '选用模板失败'))
  } finally {
    addSubmitting.value = false
  }
}

function openDeleteDialog(row) {
  deleteTarget.value = row
  deleteDialogOpen.value = true
}

async function handleConfirmDelete() {
  if (!deleteTarget.value?.priTmplId) return

  deleteSubmitting.value = true
  try {
    await axios.delete(`/wx/subscribe-message/templates/${encodeURIComponent(deleteTarget.value.priTmplId)}`, {
      timeout: 20000,
    })
    showLayoutSuccess('模板已删除')
    deleteDialogOpen.value = false
    deleteTarget.value = null
    await fetchPrivateTemplates()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error, '删除模板失败'))
  } finally {
    deleteSubmitting.value = false
  }
}

async function handleCopyPriTmplId(priTmplId) {
  if (!priTmplId) return
  try {
    await navigator.clipboard.writeText(priTmplId)
    showLayoutSuccess('已复制模板 ID')
  } catch {
    ElMessage.warning('复制失败，请手动选择复制')
  }
}

onMounted(async () => {
  await Promise.all([fetchPrivateTemplates(), fetchCategories()])
})
</script>
