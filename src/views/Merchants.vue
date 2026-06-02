<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <h2 class="text-xl font-semibold tracking-tight text-foreground">
        商家管理
      </h2>
      <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div class="relative w-full min-w-0 sm:max-w-xs">
          <Search
            class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            v-model="searchQuery"
            type="search"
            placeholder="搜索商家名称或描述"
            class="pl-9"
            autocomplete="off"
            @keydown.enter.prevent="handleSearch"
          />
        </div>
        <div class="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" @click="handleSearch">
            搜索
          </Button>
          <Button type="button" @click="showAddDialog">
            添加商家
          </Button>
        </div>
      </div>
    </div>

    <Alert v-if="listError && !loading" variant="destructive">
      <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
      <AlertTitle>{{ listError }}</AlertTitle>
      <AlertDescription class="mt-2">
        <Button type="button" variant="secondary" size="sm" @click="retryFetchMerchants">
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
        <table class="w-full min-w-[960px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="h-10 w-16 px-3 text-left font-medium tabular-nums">ID</th>
              <th class="h-10 w-20 px-3 text-left font-medium">Logo</th>
              <th class="h-10 min-w-[8rem] px-3 text-left font-medium">商家名称</th>
              <th class="h-10 min-w-[10rem] px-3 text-left font-medium">描述</th>
              <th class="h-10 min-w-[8rem] px-3 text-left font-medium">地址</th>
              <th class="h-10 w-32 px-3 text-left font-medium">电话</th>
              <th class="h-10 w-28 px-3 text-left font-medium">状态</th>
              <th class="h-10 w-36 px-3 text-left font-medium">排序</th>
              <th class="h-10 w-36 px-3 text-left font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in merchants"
              :key="row.id"
              class="border-b border-border transition-colors hover:bg-muted/30"
            >
              <td class="px-3 py-2.5 tabular-nums text-muted-foreground">{{ row.id }}</td>
              <td class="px-3 py-2">
                <div class="size-12 overflow-hidden rounded-md border border-border bg-muted/30">
                  <img
                    v-if="row.logo"
                    :src="getListThumbnailUrl(getImageUrl(row.logo))"
                    :alt="row.name ? `${row.name} Logo` : '商家 Logo'"
                    class="size-full object-cover"
                    loading="lazy"
                    @error="(e) => { e.target.style.opacity = '0.35' }"
                  >
                  <div v-else class="flex size-full items-center justify-center text-xs text-muted-foreground">
                    —
                  </div>
                </div>
              </td>
              <td class="px-3 py-2.5 font-medium">{{ row.name }}</td>
              <td class="max-w-[14rem] truncate px-3 py-2.5 text-muted-foreground" :title="row.description">
                {{ row.description }}
              </td>
              <td class="max-w-[12rem] truncate px-3 py-2.5 text-muted-foreground" :title="row.address">
                {{ row.address }}
              </td>
              <td class="px-3 py-2.5 tabular-nums text-muted-foreground">{{ row.phone }}</td>
              <td class="px-3 py-2.5">
                <button
                  type="button"
                  role="switch"
                  :aria-checked="row.status === 'active'"
                  :aria-label="row.status === 'active' ? '启用，点击关闭' : '禁用，点击启用'"
                  class="inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  :class="row.status === 'active' ? 'bg-primary' : 'bg-muted'"
                  @click="handleStatusClick(row)"
                >
                  <span
                    class="pointer-events-none block size-5 rounded-full bg-background shadow ring-0 transition-transform"
                    :class="row.status === 'active' ? 'translate-x-5' : 'translate-x-1'"
                  />
                </button>
              </td>
              <td class="px-3 py-2">
                <Input
                  v-model.number="row.sort_order"
                  type="number"
                  min="0"
                  max="999"
                  step="1"
                  class="h-8 w-24"
                  @blur="handleSortBlur(row)"
                />
              </td>
              <td class="px-3 py-2.5">
                <div class="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="secondary" type="button" @click="handleEdit(row)">
                    编辑
                  </Button>
                  <Button size="sm" variant="destructive" type="button" @click="openDeleteMerchantDialog(row)">
                    删除
                  </Button>
                </div>
              </td>
            </tr>
            <tr v-if="merchants.length === 0 && !loading">
              <td colspan="9" class="px-3 py-12 text-center text-muted-foreground">
                暂无商家数据
              </td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>

    <Card class="shadow-none ring-1">
      <CardContent class="flex flex-col gap-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <span class="text-sm text-muted-foreground">共 {{ total }} 条</span>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm text-muted-foreground">每页</span>
          <Select
            :model-value="String(pageSize)"
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
            :disabled="currentPage <= 1"
            @click="handleCurrentChange(currentPage - 1)"
          >
            上一页
          </Button>
          <span class="min-w-[5rem] text-center text-sm tabular-nums">
            {{ currentPage }} / {{ totalPages }}
          </span>
          <Button
            size="sm"
            variant="outline"
            type="button"
            :disabled="currentPage >= totalPages"
            @click="handleCurrentChange(currentPage + 1)"
          >
            下一页
          </Button>
        </div>
      </CardContent>
    </Card>

    <Dialog v-model:open="dialogVisible">
      <DialogContent class="flex max-h-[92vh] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader class="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle>{{ dialogType === 'add' ? '添加商家' : '编辑商家' }}</DialogTitle>
          <DialogDescription>
            <template v-if="dialogType === 'edit'">
              正在编辑「{{ form.name || '未命名' }}」<span v-if="form.id" class="text-muted-foreground">（ID {{ form.id }}）</span>
            </template>
            <template v-else>
              上传 Logo 并填写商家信息；带 <span class="text-destructive">*</span> 为必填
            </template>
          </DialogDescription>
        </DialogHeader>

        <div class="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(240px,280px)_1fr]">
          <!-- 左侧：Logo -->
          <div class="flex flex-col gap-3 border-border bg-muted/15 p-4 lg:border-r">
            <div class="flex flex-col gap-2">
              <Label>Logo <span class="text-destructive">*</span></Label>
              <input
                ref="logoInput"
                type="file"
                accept="image/*"
                class="hidden"
                @change="handleLogoFileSelect"
              >
              <div
                class="relative aspect-square w-full max-w-[280px] cursor-pointer overflow-hidden rounded-lg border-2 border-dashed border-border bg-background transition hover:border-primary/40"
                :class="{
                  'border-primary/50 bg-primary/5': isLogoDragOver,
                  'pointer-events-none opacity-70': isLogoUploading || isLogoProcessing,
                }"
                role="button"
                tabindex="0"
                @click="triggerLogoInput"
                @keydown.enter.prevent="triggerLogoInput"
                @keydown.space.prevent="triggerLogoInput"
                @dragenter="handleLogoDragEnter"
                @dragleave="handleLogoDragLeave"
                @dragover="handleLogoDragOver"
                @drop="handleLogoDrop"
              >
                <img
                  v-if="form.logo"
                  :src="getImageUrl(form.logo)"
                  alt="Logo"
                  class="size-full object-cover"
                  loading="lazy"
                >
                <div v-else class="flex size-full flex-col items-center justify-center gap-2 p-4 text-center">
                  <Upload class="size-10 text-muted-foreground" aria-hidden="true" />
                  <p class="text-sm font-medium">上传 Logo</p>
                  <p class="text-xs text-muted-foreground">JPG / PNG / GIF，≤5MB</p>
                </div>
                <div
                  v-if="isLogoDragOver"
                  class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-primary/10 text-sm font-medium text-primary"
                >
                  释放以上传
                </div>
                <div
                  v-if="form.logo && !isLogoUploading && !isLogoProcessing"
                  class="absolute right-2 top-2 flex gap-1"
                >
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    class="size-8 bg-background/90 shadow-sm"
                    aria-label="更换 Logo"
                    @click.stop="triggerLogoInput"
                  >
                    <Upload class="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="destructive"
                    class="size-8 shadow-sm"
                    aria-label="移除 Logo"
                    @click.stop="clearLogo"
                  >
                    <X class="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <div
                v-if="isLogoProcessing || (logoUploadProgress > 0 && logoUploadProgress < 100)"
                class="max-w-[280px] rounded-lg border border-border bg-background p-2 text-xs text-muted-foreground"
              >
                <Progress :model-value="isLogoProcessing ? 40 : logoUploadProgress" class="h-1.5" />
                <p class="mt-1.5 text-center">
                  {{ isLogoProcessing ? '处理中…' : `上传中 ${logoUploadProgress}%` }}
                </p>
              </div>
            </div>
            <p class="max-w-[280px] text-xs text-muted-foreground">
              展示图片在右侧「展示图片」Tab 中管理，最多 5 张。
            </p>
          </div>

          <!-- 右侧：Tab -->
          <div class="flex min-h-0 flex-col">
            <Tabs v-model="merchantFormTab" class="flex min-h-0 flex-1 flex-col">
              <div class="shrink-0 border-b border-border px-4 pt-3">
                <TabsList class="grid h-auto w-full grid-cols-3 gap-1">
                  <TabsTrigger value="basic" class="text-xs sm:text-sm">
                    基本信息
                  </TabsTrigger>
                  <TabsTrigger value="intro" class="text-xs sm:text-sm">
                    介绍
                  </TabsTrigger>
                  <TabsTrigger value="gallery" class="text-xs sm:text-sm">
                    展示图片
                  </TabsTrigger>
                </TabsList>
              </div>

              <ScrollArea class="min-h-[320px] flex-1 lg:max-h-[min(56vh,560px)]">
                <TabsContent value="basic" class="mt-0 space-y-4 p-4">
                  <div class="flex flex-col gap-2">
                    <Label for="m-name">商家名称 <span class="text-destructive">*</span></Label>
                    <Input id="m-name" v-model="form.name" autocomplete="organization" />
                  </div>
                  <div class="flex flex-col gap-2">
                    <Label for="m-address">地址 <span class="text-destructive">*</span></Label>
                    <Input id="m-address" v-model="form.address" autocomplete="street-address" />
                  </div>
                  <div class="flex flex-col gap-2">
                    <Label for="m-phone">联系电话 <span class="text-destructive">*</span></Label>
                    <Input id="m-phone" v-model="form.phone" type="tel" autocomplete="tel" placeholder="11 位手机号" />
                  </div>
                </TabsContent>

                <TabsContent value="intro" class="mt-0 p-4">
                  <div class="flex flex-col gap-2">
                    <Label for="m-desc">商家描述 <span class="text-destructive">*</span></Label>
                    <Textarea
                      id="m-desc"
                      v-model="form.description"
                      class="min-h-[min(280px,40vh)]"
                      rows="10"
                      placeholder="介绍商家特色、营业时间、服务等"
                    />
                  </div>
                </TabsContent>

                <TabsContent value="gallery" class="mt-0 space-y-4 p-4">
                  <div class="flex items-center justify-between gap-2">
                    <div>
                      <p class="text-sm font-medium">
                        展示图片 <span class="text-destructive">*</span>
                      </p>
                      <p class="text-xs text-muted-foreground">
                        至少 1 张，最多 5 张，支持拖拽上传
                      </p>
                    </div>
                    <Badge variant="secondary" class="tabular-nums">
                      {{ form.images.length }} / 5
                    </Badge>
                  </div>

                  <div class="flex flex-wrap gap-3">
                    <div
                      v-for="(image, index) in form.images"
                      :key="`${image}-${index}`"
                      class="group relative size-[120px] overflow-hidden rounded-lg border border-border bg-muted/30 shadow-sm"
                    >
                      <img
                        :src="getImageUrl(image)"
                        :alt="`展示图 ${index + 1}`"
                        class="size-full object-cover"
                        loading="lazy"
                      >
                      <Button
                        type="button"
                        size="icon"
                        variant="destructive"
                        class="absolute right-1 top-1 size-7 opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                        :aria-label="`移除第 ${index + 1} 张图片`"
                        @click="removeGalleryImage(index)"
                      >
                        <X class="size-3.5" aria-hidden="true" />
                      </Button>
                      <span class="absolute bottom-1 left-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
                        {{ index + 1 }}
                      </span>
                    </div>

                    <div
                      v-if="form.images.length < 5"
                      class="relative flex size-[120px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 transition hover:border-primary/40"
                      :class="{
                        'border-primary/50 bg-primary/5': isImagesDragOver,
                        'pointer-events-none opacity-70': isImagesUploading || isImagesProcessing,
                      }"
                      role="button"
                      tabindex="0"
                      @click="triggerImagesInput"
                      @keydown.enter.prevent="triggerImagesInput"
                      @keydown.space.prevent="triggerImagesInput"
                      @dragenter="handleImagesDragEnter"
                      @dragleave="handleImagesDragLeave"
                      @dragover="handleImagesDragOver"
                      @drop="handleImagesDrop"
                    >
                      <Loader2
                        v-if="isImagesUploading || isImagesProcessing"
                        class="mb-1 size-8 animate-spin text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Plus v-else class="mb-1 size-8 text-muted-foreground" aria-hidden="true" />
                      <p class="px-1 text-center text-xs font-medium">添加</p>
                      <div
                        v-if="isImagesDragOver"
                        class="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-primary/10 text-xs font-medium text-primary"
                      >
                        释放上传
                      </div>
                    </div>
                  </div>

                  <input
                    ref="imagesInput"
                    type="file"
                    accept="image/*"
                    multiple
                    class="hidden"
                    @change="handleImagesFileSelect"
                  >

                  <div
                    v-if="isImagesProcessing || (imagesUploadProgress > 0 && imagesUploadProgress < 100)"
                    class="rounded-lg border border-border bg-muted/40 p-3 text-sm"
                  >
                    <Progress :model-value="isImagesProcessing ? 40 : imagesUploadProgress" class="h-2" />
                    <p class="mt-2 text-center text-xs text-muted-foreground">
                      {{ isImagesProcessing ? '处理中…' : `上传中 ${imagesUploadProgress}%` }}
                    </p>
                  </div>
                </TabsContent>
              </ScrollArea>
            </Tabs>
          </div>
        </div>

        <DialogFooter class="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-end">
          <Button type="button" variant="outline" :disabled="submitting" @click="dialogVisible = false">
            取消
          </Button>
          <Button type="button" :disabled="submitting" @click="handleSubmit">
            <Loader2 v-if="submitting" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            {{ dialogType === 'add' ? '添加' : '保存' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog v-model:open="deleteMerchantDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除商家</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除「{{ deleteMerchantName }}」吗？此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter class="gap-2 sm:justify-end">
          <AlertDialogCancel type="button">
            取消
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            :disabled="deletingMerchant"
            @click="confirmDeleteMerchant"
          >
            <Loader2 v-if="deletingMerchant" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            删除
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import axios from 'axios'
import { AlertCircle, Loader2, Plus, Search, Trash2, Upload, X } from 'lucide-vue-next'
import { uploadImageToWebpLimit5MB } from '../utils/image'
import { API_BASE_URL } from '../config'
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
import { Card, CardContent } from '@/components/ui/card'
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
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

const route = useRoute()
const router = useRouter()

const merchantFormTab = ref('basic')

const logoInput = ref(null)
const isLogoDragOver = ref(false)
const logoUploadProgress = ref(0)
const isLogoUploading = ref(false)
const isLogoProcessing = ref(false)
const logoFileName = ref('')
const logoFileSize = ref(0)

const imagesInput = ref(null)
const isImagesDragOver = ref(false)
const imagesUploadProgress = ref(0)
const isImagesUploading = ref(false)
const isImagesProcessing = ref(false)
const imagesFileName = ref('')
const imagesFileSize = ref(0)

const getImageUrl = (url) => {
  if (!url) return ''
  if (url.startsWith('http')) return url
  return `${API_BASE_URL}${url}`
}

const request = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
})

