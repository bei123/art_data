<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h2 class="text-xl font-semibold tracking-tight text-foreground">
        版权实物管理
      </h2>
      <Button type="button" @click="handleAdd">
        添加版权实物
      </Button>
    </div>

    <Alert v-if="listError && !listLoading" variant="destructive">
      <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
      <AlertTitle>{{ listError }}</AlertTitle>
      <AlertDescription class="mt-2">
        <Button type="button" variant="secondary" size="sm" @click="retryFetchRights">
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
        <table class="w-full min-w-[1100px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="h-10 min-w-[12rem] px-3 text-left font-medium">图片</th>
              <th class="h-10 px-3 text-left font-medium">标题</th>
              <th class="h-10 w-24 px-3 text-left font-medium">状态</th>
              <th class="h-10 min-w-[6rem] px-3 text-left font-medium">价格</th>
              <th class="h-10 w-28 px-3 text-left font-medium">剩余</th>
              <th class="h-10 px-3 text-left font-medium">所属分类</th>
              <th class="h-10 min-w-[10rem] px-3 text-left font-medium">关联艺术家</th>
              <th class="h-10 w-44 px-3 text-left font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rights"
              :key="row.id"
              class="border-b border-border transition-colors hover:bg-muted/30"
            >
              <td class="px-3 py-2">
                <div class="flex max-w-[14rem] flex-wrap gap-1.5">
                  <button
                    v-for="(image, index) in row.images"
                    :key="index"
                    type="button"
                    class="relative size-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring"
                    :aria-label="row.title ? `预览：${row.title} 第 ${index + 1} 张` : `预览第 ${index + 1} 张`"
                    @click="openImagePreview(row.images, index, row.title)"
                  >
                    <img
                      :src="getImageUrl(image)"
                      :alt="row.title ? `${row.title} 配图 ${index + 1}` : '版权实物配图'"
                      class="size-full object-cover"
                      loading="lazy"
                    >
                  </button>
                </div>
              </td>
              <td class="max-w-[12rem] truncate px-3 py-2.5 font-medium" :title="row.title">{{ row.title }}</td>
              <td class="px-3 py-2.5">
                <Badge :variant="getStatusBadgeVariant(row.status)">
                  {{ getStatusText(row.status) }}
                </Badge>
              </td>
              <td class="px-3 py-2.5 tabular-nums">
                <div>¥{{ row.price }}</div>
                <div v-if="row.discount_amount > 0" class="mt-0.5 text-xs text-destructive">
                  可抵扣: ¥{{ row.discount_amount }}
                </div>
              </td>
              <td class="px-3 py-2.5 tabular-nums text-muted-foreground">
                {{ row.remainingCount }}/{{ row.totalCount }}
              </td>
              <td class="max-w-[10rem] truncate px-3 py-2.5" :title="row.category_title">
                {{ row.category_title }}
              </td>
              <td class="px-3 py-2.5">
                <div v-if="row.artist" class="flex min-w-0 items-center gap-2">
                  <Avatar class="size-8 shrink-0 border border-border">
                    <AvatarImage :src="getImageUrl(row.artist.avatar)" :alt="row.artist.name" />
                    <AvatarFallback class="text-xs">{{ row.artist.name?.charAt(0) || '?' }}</AvatarFallback>
                  </Avatar>
                  <span class="min-w-0 truncate text-sm">{{ row.artist.name }}</span>
                </div>
                <span v-else class="text-sm italic text-muted-foreground">未关联</span>
              </td>
              <td class="px-3 py-2.5">
                <div class="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="secondary" type="button" @click="handleEdit(row)">
                    编辑
                  </Button>
                  <Button size="sm" variant="destructive" type="button" @click="handleDelete(row)">
                    删除
                  </Button>
                </div>
              </td>
            </tr>
            <tr v-if="rights.length === 0 && !listLoading">
              <td colspan="8" class="px-3 py-12 text-center text-muted-foreground">
                暂无版权实物数据
              </td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>

    <Dialog v-model:open="dialogVisible">
      <DialogContent class="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{{ isEdit ? '编辑版权实物' : '添加版权实物' }}</DialogTitle>
        </DialogHeader>

        <div class="grid max-h-[75vh] gap-4 overflow-y-auto py-2 pr-1">
          <div class="flex flex-col gap-2">
            <Label for="r-title">标题</Label>
            <Input id="r-title" v-model="form.title" autocomplete="off" />
          </div>

          <div class="flex flex-col gap-2">
            <Label for="r-status">状态</Label>
            <select
              id="r-status"
              v-model="form.status"
              class="flex h-10 w-full max-w-md rounded-lg border border-input bg-transparent px-3 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option disabled value="">
                请选择状态
              </option>
              <option value="onsale">在售</option>
              <option value="soldout">已售罄</option>
              <option value="upcoming">即将发售</option>
            </select>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="flex flex-col gap-2">
              <Label for="r-price">价格</Label>
              <Input id="r-price" v-model.number="form.price" type="number" min="0" step="0.01" />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="r-dp">优惠价</Label>
              <Input id="r-dp" v-model.number="form.discount_price" type="number" min="0" step="0.01" />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="r-op">原价</Label>
              <Input id="r-op" v-model.number="form.originalPrice" type="number" min="0" step="0.01" />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="r-da">可抵扣金额</Label>
              <Input id="r-da" v-model.number="form.discountAmount" type="number" min="0" step="0.01" />
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <Label>可享优惠的数字资产</Label>
            <Input v-model="digitalFilter" placeholder="筛选标题…" class="max-w-md" />
            <p class="text-xs text-muted-foreground">
              不选择则不限制，设置后仅拥有所选数字资产的用户可享受优惠价。
            </p>
            <div class="max-h-48 overflow-y-auto rounded-lg border border-border p-2">
              <ul class="space-y-2">
                <li v-for="item in filteredDigitalOptions" :key="item.id" class="flex items-start gap-2">
                  <input
                    type="checkbox"
                    class="mt-1 size-4 shrink-0 rounded border border-input accent-primary"
                    :checked="eligibleIdSet.has(Number(item.id))"
                    @change="toggleEligibleDigital(Number(item.id), $event.target.checked)"
                  >
                  <span class="min-w-0 text-sm leading-snug">{{ item.title }}</span>
                </li>
              </ul>
              <p v-if="filteredDigitalOptions.length === 0" class="py-4 text-center text-sm text-muted-foreground">
                无匹配项
              </p>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <Label for="r-period">期限</Label>
            <Input id="r-period" v-model="form.period" />
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="flex flex-col gap-2">
              <Label for="r-total">总数量</Label>
              <Input id="r-total" v-model.number="form.totalCount" type="number" min="0" step="1" />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="r-rem">剩余数量</Label>
              <Input
                id="r-rem"
                v-model.number="form.remainingCount"
                type="number"
                min="0"
                :max="form.totalCount"
                step="1"
              />
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <Label for="r-cat">所属分类</Label>
            <select
              id="r-cat"
              class="flex h-10 w-full max-w-md rounded-lg border border-input bg-transparent px-3 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              :value="form.category_id == null ? '' : String(form.category_id)"
              @change="onCategoryChange"
            >
              <option disabled value="">
                请选择分类
              </option>
              <option v-for="cat in categories" :key="cat.id" :value="String(cat.id)">
                {{ cat.title }}
              </option>
            </select>
          </div>

          <div class="flex flex-col gap-2">
            <Label for="r-artist">关联艺术家</Label>
            <select
              id="r-artist"
              class="flex h-10 w-full max-w-md rounded-lg border border-input bg-transparent px-3 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              :value="form.artist_id == null ? '' : String(form.artist_id)"
              @change="onArtistChange"
            >
              <option value="">（不关联）</option>
              <option v-for="artist in artists" :key="artist.id" :value="String(artist.id)">
                {{ artist.name }}
              </option>
            </select>
          </div>

          <div class="flex flex-col gap-2">
            <Label for="r-desc">描述</Label>
            <Textarea id="r-desc" v-model="form.description" class="min-h-24" rows="4" />
          </div>

          <div class="flex flex-col gap-2">
            <Label>图片 <span class="text-destructive">*</span></Label>
            <p class="text-xs text-muted-foreground">
              最多 5 张，支持多选文件或拖拽到下方区域。
            </p>
            <div class="flex flex-wrap gap-3">
              <div
                v-for="(image, index) in form.images"
                :key="index"
                class="group relative size-[120px] shrink-0 overflow-hidden rounded-lg border border-border shadow-sm"
              >
                <img :src="getImageUrl(image)" alt="配图" class="size-full object-cover">
                <div
                  class="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Button type="button" size="icon" variant="destructive" @click="removeImage(index)">
                    <Trash2 class="size-4" />
                  </Button>
                </div>
              </div>

              <div
                v-if="form.images.length < 5"
                class="flex size-[120px] shrink-0 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 transition hover:border-primary/40"
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
                  class="mb-1 size-8 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
                <Plus v-else class="mb-1 size-8 text-muted-foreground" aria-hidden="true" />
                <span class="text-xs font-medium">添加图片</span>
                <span class="mt-0.5 text-[10px] text-muted-foreground">还可 {{ 5 - form.images.length }} 张</span>
              </div>
            </div>
            <input
              ref="imageInput"
              type="file"
              accept="image/*"
              multiple
              class="hidden"
              @change="handleImageFileSelect"
            >

            <div v-if="isImageProcessing" class="max-w-md rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <div class="mb-2 flex justify-between text-muted-foreground">
                <span>图片处理中</span>
                <span>处理中…</span>
              </div>
              <Progress :model-value="40" class="h-2" />
              <div class="mt-2 flex justify-between text-xs text-muted-foreground">
                <span class="max-w-[150px] truncate">{{ imageFileName }}</span>
                <span>{{ formatFileSize(imageFileSize) }}</span>
              </div>
            </div>
            <div
              v-if="imageUploadProgress > 0 && imageUploadProgress < 100 && !isImageProcessing"
              class="max-w-md rounded-lg border border-border bg-muted/40 p-3 text-sm"
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
            <Alert v-if="imageUploadProgress === 100" class="max-w-md border-primary/30">
              <AlertCircle class="size-4 shrink-0 text-primary" aria-hidden="true" />
              <AlertTitle>图片上传成功</AlertTitle>
            </Alert>
          </div>

          <div class="flex flex-col gap-2">
            <Label>富文本内容</Label>
            <div class="overflow-hidden rounded-lg border border-border">
              <Toolbar :editor="editorRef" class="w-full border-b border-border" />
              <Editor
                v-model="richTextHtml"
                :default-config="{ placeholder: '请输入富文本内容...', ...editorConfig }"
                mode="default"
                class="min-h-[300px] w-full min-w-0"
                style="min-height: 300px"
                @onCreated="handleEditorCreated"
              />
            </div>
          </div>
        </div>

        <DialogFooter class="gap-2 sm:justify-end">
          <Button type="button" variant="outline" @click="dialogVisible = false">
            取消
          </Button>
          <Button type="button" @click="handleSubmit">
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="previewOpen">
      <DialogContent class="max-h-[90vh] max-w-[calc(100%-2rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{{ previewTitle || '图片预览' }}</DialogTitle>
        </DialogHeader>
        <div class="flex flex-col items-center gap-4">
          <img
            v-if="previewUrls.length"
            :src="previewUrls[previewIndex]"
            alt="预览"
            class="max-h-[70vh] w-full object-contain"
          >
          <div v-if="previewUrls.length > 1" class="flex w-full items-center justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              :disabled="previewIndex <= 0"
              @click="previewIndex--"
            >
              上一张
            </Button>
            <span class="text-sm text-muted-foreground tabular-nums">{{ previewIndex + 1 }} / {{ previewUrls.length }}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              :disabled="previewIndex >= previewUrls.length - 1"
              @click="previewIndex++"
            >
              下一张
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { AlertCircle, Loader2, Plus, Trash2 } from 'lucide-vue-next'
import axios from '../utils/axios'
import { API_BASE_URL, isOssPublicUrl } from '../config'
import { uploadImageToWebpLimit5MB } from '../utils/image'
import '@wangeditor/editor/dist/css/style.css'
import { Editor, Toolbar } from '@wangeditor/editor-for-vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
import { Textarea } from '@/components/ui/textarea'

