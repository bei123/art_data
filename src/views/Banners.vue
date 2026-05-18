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
      <DialogContent class="flex max-h-[92vh] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader class="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle>{{ isEdit ? '编辑轮播图' : '添加轮播图' }}</DialogTitle>
          <DialogDescription>
            <template v-if="isEdit">
              正在编辑「{{ form.title || '未命名' }}」<span v-if="form.id" class="text-muted-foreground">（ID {{ form.id }}）</span>
            </template>
            <template v-else>
              上传轮播图并填写信息；带 <span class="text-destructive">*</span> 为必填
            </template>
          </DialogDescription>
        </DialogHeader>

        <div class="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(280px,360px)_1fr]">
          <div class="flex flex-col gap-3 border-border bg-muted/15 p-4 lg:border-r">
            <div class="flex flex-col gap-2">
              <Label>轮播图片 <span class="text-destructive">*</span></Label>
              <input
                ref="imageInput"
                type="file"
                accept="image/*"
                class="hidden"
                @change="handleImageFileSelect"
              >
              <div
                class="relative aspect-[2/1] w-full cursor-pointer overflow-hidden rounded-lg border-2 border-dashed border-border bg-background transition hover:border-primary/40"
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
                <img
                  v-if="form.image_url"
                  :src="getImageUrl(form.image_url)"
                  alt="轮播图预览"
                  class="size-full object-cover"
                  loading="lazy"
                >
                <div v-else class="flex size-full flex-col items-center justify-center gap-2 p-4 text-center">
                  <Upload class="size-10 text-muted-foreground" aria-hidden="true" />
                  <p class="text-sm font-medium">上传轮播图</p>
                  <p class="text-xs text-muted-foreground">建议 2:1 横图，JPG / PNG / GIF，≤5MB</p>
                </div>
                <div
                  v-if="isImageDragOver"
                  class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-primary/10 text-sm font-medium text-primary"
                >
                  释放以上传
                </div>
                <div
                  v-if="form.image_url && !isImageUploading && !isImageProcessing"
                  class="absolute right-2 top-2 flex gap-1"
                >
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    class="size-8 bg-background/90 shadow-sm"
                    aria-label="更换图片"
                    @click.stop="triggerImageInput"
                  >
                    <Upload class="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="destructive"
                    class="size-8 shadow-sm"
                    aria-label="移除图片"
                    @click.stop="clearBannerImage"
                  >
                    <X class="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <div
                v-if="isImageProcessing || (imageUploadProgress > 0 && imageUploadProgress < 100)"
                class="rounded-lg border border-border bg-background p-2 text-xs text-muted-foreground"
              >
                <Progress :model-value="isImageProcessing ? 40 : imageUploadProgress" class="h-1.5" />
                <p class="mt-1.5 text-center">
                  {{ isImageProcessing ? '处理中…' : `上传中 ${imageUploadProgress}%` }}
                </p>
              </div>
            </div>
            <p class="text-xs text-muted-foreground">
              跳转链接与排序在右侧 Tab 中设置。
            </p>
          </div>

          <div class="flex min-h-0 flex-col">
            <Tabs v-model="bannerFormTab" class="flex min-h-0 flex-1 flex-col">
              <div class="shrink-0 border-b border-border px-4 pt-3">
                <TabsList class="grid h-auto w-full grid-cols-2 gap-1">
                  <TabsTrigger value="basic" class="text-xs sm:text-sm">
                    基本信息
                  </TabsTrigger>
                  <TabsTrigger value="link" class="text-xs sm:text-sm">
                    跳转链接
                  </TabsTrigger>
                </TabsList>
              </div>

              <ScrollArea class="min-h-[320px] flex-1 lg:max-h-[min(56vh,560px)]">
                <TabsContent value="basic" class="mt-0 space-y-4 p-4">
                  <div class="flex flex-col gap-2">
                    <Label for="bn-title">标题 <span class="text-destructive">*</span></Label>
                    <Input id="bn-title" v-model="form.title" autocomplete="off" placeholder="轮播图标题" />
                  </div>
                  <div class="flex flex-col gap-2">
                    <Label for="bn-sort">排序</Label>
                    <Input
                      id="bn-sort"
                      v-model.number="form.sort_order"
                      type="number"
                      min="0"
                      step="1"
                      class="max-w-[160px]"
                    />
                    <p class="text-xs text-muted-foreground">数值越小越靠前</p>
                  </div>
                  <div class="flex flex-col gap-2">
                    <Label for="bn-status">状态</Label>
                    <Select
                      :model-value="form.status"
                      @update:model-value="(v) => { form.status = v }"
                    >
                      <SelectTrigger id="bn-status" class="max-w-[200px]">
                        <SelectValue placeholder="选择状态" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">启用</SelectItem>
                        <SelectItem value="inactive">禁用</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </TabsContent>

                <TabsContent value="link" class="mt-0 space-y-4 p-4">
                  <div class="flex flex-col gap-2">
                    <Label for="bn-link">跳转链接</Label>
                    <Input
                      id="bn-link"
                      v-model="form.link_url"
                      placeholder="小程序页面路径，如 /pages/artwork/detail?id=1"
                      autocomplete="off"
                    />
                    <p class="text-xs text-muted-foreground">
                      可手动填写，或通过下方快捷选择自动生成
                    </p>
                  </div>

                  <div class="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
                    <p class="text-sm font-medium">链接快捷选择</p>
                    <div class="grid gap-4 sm:grid-cols-2">
                      <div class="flex flex-col gap-2">
                        <Label class="text-xs text-muted-foreground">类型</Label>
                        <Select
                          :model-value="form.link_type || LINK_TYPE_NONE"
                          @update:model-value="onLinkTypeSelectChange"
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="选择类型" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem :value="LINK_TYPE_NONE">选择类型</SelectItem>
                            <SelectItem
                              v-for="opt in linkTypeOptions"
                              :key="opt.value"
                              :value="opt.value"
                            >
                              {{ opt.label }}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div
                        v-if="form.link_type === 'original'"
                        class="flex flex-col gap-2"
                      >
                        <Label class="text-xs text-muted-foreground">艺术家</Label>
                        <Select
                          :model-value="artistSelectValue"
                          :disabled="artistOptionsLoading"
                          @update:model-value="onArtistSelectChange"
                          @update:open="(open) => open && onArtistSelectFocus()"
                        >
                          <SelectTrigger>
                            <SelectValue :placeholder="artistOptionsLoading ? '加载中…' : '选择艺术家'" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem :value="LINK_TYPE_NONE">选择艺术家</SelectItem>
                            <SelectItem
                              v-for="a in artistOptions"
                              :key="a.value"
                              :value="String(a.value)"
                            >
                              {{ a.label }}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div
                        class="flex flex-col gap-2"
                        :class="form.link_type === 'original' ? 'sm:col-span-2' : ''"
                      >
                        <Label class="text-xs text-muted-foreground">具体项</Label>
                        <Select
                          :model-value="linkIdSelectValue"
                          :disabled="!form.link_type || (form.link_type === 'original' && !form.original_artist_id) || linkOptionsLoading"
                          @update:model-value="onLinkIdSelectChange"
                          @update:open="(open) => open && onLinkSelectFocus()"
                        >
                          <SelectTrigger>
                            <SelectValue :placeholder="linkOptionsLoading ? '加载中…' : '选择具体项'" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem :value="LINK_TYPE_NONE">选择具体项</SelectItem>
                            <SelectItem
                              v-for="item in linkOptions"
                              :key="item.value"
                              :value="String(item.value)"
                            >
                              {{ item.label }}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <p v-if="form.link_type && form.link_id" class="text-xs text-muted-foreground">
                      将生成：<code class="rounded bg-muted px-1 py-0.5 text-[11px]">{{ composedLinkPreview }}</code>
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
            {{ isEdit ? '保存' : '添加' }}
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

  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { AlertCircle, Loader2, Upload, X } from 'lucide-vue-next'
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const route = useRoute()
const router = useRouter()