request.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error),
)

request.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      ElMessage.error('登录已过期，请重新登录')
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  },
)

const merchants = ref([])
const loading = ref(false)
const listError = ref('')
const dialogVisible = ref(false)
const dialogType = ref('add')
const submitting = ref(false)
const form = ref({
  name: '',
  logo: '',
  description: '',
  address: '',
  phone: '',
  images: [],
})
const searchQuery = ref('')
const currentPage = ref(1)
const pageSize = ref(10)
const total = ref(0)

const deleteMerchantDialogOpen = ref(false)
const deleteMerchantTarget = ref(null)
const deletingMerchant = ref(false)

const deleteMerchantName = computed(() => {
  const row = deleteMerchantTarget.value
  if (!row) return '该商家'
  return row.name || '未命名'
})

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

const retryFetchMerchants = () => {
  listError.value = ''
  fetchMerchants()
}

const fetchMerchants = async () => {
  loading.value = true
  listError.value = ''
  try {
    const response = await request.get('/api/merchants', {
      params: {
        page: currentPage.value,
        limit: pageSize.value,
        search: searchQuery.value,
      },
    })
    merchants.value = response.data.data
    total.value = response.data.pagination.total
  } catch (error) {
    merchants.value = []
    total.value = 0
    listError.value = '获取商家列表失败，请检查网络或稍后重试'
  } finally {
    loading.value = false
  }
}