const listLoading = ref(false)
const listError = ref('')
const rights = ref([])
const dialogVisible = ref(false)
const isEdit = ref(false)
const categories = ref([])
const artists = ref([])
const digitalOptions = ref([])
const digitalFilter = ref('')

const filteredDigitalOptions = computed(() => {
  const q = digitalFilter.value.trim().toLowerCase()
  if (!q) return digitalOptions.value
  return digitalOptions.value.filter((d) =>
    String(d.title ?? '')
      .toLowerCase()
      .includes(q)
  )
})

const form = ref({
  title: '',
  status: '',
  price: 0,
  discount_price: 0,
  originalPrice: 0,
  discountAmount: 0,
  period: '',
  totalCount: 0,
  remainingCount: 0,
  description: '',
  images: [],
  category_id: null,
  artist_id: null,
  eligible_digital_artwork_ids: []
})

const eligibleIdSet = computed(() => new Set(form.value.eligible_digital_artwork_ids || []))

const editorRef = ref(null)
const richTextHtml = ref('')

const imageInput = ref(null)
const isImageDragOver = ref(false)
const imageUploadProgress = ref(0)
const isImageUploading = ref(false)
const isImageProcessing = ref(false)
const imageFileName = ref('')
const imageFileSize = ref(0)

const previewOpen = ref(false)
const previewUrls = ref([])
const previewIndex = ref(0)
const previewTitle = ref('')

