<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h2 class="text-xl font-semibold tracking-tight text-foreground">
        轮播图管理
      </h2>
      <Button type="button" @click="handleAdd">
        添加轮播图
      </Button>
    </div>

    <Alert v-if="listError && !listLoading" variant="destructive">
      <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
      <AlertTitle>{{ listError }}</AlertTitle>
      <AlertDescription class="mt-2">
        <Button type="button" variant="secondary" size="sm" @click="retryFetchBanners">
          重试
        </Button>
      </AlertDescription>
    </Alert>

    <Card class="relative overflow-hidden shadow-none ring-1">
      <div
        v-if="listLoading"
        class="absolute inset-0 z-10 flex items-center justify-center bg-background/70 backdrop-blur-[1px]"
        aria-busy="true"
        aria-label="加载中"
      >
        <Loader2 class="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
      <CardContent class="overflow-x-auto p-0 sm:p-6">
        <table class="w-full min-w-[800px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="h-10 min-w-[8rem] px-3 text-left font-medium">标题</th>
              <th class="h-10 min-w-[14rem] px-3 text-left font-medium">图片</th>
              <th class="h-10 min-w-[12rem] px-3 text-left font-medium">链接</th>
              <th class="h-10 w-24 px-3 text-left font-medium tabular-nums">排序</th>
              <th class="h-10 w-24 px-3 text-left font-medium">状态</th>
              <th class="h-10 w-36 px-3 text-left font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in banners"
              :key="row.id"
              class="border-b border-border transition-colors hover:bg-muted/30"
            >
              <td class="px-3 py-2.5 font-medium">{{ row.title }}</td>
              <td class="px-3 py-2">
                <div class="h-[100px] w-[200px] overflow-hidden rounded-md border border-border bg-muted/30">
                  <img
                    :src="getImageUrl(row.image_url)"
                    :alt="row.title ? `轮播图：${row.title}` : '轮播图'"
                    class="size-full object-cover"
                    loading="lazy"
                    @error="(e) => { e.target.style.opacity = '0.35' }"
                  >
                </div>
              </td>
              <td class="max-w-xs truncate px-3 py-2.5 text-muted-foreground" :title="row.link_url">
                {{ row.link_url || '—' }}
              </td>
              <td class="px-3 py-2.5 tabular-nums text-muted-foreground">{{ row.sort_order }}</td>
              <td class="px-3 py-2.5">
                <Badge :variant="row.status === 'active' ? 'default' : 'secondary'">
                  {{ row.status === 'active' ? '启用' : '禁用' }}
                </Badge>
              </td>
              <td class="px-3 py-2.5">
                <div class="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="secondary" type="button" @click="handleEdit(row)">
                    编辑
                  </Button>
                  <Button size="sm" variant="destructive" type="button" @click="openDeleteBannerDialog(row)">
                    删除
                  </Button>
                </div>
              </td>
            </tr>
            <tr v-if="banners.length === 0 && !listLoading">
              <td colspan="6" class="px-3 py-12 text-center text-muted-foreground">
                暂无轮播图
              </td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>

    <Dialog v-model:open="dialogVisible">
      <DialogContent class="max-h-[92vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{{ isEdit ? '编辑轮播图' : '添加轮播图' }}</DialogTitle>
        </DialogHeader>

        <div class="grid gap-4 py-2">
          <div class="flex flex-col gap-2">
            <Label for="bn-title">标题</Label>
            <Input id="bn-title" v-model="form.title" autocomplete="off" />
          </div>

          <div class="flex flex-col gap-2">
            <Label>图片 <span class="text-destructive">*</span></Label>
            <div class="max-w-[400px] space-y-3">
              <div
                v-if="form.image_url"
                class="group relative h-[180px] w-full max-w-[300px] overflow-hidden rounded-lg border border-border shadow-sm"
              >
                <img :src="getImageUrl(form.image_url)" alt="轮播图" class="size-full object-cover">
                <div
                  class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Button type="button" size="icon" variant="destructive" @click="openRemoveImageDialog">
                    <Trash2 class="size-4" />
                  </Button>
                  <Button type="button" size="sm" variant="secondary" @click="triggerImageInput">
                    更换图片
                  </Button>
                </div>
              </div>
              <div
                v-else
                class="relative flex h-[180px] w-full max-w-[300px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 transition hover:border-primary/40"
                :class="{
                  'border-primary/50 bg-primary/5': isImageDragOver,
                  'pointer-events-none opacity-70': isImageUploading || isImageProcessing,
                }"
                role="button"
                tabindex="0"
                @click="triggerImageInput"
                @keydown.enter.prevent="triggerImageInput"
                @keydown.space.prevent="triggerImageInput"
                @dragenter="handleImageDragEnter"
                @dragleave="handleImageDragLeave"
                @dragover="handleImageDragOver"
                @drop="handleImageDrop"
              >
                <Loader2
                  v-if="isImageUploading || isImageProcessing"
                  class="mb-2 size-10 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
                <Upload v-else class="mb-2 size-10 text-muted-foreground" aria-hidden="true" />
                <p class="px-2 text-center text-sm font-medium text-foreground">
                  {{ isImageProcessing ? '正在处理图片…' : isImageUploading ? '正在上传…' : '点击或拖拽图片到此处上传' }}
                </p>
                <p class="mt-1 px-2 text-center text-xs text-muted-foreground">
                  支持 JPG、PNG、GIF，自动转 WebP 并压缩至 5MB 以内
                </p>
                <div
                  v-if="isImageDragOver && !form.image_url"
                  class="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-primary/10 font-semibold text-primary"
                >
                  <Upload class="mb-2 size-10" aria-hidden="true" />
                  <span>释放鼠标上传图片</span>
                </div>
              </div>
              <input
                ref="imageInput"
                type="file"
                accept="image/*"
                class="hidden"
                @change="handleImageFileSelect"
              >

              <div v-if="isImageProcessing" class="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <div class="mb-2 flex justify-between text-muted-foreground">
                  <span>图片处理中</span>
                  <span>处理中…</span>
                </div>
                <Progress :model-value="40" class="h-2" />
                <div class="mt-2 flex justify-between text-xs text-muted-foreground">
                  <span class="max-w-[150px] truncate">{{ imageFileName }}</span>
                  <span>{{ formatFileSize(imageFileSize) }}</span>
                </div>
                <p class="mt-2 text-center text-xs italic text-muted-foreground">
                  正在将图片转换为 WebP 并压缩…
                </p>
              </div>

              <div
                v-if="imageUploadProgress > 0 && imageUploadProgress < 100 && !isImageProcessing"
                class="rounded-lg border border-border bg-muted/40 p-3 text-sm"
              >
                <div class="mb-2 flex justify-between">
                  <span class="font-medium">上传进度</span>
                  <span class="font-semibold text-primary tabular-nums">{{ imageUploadProgress }}%</span>
                </div>
                <Progress :model-value="imageUploadProgress" class="h-2" />
                <div class="mt-2 flex justify-between text-xs text-muted-foreground">
                  <span class="max-w-[150px] truncate">{{ imageFileName }}</span>
                  <span>{{ formatFileSize(imageFileSize) }}</span>
                </div>
              </div>

              <Alert v-if="imageUploadProgress === 100 && !isImageProcessing" class="border-primary/30">
                <AlertCircle class="size-4 shrink-0 text-primary" aria-hidden="true" />
                <AlertTitle>图片上传成功</AlertTitle>
              </Alert>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <Label for="bn-link">链接</Label>
            <Input
              id="bn-link"
              v-model="form.link_url"
              placeholder="请输入点击轮播图后跳转的链接"
              autocomplete="off"
            />
          </div>

          <div class="flex flex-col gap-2">
            <Label>链接快捷选择</Label>
            <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div class="flex min-w-[10rem] flex-1 flex-col gap-1.5">
                <span class="text-xs text-muted-foreground">类型</span>
                <select
                  v-model="form.link_type"
                  class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  @change="handleLinkTypeChange"
                >
                  <option value="">选择类型</option>
                  <option v-for="opt in linkTypeOptions" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </select>
              </div>
              <div
                v-if="form.link_type === 'original'"
                class="flex min-w-[12rem] flex-1 flex-col gap-1.5"
              >
                <span class="text-xs text-muted-foreground">艺术家</span>
                <select
                  :value="form.original_artist_id != null ? String(form.original_artist_id) : ''"
                  class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="artistOptionsLoading"
                  @focus="onArtistSelectFocus"
                  @change="onArtistSelectChange"
                >
                  <option value="">{{ artistOptionsLoading ? '加载中…' : '选择艺术家' }}</option>
                  <option v-for="a in artistOptions" :key="a.value" :value="String(a.value)">
                    {{ a.label }}
                  </option>
                </select>
              </div>
              <div class="flex min-w-[14rem] flex-[2] flex-col gap-1.5">
                <span class="text-xs text-muted-foreground">具体项</span>
                <select
                  :value="form.link_id != null ? String(form.link_id) : ''"
                  class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="!form.link_type || (form.link_type === 'original' && !form.original_artist_id) || linkOptionsLoading"
                  @focus="onLinkSelectFocus"
                  @change="onLinkIdSelectChange"
                >
                  <option value="">{{ linkOptionsLoading ? '加载中…' : '选择具体项' }}</option>
                  <option v-for="item in linkOptions" :key="item.value" :value="String(item.value)">
                    {{ item.label }}
                  </option>
                </select>
              </div>
            </div>
            <p v-if="form.link_type && form.link_id" class="text-xs text-muted-foreground">
              将生成：{{ composedLinkPreview }}
            </p>
          </div>

          <div class="flex flex-col gap-2">
            <Label for="bn-sort">排序</Label>
            <Input id="bn-sort" v-model.number="form.sort_order" type="number" min="0" step="1" class="max-w-xs" />
          </div>

          <div class="flex flex-col gap-2">
            <Label for="bn-status">状态</Label>
            <select
              id="bn-status"
              v-model="form.status"
              class="flex h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="active">启用</option>
              <option value="inactive">禁用</option>
            </select>
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

    <!-- 删除轮播图 -->
    <AlertDialog v-model:open="deleteBannerDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除轮播图</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除「{{ deleteBannerTitle }}」吗？此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter class="gap-2 sm:justify-end">
          <AlertDialogCancel type="button">
            取消
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            :disabled="deletingBanner"
            @click="confirmDeleteBanner"
          >
            <Loader2 v-if="deletingBanner" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            删除
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- 移除已选图片 -->
    <AlertDialog v-model:open="removeImageDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>移除图片</AlertDialogTitle>
          <AlertDialogDescription>
            确定移除当前轮播图图片吗？保存前仍可重新上传。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter class="gap-2 sm:justify-end">
          <AlertDialogCancel type="button">
            取消
          </AlertDialogCancel>
          <Button type="button" variant="destructive" @click="confirmRemoveImage">
            移除
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { AlertCircle, Loader2, Trash2, Upload } from 'lucide-vue-next'
import axios from '../utils/axios'
import { API_BASE_URL } from '../config'
import { uploadImageToWebpLimit5MB } from '../utils/image'
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
import { Progress } from '@/components/ui/progress'