const handleSearch = () => {
  currentPage.value = 1
  fetchMerchants()
}

const handleSizeChange = (val) => {
  pageSize.value = val
  currentPage.value = 1
  fetchMerchants()
}

const handleCurrentChange = (val) => {
  currentPage.value = val
  fetchMerchants()
}

async function handleStatusClick(row) {
  const next = row.status === 'active' ? 'inactive' : 'active'
  const prev = row.status
  row.status = next
  try {
    await request.patch(`/api/merchants/${row.id}/status`, {
      status: next,
    })
    ElMessage.success('状态更新成功')
  } catch (error) {
    row.status = prev
    ElMessage.error('状态更新失败')
  }
}

async function handleSortBlur(row) {
  let v = Number(row.sort_order)
  if (Number.isNaN(v)) v = 0
  v = Math.max(0, Math.min(999, v))
  row.sort_order = v
  try {
    await request.patch(`/api/merchants/${row.id}/sort`, {
      sort_order: v,
    })
    ElMessage.success('排序更新成功')
  } catch (error) {
    ElMessage.error('排序更新失败')
  }
}

function openDeleteMerchantDialog(row) {
  deleteMerchantTarget.value = row
  deleteMerchantDialogOpen.value = true
}

async function confirmDeleteMerchant() {
  const row = deleteMerchantTarget.value
  if (!row?.id) return
  deletingMerchant.value = true
  try {
    await request.delete(`/api/merchants/${row.id}`)
    ElMessage.success('删除成功')
    deleteMerchantDialogOpen.value = false
    deleteMerchantTarget.value = null
    fetchMerchants()
  } catch (error) {
    ElMessage.error('删除失败')
  } finally {
    deletingMerchant.value = false
  }
}