const editorConfig = {
  MENU_CONF: {
    uploadImage: {
      async customUpload(file, insertFn) {
        const processedFile = await uploadImageToWebpLimit5MB(file)
        if (!processedFile) {
          ElMessage.error('图片处理失败')
          return
        }
        const formData = new FormData()
        formData.append('file', processedFile)
        try {
          const result = await axios.post('/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          })
          let url = ''
          if (result?.url) url = result.url
          else if (result?.data?.url) url = result.data.url
          else if (typeof result?.data === 'string') url = result.data
          if (typeof url === 'string' && url) {
            insertFn(url)
            ElMessage.success('图片上传成功')
          } else {
            ElMessage.error(result?.message || '图片上传失败')
          }
        } catch {
          ElMessage.error('图片上传异常')
        }
      }
    }
  }
}

watch(dialogVisible, (val) => {
  if (val) {
    nextTick(() => {
      richTextHtml.value = form.value.rich_text || ''
    })
  }
})

function onCategoryChange(e) {
  const v = e.target.value
  form.value.category_id = v === '' ? null : Number(v)
}

function onArtistChange(e) {
  const v = e.target.value
  form.value.artist_id = v === '' ? null : Number(v)
}

function toggleEligibleDigital(id, checked) {
  const arr = [...(form.value.eligible_digital_artwork_ids || [])]
  if (checked) {
    if (!arr.includes(id)) arr.push(id)
  } else {
    const i = arr.indexOf(id)
    if (i !== -1) arr.splice(i, 1)
  }
  form.value.eligible_digital_artwork_ids = arr
}

function openImagePreview(images, index, title) {
  if (!images?.length) return
  previewUrls.value = images.map((img) => getImageUrl(img))
  previewIndex.value = Math.min(Math.max(0, index), previewUrls.value.length - 1)
  previewTitle.value = title || ''
  previewOpen.value = true
}

function getStatusBadgeVariant(status) {
  if (status === 'onsale') return 'default'
  if (status === 'soldout') return 'secondary'
  if (status === 'upcoming') return 'outline'
  return 'secondary'
}

const retryFetchRights = () => {
  listError.value = ''
  fetchRights()
}

const fetchRights = async () => {
  listLoading.value = true
  listError.value = ''
  try {
    const response = await axios.get('/rights')
    let arr = []
    if (Array.isArray(response)) {
      arr = response
    } else if (response && Array.isArray(response.data)) {
      arr = response.data
    } else if (response != null) {
      rights.value = []
      listError.value = '接口返回格式异常，无法展示列表'
      return
    }
    rights.value = arr.map((right) => ({
      ...right,
      images: right.images ? right.images.map((image) => getImageUrl(image)) : []
    }))
  } catch (error) {
    console.error('获取版权实物列表失败：', error)
    rights.value = []
    listError.value = '获取版权实物列表失败，请检查网络或稍后重试'
  } finally {
    listLoading.value = false
  }
}

const fetchDigitalOptions = async () => {
  try {
    const arr = await axios.get('/digital-artworks/admin', { params: { page: 1, pageSize: 200 } })
    digitalOptions.value = Array.isArray(arr) ? arr : []
  } catch {
    digitalOptions.value = []
  }
}

const fetchCategories = async () => {
  try {
    const response = await axios.get('/physical-categories')
    if (response && response.data && Array.isArray(response.data)) {
      categories.value = response.data
    } else if (Array.isArray(response)) {
      categories.value = response
    } else {
      categories.value = []
    }
  } catch (error) {
    console.error('获取分类列表失败：', error)
    categories.value = []
  }
}

const fetchArtists = async () => {
  try {
    const response = await axios.get('/artists')
    if (Array.isArray(response)) {
      artists.value = response
    } else {
      artists.value = []
      ElMessage.error('获取艺术家数据格式不正确')
    }
  } catch (error) {
    console.error('获取艺术家列表失败：', error)
    artists.value = []
    ElMessage.error('获取艺术家列表失败')
  }
}

const getStatusText = (status) => {
  const texts = {
    onsale: '在售',
    soldout: '已售罄',
    upcoming: '即将发售'
  }
  return texts[status] || status
}

const handleAdd = () => {
  isEdit.value = false
  form.value = {
    title: '',
    status: '',
    price: 0,
    discount_price: 0,
    originalPrice: 0,
    discountAmount: 0,
    period: '',
    totalCount: 0,
    remainingCount: 0,
    description: '',
    images: [],
    category_id: null,
    artist_id: null,
    rich_text: '',
    eligible_digital_artwork_ids: []
  }
  digitalFilter.value = ''
  resetImageUploadState()
  dialogVisible.value = true
  richTextHtml.value = ''
  nextTick(() => {
    if (editorRef.value?.setHtml) editorRef.value.setHtml('')
  })
  fetchDigitalOptions()
}

const handleEdit = (row) => {
  isEdit.value = true
  form.value = {
    id: row.id,
    title: row.title,
    status: row.status,
    price: parseFloat(row.price),
    discount_price: row.discount_price ? parseFloat(row.discount_price) : 0,
    originalPrice: parseFloat(row.original_price),
    discountAmount: parseFloat(row.discount_amount || 0),
    period: row.period,
    totalCount: parseInt(row.total_count, 10),
    remainingCount: parseInt(row.remaining_count, 10),
    description: row.description,
    images: row.images || [],
    category_id: row.category_id,
    artist_id: row.artist_id,
    rich_text: row.rich_text || '',
    eligible_digital_artwork_ids: []
  }
  digitalFilter.value = ''
  resetImageUploadState()
  dialogVisible.value = true
  richTextHtml.value = row.rich_text || ''
  fetchDigitalOptions()
  axios.get(`/rights/${row.id}`).then((data) => {
    form.value.eligible_digital_artwork_ids = Array.isArray(data.eligible_digital_artwork_ids)
      ? data.eligible_digital_artwork_ids
      : []
  }).catch(() => {})
}

const handleDelete = (row) => {
  ElMessageBox.confirm('确定要删除这个版权实物吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await axios.delete(`/rights/${row.id}`)
      ElMessage.success('删除成功')
      fetchRights()
    } catch (error) {
      ElMessage.error('删除失败')
    }
  })
}