const banners = ref([])
const listLoading = ref(false)
const listError = ref('')
const dialogVisible = ref(false)
const isEdit = ref(false)
const submitting = ref(false)

const imageInput = ref(null)
const isImageDragOver = ref(false)
const imageUploadProgress = ref(0)
const isImageUploading = ref(false)
const isImageProcessing = ref(false)
const imageFileName = ref('')
const imageFileSize = ref(0)

const deleteBannerDialogOpen = ref(false)
const deleteBannerTarget = ref(null)
const deletingBanner = ref(false)

const removeImageDialogOpen = ref(false)

const deleteBannerTitle = computed(() => {
  const row = deleteBannerTarget.value
  if (!row) return '该轮播图'
  return row.title || '未命名'
})

const form = ref({
  title: '',
  image_url: '',
  link_url: '',
  sort_order: 0,
  status: 'active',
  link_type: '',
  link_id: null,
  original_artist_id: null,
})

const linkTypeOptions = [
  { label: '数字艺术品', value: 'digital' },
  { label: '权益', value: 'rights' },
  { label: '原作', value: 'original' },
  { label: '展览', value: 'exhibition' },
  { label: '艺术家', value: 'artist' },
]
const linkOptionsLoading = ref(false)
const linkOptions = ref([])
const artistOptionsLoading = ref(false)
const artistOptions = ref([])
const ORIGINAL_PAGE_SIZE = 50
const ORIGINAL_MAX_PAGES = 5
const linkPathMap = {
  digital: '/pages/digital/detail',
  rights: '/pages/rights/detail',
  original: '/pages/artwork/detail',
  exhibition: '/pages/exhibition/detail',
  artist: '/pages/artist/detail',
}
const composedLinkPreview = computed(() => {
  if (!form.value.link_type || !form.value.link_id) return ''
  const base = linkPathMap[form.value.link_type]
  return `${base}?id=${form.value.link_id}`
})

