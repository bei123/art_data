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
                    :src="getImageUrl(row.logo)"
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
      <DialogContent class="max-h-[92vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ dialogType === 'add' ? '添加商家' : '编辑商家' }}</DialogTitle>
        </DialogHeader>

        <div class="grid gap-4 py-2">
          <div class="flex flex-col gap-2">
            <Label for="m-name">商家名称 <span class="text-destructive">*</span></Label>
            <Input id="m-name" v-model="form.name" autocomplete="off" />
          </div>

          <div class="flex flex-col gap-2">
            <Label for="m-address">地址 <span class="text-destructive">*</span></Label>
            <Input id="m-address" v-model="form.address" autocomplete="off" />
          </div>

          <div class="flex flex-col gap-2">
            <Label for="m-phone">电话 <span class="text-destructive">*</span></Label>
            <Input id="m-phone" v-model="form.phone" type="tel" autocomplete="off" />
          </div>

          <div class="flex flex-col gap-2">
            <Label>Logo <span class="text-destructive">*</span></Label>
            <div class="max-w-[400px] space-y-3">
              <div
                v-if="form.logo"
                class="group relative size-[200px] overflow-hidden rounded-lg border border-border shadow-sm"
              >
                <img :src="getImageUrl(form.logo)" alt="Logo" class="size-full object-cover">
                <div
                  class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Button type="button" size="icon" variant="destructive" @click="openRemoveLogoDialog">
                    <Trash2 class="size-4" />
                  </Button>
                  <Button type="button" size="sm" variant="secondary" @click="triggerLogoInput">
                    更换 Logo
                  </Button>
                </div>
              </div>
              <div
                v-else
                class="relative flex size-[200px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 transition hover:border-primary/40"
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
                <Loader2
                  v-if="isLogoUploading || isLogoProcessing"
                  class="mb-2 size-10 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
                <Upload v-else class="mb-2 size-10 text-muted-foreground" aria-hidden="true" />
                <p class="px-2 text-center text-sm font-medium text-foreground">
                  {{ isLogoProcessing ? '正在处理图片…' : isLogoUploading ? '正在上传…' : '点击或拖拽图片到此处上传' }}
                </p>
                <p class="mt-1 px-2 text-center text-xs text-muted-foreground">
                  支持 JPG、PNG、GIF，自动转 WebP 并压缩至 5MB 以内
                </p>
                <div
                  v-if="isLogoDragOver && !form.logo"
                  class="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-primary/10 font-semibold text-primary"
                >
                  <Upload class="mb-2 size-10" aria-hidden="true" />
                  <span>释放鼠标上传图片</span>
                </div>
              </div>
              <input
                ref="logoInput"
                type="file"
                accept="image/*"
                class="hidden"
                @change="handleLogoFileSelect"
              >

              <div v-if="isLogoProcessing" class="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <div class="mb-2 flex justify-between text-muted-foreground">
                  <span>图片处理中</span>
                  <span>处理中…</span>
                </div>
                <Progress :model-value="40" class="h-2" />
                <div class="mt-2 flex justify-between text-xs text-muted-foreground">
                  <span class="max-w-[150px] truncate">{{ logoFileName }}</span>
                  <span>{{ formatFileSize(logoFileSize) }}</span>
                </div>
                <p class="mt-2 text-center text-xs italic text-muted-foreground">
                  正在将图片转换为 WebP 并压缩…
                </p>
              </div>

              <div
                v-if="logoUploadProgress > 0 && logoUploadProgress < 100 && !isLogoProcessing"
                class="rounded-lg border border-border bg-muted/40 p-3 text-sm"
              >
                <div class="mb-2 flex justify-between">
                  <span class="font-medium">上传进度</span>
                  <span class="font-semibold text-primary tabular-nums">{{ logoUploadProgress }}%</span>
                </div>
                <Progress :model-value="logoUploadProgress" class="h-2" />
                <div class="mt-2 flex justify-between text-xs text-muted-foreground">
                  <span class="max-w-[150px] truncate">{{ logoFileName }}</span>
                  <span>{{ formatFileSize(logoFileSize) }}</span>
                </div>
              </div>

              <Alert v-if="logoUploadProgress === 100 && !isLogoProcessing" class="border-primary/30">
                <AlertCircle class="size-4 shrink-0 text-primary" aria-hidden="true" />
                <AlertTitle>图片上传成功</AlertTitle>
              </Alert>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <Label>商家图片 <span class="text-destructive">*</span></Label>
            <div class="w-full space-y-4">
              <div v-if="form.images.length > 0" class="flex flex-wrap gap-4">
                <div
                  v-for="(image, index) in form.images"
                  :key="`${image}-${index}`"
                  class="group relative size-[120px] overflow-hidden rounded-lg border border-border shadow-sm"
                >
                  <img :src="getImageUrl(image)" class="size-full object-cover" alt="商家图片">
                  <div
                    class="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Button
                      type="button"
                      size="icon"
                      variant="destructive"
                      class="size-8"
                      @click="openRemoveGalleryImageDialog(index)"
                    >
                      <Trash2 class="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
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
                <p class="px-1 text-center text-xs font-medium text-foreground">添加图片</p>
                <p class="mt-0.5 px-1 text-center text-[10px] text-muted-foreground">最多 5 张，支持拖拽</p>
              </div>

              <input
                ref="imagesInput"
                type="file"
                accept="image/*"
                multiple
                class="hidden"
                @change="handleImagesFileSelect"
              >

              <div v-if="isImagesProcessing" class="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <div class="mb-2 flex justify-between text-muted-foreground">
                  <span>图片处理中</span>
                  <span>处理中…</span>
                </div>
                <Progress :model-value="40" class="h-2" />
                <div class="mt-2 flex justify-between text-xs text-muted-foreground">
                  <span class="max-w-[150px] truncate">{{ imagesFileName }}</span>
                  <span>{{ formatFileSize(imagesFileSize) }}</span>
                </div>
                <p class="mt-2 text-center text-xs italic text-muted-foreground">
                  正在将图片转换为 WebP 并压缩…
                </p>
              </div>

              <div
                v-if="imagesUploadProgress > 0 && imagesUploadProgress < 100 && !isImagesProcessing"
                class="rounded-lg border border-border bg-muted/40 p-3 text-sm"
              >
                <div class="mb-2 flex justify-between">
                  <span class="font-medium">上传进度</span>
                  <span class="font-semibold text-primary tabular-nums">{{ imagesUploadProgress }}%</span>
                </div>
                <Progress :model-value="imagesUploadProgress" class="h-2" />
                <div class="mt-2 flex justify-between text-xs text-muted-foreground">
                  <span class="max-w-[150px] truncate">{{ imagesFileName }}</span>
                  <span>{{ formatFileSize(imagesFileSize) }}</span>
                </div>
              </div>

              <Alert v-if="imagesUploadProgress === 100 && !isImagesProcessing" class="border-primary/30">
                <AlertCircle class="size-4 shrink-0 text-primary" aria-hidden="true" />
                <AlertTitle>图片上传成功</AlertTitle>
              </Alert>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <Label for="m-desc">描述 <span class="text-destructive">*</span></Label>
            <Textarea id="m-desc" v-model="form.description" class="min-h-28" rows="4" />
          </div>
        </div>

        <DialogFooter class="gap-2 sm:justify-end">
          <Button type="button" variant="outline" @click="dialogVisible = false">
            取消
          </Button>
          <Button type="button" :disabled="submitting" @click="handleSubmit">
            <Loader2 v-if="submitting" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            确定
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

    <AlertDialog v-model:open="removeLogoDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>移除 Logo</AlertDialogTitle>
          <AlertDialogDescription>
            确定移除当前 Logo 吗？保存前仍可重新上传。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter class="gap-2 sm:justify-end">
          <AlertDialogCancel type="button">
            取消
          </AlertDialogCancel>
          <Button type="button" variant="destructive" @click="confirmRemoveLogo">
            移除
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="removeGalleryImageDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>移除商家图片</AlertDialogTitle>
          <AlertDialogDescription>
            确定移除这张商家图片吗？
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter class="gap-2 sm:justify-end">
          <AlertDialogCancel type="button">
            取消
          </AlertDialogCancel>
          <Button type="button" variant="destructive" @click="confirmRemoveGalleryImage">
            移除
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'
import { AlertCircle, Loader2, Plus, Search, Trash2, Upload } from 'lucide-vue-next'
import { uploadImageToWebpLimit5MB } from '../utils/image'
import { API_BASE_URL } from '../config'
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
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

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