const triggerImageInput = () => {
  if (!isImageUploading.value && !isImageProcessing.value) {
    imageInput.value?.click()
  }
}

const handleImageFileSelect = (event) => {
  const files = Array.from(event.target.files || [])
  if (files.length > 0) {
    uploadImageFiles(files)
  }
  event.target.value = ''
}

const uploadImageFiles = async (files) => {
  for (const file of files) {
    if (form.value.images.length >= 5) {
      ElMessage.warning('最多只能上传5张图片')
      break
    }

    imageUploadProgress.value = 0
    isImageUploading.value = true
    isImageProcessing.value = true
    imageFileName.value = file.name
    imageFileSize.value = file.size

    try {
      const processedFile = await uploadImageToWebpLimit5MB(file)

      if (!processedFile) {
        resetImageUploadState()
        continue
      }

      isImageProcessing.value = false
      imageFileName.value = processedFile.name
      imageFileSize.value = processedFile.size

      const formData = new FormData()
      formData.append('file', processedFile)

      const response = await axios.post('/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
            imageUploadProgress.value = percent
          } else {
            imageUploadProgress.value = Math.min(imageUploadProgress.value + 10, 90)
          }
        }
      })

      handleImageUploadSuccess(response)
    } catch (error) {
      handleImageUploadError(error)
    }
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
    if (!form.value.images) form.value.images = []
    if (!form.value.images.includes(imageUrl)) {
      form.value.images.push(imageUrl)
    }
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