const retryFetchBanners = () => {
  listError.value = ''
  fetchBanners()
}

const fetchBanners = async () => {
  listLoading.value = true
  listError.value = ''
  try {
    const res = await axios.get('/banners/all')
    const arr = Array.isArray(res) ? res : []
    banners.value = arr.map((banner) => ({
      ...banner,
      image_url: getImageUrl(banner.image_url),
    }))
  } catch (error) {
    console.error('获取轮播图列表失败：', error)
    banners.value = []
    listError.value = '获取轮播图列表失败，请检查网络或稍后重试'
  } finally {
    listLoading.value = false
  }
}

const handleAdd = () => {
  isEdit.value = false
  form.value = {
    title: '',
    image_url: '',
    link_url: '',
    sort_order: 0,
    status: 'active',
    link_type: '',
    link_id: null,
    original_artist_id: null,
  }
  resetImageUploadState()
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  form.value = { ...row }
  tryParseExistingLink(row.link_url)
  resetImageUploadState()
  dialogVisible.value = true
}

function openDeleteBannerDialog(row) {
  deleteBannerTarget.value = row
  deleteBannerDialogOpen.value = true
}

async function confirmDeleteBanner() {
  const row = deleteBannerTarget.value
  if (!row?.id) return
  deletingBanner.value = true
  try {
    await axios.delete(`/banners/${row.id}`)
    ElMessage.success('删除成功')
    deleteBannerDialogOpen.value = false
    deleteBannerTarget.value = null
    fetchBanners()
  } catch (error) {
    ElMessage.error('删除失败')
  } finally {
    deletingBanner.value = false
  }
}