const removeLogoDialogOpen = ref(false)

const removeGalleryImageDialogOpen = ref(false)
const removeGalleryImageIndex = ref(null)

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

function openRemoveLogoDialog() {
  removeLogoDialogOpen.value = true
}

function confirmRemoveLogo() {
  form.value.logo = ''
  removeLogoDialogOpen.value = false
  ElMessage.success('Logo已删除')
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

function openRemoveGalleryImageDialog(index) {
  removeGalleryImageIndex.value = index
  removeGalleryImageDialogOpen.value = true
}

function confirmRemoveGalleryImage() {
  const index = removeGalleryImageIndex.value
  if (index == null || index < 0) return
  form.value.images.splice(index, 1)
  removeGalleryImageDialogOpen.value = false
  removeGalleryImageIndex.value = null
  ElMessage.success('图片已删除')
}

const handleLogoDragEnter = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!isLogoUploading.value && !isLogoProcessing.value && !form.value.logo) {
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

  if (isLogoUploading.value || isLogoProcessing.value || form.value.logo) return

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
  dialogVisible.value = true
}

function validateForm() {
  if (!form.value.name?.trim()) {
    ElMessage.warning('请输入商家名称')
    return false
  }
  if (!form.value.logo) {
    ElMessage.warning('请上传Logo')
    return false
  }
  if (!form.value.description?.trim()) {
    ElMessage.warning('请输入商家描述')
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

onMounted(() => {
  fetchMerchants()
})
</script>