const removeImage = async (index) => {
  try {
    await ElMessageBox.confirm(
      '确定要删除这张图片吗？',
      '确认删除',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
    form.value.images.splice(index, 1)
    ElMessage.success('图片已删除')
  } catch {
    // 用户取消删除
  }
}

const handleImageDragEnter = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!isImageUploading.value && !isImageProcessing.value && form.value.images.length < 5) {
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

  if (isImageUploading.value || isImageProcessing.value || form.value.images.length >= 5) return

  const files = Array.from(e.dataTransfer.files || [])
  if (files.length > 0) {
    uploadImageFiles(files)
  }
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
  if (isOssPublicUrl(url)) {
    return url
  }
  return url.startsWith('http') ? url : `${API_BASE_URL}${url.startsWith('/') ? url : `/${url}`}`
}

const handleEditorCreated = (editor) => {
  editorRef.value = editor
}

const handleSubmit = async () => {
  if (!form.value.title.trim()) {
    ElMessage.warning('请输入标题')
    return
  }
  if (!form.value.status) {
    ElMessage.warning('请选择状态')
    return
  }
  if (form.value.images.length === 0) {
    ElMessage.warning('请上传至少一张图片')
    return
  }

  try {
    const submitData = {
      ...form.value,
      images: form.value.images.map((image) => {
        if (typeof image === 'string') {
          if (isOssPublicUrl(image)) {
            return image
          }
          if (image.startsWith('http')) {
            const url = new URL(image)
            return url.pathname
          }
          return image
        } else if (image.url) {
          if (isOssPublicUrl(image.url)) {
            return image.url
          }
          if (image.url.startsWith('http')) {
            const url = new URL(image.url)
            return url.pathname
          }
          return image.url
        }
        return image
      }),
      category_id: form.value.category_id,
      discount_amount: form.value.discountAmount,
      rich_text: richTextHtml.value,
      eligible_digital_artwork_ids: Array.isArray(form.value.eligible_digital_artwork_ids)
        ? form.value.eligible_digital_artwork_ids
        : [],
      discount_price: form.value.discount_price
    }

    if (isEdit.value) {
      await axios.put(`/rights/${form.value.id}`, submitData)
    } else {
      await axios.post('/rights', submitData)
    }
    ElMessage.success('保存成功')
    dialogVisible.value = false
    fetchRights()
  } catch (error) {
    console.error('保存失败:', error)
    ElMessage.error('保存失败')
  }
}

onMounted(() => {
  fetchRights()
  fetchCategories()
  fetchArtists()
})

onBeforeUnmount(() => {
  if (editorRef.value && editorRef.value.destroy) editorRef.value.destroy()
})
</script>