const triggerLogoInput = () => {
  if (!isLogoUploading.value && !isLogoProcessing.value) logoInput.value?.click()
}

const handleLogoFileSelect = (event) => {
  const file = event.target.files[0]
  if (file) uploadLogoFile(file)
  event.target.value = ''
}

const uploadLogoFile = async (file) => {
  logoUploadProgress.value = 0
  isLogoUploading.value = true
  isLogoProcessing.value = true
  logoFileName.value = file.name
  logoFileSize.value = file.size

  try {
    const processedFile = await uploadImageToWebpLimit5MB(file)

    if (!processedFile) {
      resetLogoUploadState()
      return
    }

    isLogoProcessing.value = false
    logoFileName.value = processedFile.name
    logoFileSize.value = processedFile.size

    const formData = new FormData()
    formData.append('file', processedFile)

    const response = await request.post('/api/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          logoUploadProgress.value = percent
        } else {
          logoUploadProgress.value = Math.min(logoUploadProgress.value + 10, 90)
        }
      },
    })

    handleLogoUploadSuccess(response)
  } catch (error) {
    handleLogoUploadError(error)
  }
}

function extractUploadUrl(response) {
  if (!response) return ''
  const d = response.data !== undefined ? response.data : response
  if (d && d.url) return d.url
  if (d && d.data && d.data.url) return d.data.url
  if (d && d.data && typeof d.data === 'string') return d.data
  if (typeof d === 'string') return d
  if (d && d.path) return d.path
  if (d && d.file) return d.file
  if (d && d.filename) return d.filename
  return ''
}