const LINK_TYPE_NONE = '_none'
const bannerFormTab = ref('basic')

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

const artistSelectValue = computed(() => {
  if (form.value.original_artist_id == null) return LINK_TYPE_NONE
  return String(form.value.original_artist_id)
})

const linkIdSelectValue = computed(() => {
  if (form.value.link_id == null) return LINK_TYPE_NONE
  return String(form.value.link_id)
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
  bannerFormTab.value = 'basic'
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  form.value = { ...row }
  tryParseExistingLink(row.link_url)
  resetImageUploadState()
  bannerFormTab.value = 'basic'
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

function clearBannerImage() {
  form.value.image_url = ''
}

const handleImageDragEnter = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!isImageUploading.value && !isImageProcessing.value) {
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

  if (isImageUploading.value || isImageProcessing.value) return

  const files = e.dataTransfer.files
  if (files.length > 0) uploadImageFile(files[0])
}

const getImageUrl = (url) => {
  if (!url) return ''
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`
}

const handleSubmit = async () => {
  if (!form.value.title.trim()) {
    ElMessage.warning('请输入轮播图标题')
    bannerFormTab.value = 'basic'
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

async function openEditFromRouteQuery() {
  const raw = route.query.edit
  if (!raw) return
  const id = Number(raw)
  if (!id) return

  const row = banners.value.find((b) => b.id === id)
  if (row) {
    handleEdit(row)
  } else {
    ElMessage.error('未找到该轮播图')
  }

  const nextQuery = { ...route.query }
  delete nextQuery.edit
  router.replace({ path: route.path, query: nextQuery })
}

onMounted(async () => {
  await fetchBanners()
  await openEditFromRouteQuery()
})

function onLinkTypeSelectChange(v) {
  form.value.link_type = v === LINK_TYPE_NONE ? '' : v
  handleLinkTypeChange()
}

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

async function onArtistSelectChange(v) {
  form.value.original_artist_id = v === LINK_TYPE_NONE ? null : Number(v)
  form.value.link_id = null
  linkOptions.value = []
  if (form.value.original_artist_id) {
    await loadLinkOptions()
  }
}

function onLinkIdSelectChange(v) {
  form.value.link_id = v === LINK_TYPE_NONE ? null : Number(v)
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