const triggerImageInput = () => {
  if (!isImageUploading.value && !isImageProcessing.value) imageInput.value?.click()
}

const handleImageFileSelect = (event) => {
  const file = event.target.files[0]
  if (file) uploadImageFile(file)
  event.target.value = ''
}

const uploadImageFile = async (file) => {
  imageUploadProgress.value = 0
  isImageUploading.value = true
  isImageProcessing.value = true
  imageFileName.value = file.name
  imageFileSize.value = file.size

  try {
    const processedFile = await uploadImageToWebpLimit5MB(file)

    if (!processedFile) {
      resetImageUploadState()
      return
    }

    isImageProcessing.value = false
    imageFileName.value = processedFile.name
    imageFileSize.value = processedFile.size

    const formData = new FormData()
    formData.append('file', processedFile)

    const response = await axios.post(`${API_BASE_URL}/api/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          imageUploadProgress.value = percent
        } else {
          imageUploadProgress.value = Math.min(imageUploadProgress.value + 10, 90)
        }
      },
    })

    handleImageUploadSuccess(response)
  } catch (error) {
    handleImageUploadError(error)
  }
}

const handleImageUploadSuccess = (response) => {
  let imageUrl = ''

  if (response && response.url) {
    imageUrl = response.url
  } else if (response && response.data && response.data.url) {
    imageUrl = response.data.url
  } else if (response && response.data && typeof response.data === 'string') {
    imageUrl = response.data
  } else if (typeof response === 'string') {
    imageUrl = response
  } else if (response && response.path) {
    imageUrl = response.path
  } else if (response && response.file) {
    imageUrl = response.file
  } else if (response && response.filename) {
    imageUrl = response.filename
  }

  if (imageUrl) {
    form.value.image_url = imageUrl
    imageUploadProgress.value = 100

    setTimeout(() => {
      imageUploadProgress.value = 0
      isImageUploading.value = false
      imageFileName.value = ''
      imageFileSize.value = 0
    }, 2000)

    ElMessage.success('图片上传成功')
  } else {
    ElMessage.error('图片上传失败：未获取到图片URL')
    resetImageUploadState()
  }
}

const handleImageUploadError = (error) => {
  console.error('图片上传错误:', error)
  ElMessage.error('图片上传失败：' + (error.response?.data?.message || '未知错误'))
  resetImageUploadState()
}

const resetImageUploadState = () => {
  imageUploadProgress.value = 0
  isImageUploading.value = false
  isImageProcessing.value = false
  imageFileName.value = ''
  imageFileSize.value = 0
}

function openRemoveImageDialog() {
  removeImageDialogOpen.value = true
}

function confirmRemoveImage() {
  form.value.image_url = ''
  removeImageDialogOpen.value = false
  ElMessage.success('图片已删除')
}

const handleImageDragEnter = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!isImageUploading.value && !isImageProcessing.value && !form.value.image_url) {
    isImageDragOver.value = true
  }
}

const handleImageDragLeave = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!e.currentTarget.contains(e.relatedTarget)) {
    isImageDragOver.value = false
  }
}

const handleImageDragOver = (e) => {
  e.preventDefault()
  e.stopPropagation()
}

const handleImageDrop = (e) => {
  e.preventDefault()
  e.stopPropagation()
  isImageDragOver.value = false

  if (isImageUploading.value || isImageProcessing.value || form.value.image_url) return

  const files = e.dataTransfer.files
  if (files.length > 0) uploadImageFile(files[0])
}

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const getImageUrl = (url) => {
  if (!url) return ''
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`
}

const handleSubmit = async () => {
  if (!form.value.title.trim()) {
    ElMessage.warning('请输入轮播图标题')
    return
  }
  if (!form.value.image_url) {
    ElMessage.warning('请上传轮播图图片')
    return
  }

  submitting.value = true
  try {
    const submitData = {
      ...form.value,
    }

    if (isEdit.value) {
      await axios.put(`/banners/${form.value.id}`, submitData)
    } else {
      await axios.post('/banners', submitData)
    }
    ElMessage.success('保存成功')
    dialogVisible.value = false
    fetchBanners()
  } catch (error) {
    ElMessage.error('保存失败')
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  fetchBanners()
})

function handleLinkTypeChange() {
  form.value.link_id = null
  form.value.original_artist_id = null
  linkOptions.value = []
  artistOptions.value = []
  if (form.value.link_type) {
    if (form.value.link_type === 'original') {
      loadArtistOptions()
    } else {
      loadLinkOptions()
    }
  }
}

async function onLinkSelectFocus() {
  if (!form.value.link_type) return
  if (form.value.link_type === 'original') {
    if (!form.value.original_artist_id) return
    if (linkOptions.value.length === 0) await loadLinkOptions()
  } else if (linkOptions.value.length === 0) {
    await loadLinkOptions()
  }
}

async function onArtistSelectFocus() {
  if (form.value.link_type === 'original' && artistOptions.value.length === 0) {
    await loadArtistOptions()
  }
}

async function loadLinkOptions() {
  if (!form.value.link_type) return
  linkOptionsLoading.value = true
  try {
    let items = []
    if (form.value.link_type === 'digital') {
      const res = await axios.get('/digital-artworks/admin', { params: { page: 1, pageSize: 50 } })
      items = Array.isArray(res) ? res : []
      linkOptions.value = items.map((it) => ({ value: it.id, label: it.title }))
    } else if (form.value.link_type === 'rights') {
      const res = await axios.get('/rights', { params: { page: 1, limit: 50 } })
      items = (res && Array.isArray(res.data)) ? res.data : (res && Array.isArray(res.data?.data)) ? res.data.data : (Array.isArray(res?.data) ? res.data : [])
      linkOptions.value = (items || []).map((it) => ({ value: it.id, label: it.title }))
    } else if (form.value.link_type === 'exhibition') {
      const res = await axios.get('/exhibitions', { params: { status: 'published', page: 1, pageSize: 100 } })
      items = (res && Array.isArray(res.data)) ? res.data : (Array.isArray(res?.data?.data) ? res.data.data : [])
      linkOptions.value = (items || []).map((it) => ({ value: it.id, label: it.title }))
    } else if (form.value.link_type === 'original') {
      const aggregated = []
      for (let page = 1; page <= ORIGINAL_MAX_PAGES; page++) {
        const params = { page, pageSize: ORIGINAL_PAGE_SIZE }
        if (form.value.original_artist_id) params.artist_id = form.value.original_artist_id
        const res = await axios.get('/original-artworks', { params })
        const pageItems = res && Array.isArray(res.data) ? res.data : (res && Array.isArray(res.data?.data)) ? res.data.data : []
        if (pageItems.length === 0) break
        aggregated.push(...pageItems)
        if (pageItems.length < ORIGINAL_PAGE_SIZE) break
      }
      items = aggregated
      linkOptions.value = aggregated.map((it) => ({ value: it.id, label: it.title }))
    } else if (form.value.link_type === 'artist') {
      const res = await axios.get('/artists')
      items = Array.isArray(res) ? res : (res && res.data && Array.isArray(res.data) ? res.data : [])
      linkOptions.value = items.map((it) => ({ value: it.id, label: it.name }))
    }
  } catch (err) {
    console.error('加载链接选项失败:', err)
    ElMessage.error('加载链接选项失败')
  } finally {
    linkOptionsLoading.value = false
  }
}

async function loadArtistOptions() {
  artistOptionsLoading.value = true
  try {
    const res = await axios.get('/artists')
    const arr = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : [])
    artistOptions.value = arr.map((a) => ({ value: a.id, label: a.name }))
  } catch (e) {
    console.error('加载艺术家失败:', e)
    ElMessage.error('加载艺术家失败')
  } finally {
    artistOptionsLoading.value = false
  }
}

async function onArtistSelectChange(e) {
  const v = e.target.value
  form.value.original_artist_id = v === '' ? null : Number(v)
  form.value.link_id = null
  linkOptions.value = []
  if (form.value.original_artist_id) {
    await loadLinkOptions()
  }
}

function onLinkIdSelectChange(e) {
  const v = e.target.value
  form.value.link_id = v === '' ? null : Number(v)
  applyComposedLink()
}

function applyComposedLink() {
  if (form.value.link_type && form.value.link_id) {
    const base = linkPathMap[form.value.link_type]
    form.value.link_url = `${base}?id=${form.value.link_id}`
  }
}

function tryParseExistingLink(url) {
  if (!url || typeof url !== 'string') return
  const match = url.match(/^\/pages\/(digital|rights|original|artist|artwork|exhibition|exhibitions)\/detail\?id=(\d+)$/)
  if (match) {
    let type = match[1]
    if (type === 'artwork') type = 'original'
    if (type === 'exhibitions') type = 'exhibition'
    if (type === 'exhibition') type = 'exhibition'
    const id = parseInt(match[2])
    form.value.link_type = type
    form.value.link_id = id
    loadLinkOptions()
  } else {
    form.value.link_type = ''
    form.value.link_id = null
  }
}
</script>