const handleLogoUploadSuccess = (response) => {
  const imageUrl = extractUploadUrl(response)

  if (imageUrl) {
    form.value.logo = imageUrl
    logoUploadProgress.value = 100

    setTimeout(() => {
      logoUploadProgress.value = 0
      isLogoUploading.value = false
      logoFileName.value = ''
      logoFileSize.value = 0
    }, 2000)

    ElMessage.success('Logo上传成功')
  } else {
    ElMessage.error('Logo上传失败：未获取到图片URL')
    resetLogoUploadState()
  }
}

const handleLogoUploadError = (error) => {
  console.error('Logo上传错误:', error)
  ElMessage.error('Logo上传失败：' + (error.response?.data?.message || '未知错误'))
  resetLogoUploadState()
}

const resetLogoUploadState = () => {
  logoUploadProgress.value = 0
  isLogoUploading.value = false
  isLogoProcessing.value = false
  logoFileName.value = ''
  logoFileSize.value = 0
}

function clearLogo() {
  form.value.logo = ''
}

function removeGalleryImage(index) {
  if (index < 0 || index >= form.value.images.length) return
  form.value.images.splice(index, 1)
}

const triggerImagesInput = () => {
  if (!isImagesUploading.value && !isImagesProcessing.value) imagesInput.value?.click()
}

const handleImagesFileSelect = (event) => {
  const files = Array.from(event.target.files)
  if (files.length > 0) uploadImagesFiles(files)
  event.target.value = ''
}

const uploadImagesFiles = async (files) => {
  if (form.value.images.length + files.length > 5) {
    ElMessage.warning('最多只能上传5张图片')
    return
  }

  isImagesUploading.value = true
  isImagesProcessing.value = true

  for (const file of files) {
    try {
      const processedFile = await uploadImageToWebpLimit5MB(file)

      if (!processedFile) continue

      isImagesProcessing.value = false
      imagesFileName.value = processedFile.name
      imagesFileSize.value = processedFile.size

      const formData = new FormData()
      formData.append('file', processedFile)

      const response = await request.post('/api/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
            imagesUploadProgress.value = percent
          } else {
            imagesUploadProgress.value = Math.min(imagesUploadProgress.value + 10, 90)
          }
        },
      })

      handleImagesUploadSuccess(response)
    } catch (error) {
      handleImagesUploadError(error)
    }
  }

  resetImagesUploadState()
}

const handleImagesUploadSuccess = (response) => {
  const imageUrl = extractUploadUrl(response)

  if (imageUrl) {
    form.value.images.push(imageUrl)
    imagesUploadProgress.value = 100

    setTimeout(() => {
      imagesUploadProgress.value = 0
    }, 2000)

    ElMessage.success('图片上传成功')
  } else {
    ElMessage.error('图片上传失败：未获取到图片URL')
  }
}

const handleImagesUploadError = (error) => {
  console.error('图片上传错误:', error)
  ElMessage.error('图片上传失败：' + (error.response?.data?.message || '未知错误'))
}

const resetImagesUploadState = () => {
  imagesUploadProgress.value = 0
  isImagesUploading.value = false
  isImagesProcessing.value = false
  imagesFileName.value = ''
  imagesFileSize.value = 0
}

const handleLogoDragEnter = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!isLogoUploading.value && !isLogoProcessing.value) {
    isLogoDragOver.value = true
  }
}

const handleLogoDragLeave = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!e.currentTarget.contains(e.relatedTarget)) {
    isLogoDragOver.value = false
  }
}

const handleLogoDragOver = (e) => {
  e.preventDefault()
  e.stopPropagation()
}

const handleLogoDrop = (e) => {
  e.preventDefault()
  e.stopPropagation()
  isLogoDragOver.value = false

  if (isLogoUploading.value || isLogoProcessing.value) return

  const files = e.dataTransfer.files
  if (files.length > 0) uploadLogoFile(files[0])
}

const handleImagesDragEnter = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!isImagesUploading.value && !isImagesProcessing.value && form.value.images.length < 5) {
    isImagesDragOver.value = true
  }
}

const handleImagesDragLeave = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!e.currentTarget.contains(e.relatedTarget)) {
    isImagesDragOver.value = false
  }
}

const handleImagesDragOver = (e) => {
  e.preventDefault()
  e.stopPropagation()
}

const handleImagesDrop = (e) => {
  e.preventDefault()
  e.stopPropagation()
  isImagesDragOver.value = false

  if (isImagesUploading.value || isImagesProcessing.value || form.value.images.length >= 5) return

  const files = Array.from(e.dataTransfer.files)
  if (files.length > 0) uploadImagesFiles(files)
}

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const showAddDialog = () => {
  dialogType.value = 'add'
  form.value = {
    name: '',
    logo: '',
    description: '',
    address: '',
    phone: '',
    images: [],
  }
  resetLogoUploadState()
  resetImagesUploadState()
  merchantFormTab.value = 'basic'
  dialogVisible.value = true
}

const handleEdit = (row) => {
  dialogType.value = 'edit'
  form.value = {
    id: row.id,
    name: row.name,
    logo: row.logo,
    description: row.description,
    address: row.address,
    phone: row.phone,
    images: row.images || [],
  }
  resetLogoUploadState()
  resetImagesUploadState()
  merchantFormTab.value = 'basic'
  dialogVisible.value = true
}

function validateForm() {
  if (!form.value.name?.trim()) {
    ElMessage.warning('请输入商家名称')
    return false
  }
  if (!form.value.logo) {
    ElMessage.warning('请上传Logo')
    merchantFormTab.value = 'basic'
    return false
  }
  if (!form.value.description?.trim()) {
    ElMessage.warning('请输入商家描述')
    merchantFormTab.value = 'intro'
    return false
  }
  if (!form.value.address?.trim()) {
    ElMessage.warning('请输入商家地址')
    return false
  }
  if (!form.value.phone?.trim()) {
    ElMessage.warning('请输入商家电话')
    return false
  }
  if (!/^1[3-9]\d{9}$/.test(form.value.phone.trim())) {
    ElMessage.warning('请输入正确的手机号码')
    return false
  }
  if (!form.value.images?.length) {
    ElMessage.warning('请上传商家图片')
    merchantFormTab.value = 'gallery'
    return false
  }
  return true
}

const handleSubmit = async () => {
  if (!validateForm()) return

  submitting.value = true
  try {
    if (dialogType.value === 'add') {
      await request.post('/api/merchants', form.value)
      ElMessage.success('添加成功')
    } else {
      await request.put(`/api/merchants/${form.value.id}`, form.value)
      ElMessage.success('更新成功')
    }
    dialogVisible.value = false
    fetchMerchants()
  } catch (error) {
    ElMessage.error(dialogType.value === 'add' ? '添加失败' : '更新失败')
  } finally {
    submitting.value = false
  }
}

async function openEditFromRouteQuery() {
  const raw = route.query.edit
  if (!raw) return
  const id = Number(raw)
  if (!id) return

  let row = merchants.value.find((m) => m.id === id)
  if (!row) {
    try {
      const response = await request.get(`/api/merchants/${id}`)
      row = response.data?.data ?? response.data
    } catch {
      ElMessage.error('未找到该商家')
    }
  }
  if (row?.id) handleEdit(row)

  const nextQuery = { ...route.query }
  delete nextQuery.edit
  router.replace({ path: route.path, query: nextQuery })
}

onMounted(async () => {
  await fetchMerchants()
  await openEditFromRouteQuery()
})
</script>
