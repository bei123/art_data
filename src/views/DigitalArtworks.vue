<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h2 class="text-xl font-semibold tracking-tight text-foreground">
        数字艺术品管理
      </h2>
      <Button type="button" @click="handleAdd">
        添加作品
      </Button>
    </div>

    <Alert v-if="listError && !listLoading" variant="destructive">
      <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
      <AlertTitle>{{ listError }}</AlertTitle>
      <AlertDescription class="mt-2">
        <Button type="button" variant="secondary" size="sm" @click="retryFetchArtworks">
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
        <table class="w-full min-w-[1400px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="h-10 max-w-[10rem] px-3 text-left font-medium">标题</th>
              <th class="h-10 w-28 px-3 text-left font-medium">图片</th>
              <th class="h-10 max-w-[10rem] px-3 text-left font-medium">描述</th>
              <th class="h-10 px-3 text-left font-medium">项目</th>
              <th class="h-10 px-3 text-left font-medium">产品</th>
              <th class="h-10 px-3 text-left font-medium">项目方</th>
              <th class="h-10 px-3 text-left font-medium">发行方</th>
              <th class="h-10 px-3 text-left font-medium">批次</th>
              <th class="h-10 w-16 px-3 text-left font-medium">年份</th>
              <th class="h-10 w-20 px-3 text-left font-medium">数量</th>
              <th class="h-10 w-20 px-3 text-left font-medium">价格</th>
              <th class="h-10 min-w-[8rem] px-3 text-left font-medium">创建时间</th>
              <th class="h-10 min-w-[10rem] px-3 text-left font-medium">艺术家</th>
              <th class="h-10 w-20 px-3 text-left font-medium">状态</th>
              <th
                class="h-10 w-28 px-3 text-left font-medium"
                title="关闭后公开接口不再返回 purchase_url"
              >
                购买链接
              </th>
              <th class="h-10 min-w-[18rem] px-3 text-left font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in artworks"
              :key="row.id"
              class="border-b border-border transition-colors hover:bg-muted/30"
            >
              <td class="max-w-[10rem] truncate px-3 py-2.5 font-medium" :title="row.title">
                {{ row.title }}
              </td>
              <td class="px-3 py-2">
                <div class="size-20 overflow-hidden rounded-md border border-border bg-muted/30">
                  <img
                    :src="getImageUrl(row.image_url)"
                    :alt="row.title ? `数字艺术品：${row.title}` : '数字艺术品'"
                    class="size-full object-cover"
                    loading="lazy"
                    @error="(e) => { e.target.style.opacity = '0.35' }"
                  >
                </div>
              </td>
              <td class="max-w-[10rem] truncate px-3 py-2.5 text-muted-foreground" :title="row.description">
                {{ row.description }}
              </td>
              <td class="max-w-[8rem] truncate px-3 py-2.5" :title="row.project_name">{{ row.project_name }}</td>
              <td class="max-w-[8rem] truncate px-3 py-2.5" :title="row.product_name">{{ row.product_name }}</td>
              <td class="max-w-[8rem] truncate px-3 py-2.5 text-muted-foreground" :title="row.project_owner">
                {{ row.project_owner }}
              </td>
              <td class="max-w-[8rem] truncate px-3 py-2.5 text-muted-foreground" :title="row.issuer">
                {{ row.issuer }}
              </td>
              <td class="px-3 py-2.5 tabular-nums text-muted-foreground">{{ row.issue_batch }}</td>
              <td class="px-3 py-2.5 tabular-nums">{{ row.issue_year }}</td>
              <td class="px-3 py-2.5 tabular-nums">{{ row.batch_quantity }}</td>
              <td class="px-3 py-2.5 tabular-nums font-medium">¥{{ row.price }}</td>
              <td class="px-3 py-2.5 text-xs text-muted-foreground tabular-nums">{{ row.created_at }}</td>
              <td class="px-3 py-2.5">
                <div class="flex min-w-0 items-center gap-2">
                  <Avatar class="size-9 shrink-0 border border-border">
                    <AvatarImage
                      :src="getImageUrl(row.artist?.avatar)"
                      :alt="(row.artist?.name || row.artist_name) ? `${row.artist?.name || row.artist_name} 头像` : ''"
                    />
                    <AvatarFallback class="text-xs">
                      {{ (row.artist?.name || row.artist_name || '?').charAt(0) }}
                    </AvatarFallback>
                  </Avatar>
                  <span class="min-w-0 truncate text-sm">{{ row.artist?.name || row.artist_name || '—' }}</span>
                </div>
              </td>
              <td class="px-3 py-2.5">
                <Badge :variant="row.is_hidden ? 'destructive' : 'default'">
                  {{ row.is_hidden ? '隐藏' : '显示' }}
                </Badge>
              </td>
              <td class="px-3 py-2.5">
                <label class="inline-flex cursor-pointer items-center gap-2" :title="purchaseLinkHint">
                  <input
                    type="checkbox"
                    class="size-4 rounded border border-input accent-primary"
                    :checked="row.show_purchase_link !== false && row.show_purchase_link !== 0"
                    @change="(e) => handlePurchaseLinkToggle(row, e.target.checked)"
                  >
                  <span class="sr-only">展示购买链接</span>
                </label>
              </td>
              <td class="px-3 py-2.5">
                <div class="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="link" class="h-auto px-0" type="button" @click="openAssociateArtist(row)">
                    关联艺术家
                  </Button>
                  <Button
                    size="sm"
                    :variant="row.is_hidden ? 'default' : 'secondary'"
                    type="button"
                    @click="handleToggleVisibility(row)"
                  >
                    {{ row.is_hidden ? '显示' : '隐藏' }}
                  </Button>
                  <Button size="sm" variant="outline" type="button" @click="handleEdit(row)">
                    编辑
                  </Button>
                  <Button size="sm" variant="destructive" type="button" @click="handleDelete(row)">
                    删除
                  </Button>
                </div>
              </td>
            </tr>
            <tr v-if="artworks.length === 0 && !listLoading">
              <td colspan="16" class="px-3 py-12 text-center text-muted-foreground">
                暂无数字艺术品数据
              </td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>

    <Dialog v-model:open="dialogVisible">
      <DialogContent class="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{{ isEdit ? '编辑作品' : '添加作品' }}</DialogTitle>
        </DialogHeader>

        <div class="grid max-h-[70vh] gap-4 overflow-y-auto py-2 pr-1">
          <div class="flex flex-col gap-2">
            <Label for="da-title">标题</Label>
            <Input id="da-title" v-model="form.title" />
          </div>

          <div class="flex flex-col gap-2">
            <Label>图片 <span class="text-destructive">*</span></Label>
            <div class="max-w-[400px] space-y-3">
              <div
                v-if="form.image_url"
                class="group relative size-[200px] overflow-hidden rounded-lg border border-border shadow-sm"
              >
                <img :src="getImageUrl(form.image_url)" alt="作品图" class="size-full object-cover">
                <div
                  class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Button type="button" size="icon" variant="destructive" @click="removeImage">
                    <Trash2 class="size-4" />
                  </Button>
                  <Button type="button" size="sm" variant="secondary" @click="triggerImageInput">
                    更换图片
                  </Button>
                </div>
              </div>
              <div
                v-else
                class="relative flex size-[200px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 transition hover:border-primary/40"
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
              <Alert v-if="imageUploadProgress === 100" class="border-primary/30">
                <AlertCircle class="size-4 shrink-0 text-primary" aria-hidden="true" />
                <AlertTitle>图片上传成功</AlertTitle>
              </Alert>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <Label for="da-desc">描述</Label>
            <Textarea id="da-desc" v-model="form.description" class="min-h-24" rows="4" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="da-cert">登记证书</Label>
            <Input id="da-cert" v-model="form.registration_certificate" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="da-license">许可权利</Label>
            <Textarea id="da-license" v-model="form.license_rights" class="min-h-24" rows="4" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="da-period">许可时间</Label>
            <Input id="da-period" v-model="form.license_period" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="da-owner">所有者权益</Label>
            <Textarea id="da-owner" v-model="form.owner_rights" class="min-h-24" rows="4" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="da-items">许可事项</Label>
            <Textarea id="da-items" v-model="form.license_items" class="min-h-24" rows="4" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="da-pn">项目名称</Label>
            <Input id="da-pn" v-model="form.project_name" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="da-product">产品名称</Label>
            <Input id="da-product" v-model="form.product_name" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="da-owner2">项目方</Label>
            <Input id="da-owner2" v-model="form.project_owner" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="da-issuer">发行方</Label>
            <Input id="da-issuer" v-model="form.issuer" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="da-batch">发行批次</Label>
            <Input id="da-batch" v-model="form.issue_batch" />
          </div>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div class="flex flex-col gap-2">
              <Label for="da-year">发行年份</Label>
              <Input
                id="da-year"
                v-model.number="form.issue_year"
                type="number"
                min="1900"
                max="2100"
              />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="da-qty">本批发行数量</Label>
              <Input id="da-qty" v-model.number="form.batch_quantity" type="number" min="1" step="1" />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="da-price">价格</Label>
              <Input id="da-price" v-model.number="form.price" type="number" min="0" step="0.01" />
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <Label for="da-artist-filter">艺术家 <span class="text-destructive">*</span></Label>
            <Input
              id="da-artist-filter"
              v-model="artistFilter"
              placeholder="输入关键字筛选"
              class="max-w-md"
            />
            <select
              id="da-artist"
              class="flex h-10 w-full max-w-md rounded-lg border border-input bg-transparent px-3 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              :value="form.artist_id === '' || form.artist_id == null ? '' : String(form.artist_id)"
              @change="onFormArtistChange"
            >
              <option disabled value="">
                请选择艺术家
              </option>
              <option v-for="a in filteredArtistOptions" :key="a.id" :value="String(a.id)">
                {{ a.name }}
              </option>
            </select>
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

    <Dialog v-model:open="associateArtistVisible">
      <DialogContent class="max-w-[calc(100%-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>关联艺术家</DialogTitle>
        </DialogHeader>
        <p class="text-sm text-muted-foreground">
          从列表同步的数字艺术品可在此手动绑定本站艺术家；清空选择可取消关联。
        </p>
        <div class="flex flex-col gap-2">
          <Label for="assoc-filter">筛选</Label>
          <Input id="assoc-filter" v-model="associateArtistSearch" placeholder="输入关键字筛选艺术家" />
        </div>
        <select
          id="assoc-artist"
          class="flex h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          :value="associateArtistId == null ? '' : String(associateArtistId)"
          @change="onAssociateArtistChange"
        >
          <option value="">（不关联 / 清空）</option>
          <option v-for="a in filteredAssociateArtistOptions" :key="a.id" :value="String(a.id)">
            {{ a.name }}
          </option>
        </select>
        <DialogFooter class="gap-2 sm:justify-end">
          <Button type="button" variant="outline" @click="associateArtistVisible = false">
            取消
          </Button>
          <Button type="button" @click="saveAssociateArtist">
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { AlertCircle, Loader2, Trash2, Upload } from 'lucide-vue-next'
import axios from '../utils/axios'
import { API_BASE_URL, isOssPublicUrl } from '../config'
import { uploadImageToWebpLimit5MB } from '../utils/image'
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

const purchaseLinkHint = '关闭后公开接口不再返回 purchase_url'

const artworks = ref([])
const listLoading = ref(false)
const listError = ref('')
const dialogVisible = ref(false)
const isEdit = ref(false)
const artistOptions = ref([])
const artistFilter = ref('')

const filteredArtistOptions = computed(() => {
  const q = artistFilter.value.trim().toLowerCase()
  if (!q) return artistOptions.value
  return artistOptions.value.filter((a) =>
    String(a.name ?? '')
      .toLowerCase()
      .includes(q)
  )
})

const associateArtistVisible = ref(false)
const associateRow = ref(null)
const associateArtistId = ref(null)
const associateArtistSearch = ref('')

const filteredAssociateArtistOptions = computed(() => {
  const q = associateArtistSearch.value.trim().toLowerCase()
  if (!q) return artistOptions.value
  return artistOptions.value.filter((a) =>
    String(a.name ?? '')
      .toLowerCase()
      .includes(q)
  )
})

const imageInput = ref(null)
const isImageDragOver = ref(false)
const imageUploadProgress = ref(0)
const isImageUploading = ref(false)
const isImageProcessing = ref(false)
const imageFileName = ref('')
const imageFileSize = ref(0)

const form = ref({
  title: '',
  image_url: '',
  artist_id: '',
  description: '',
  registration_certificate: '',
  license_rights: '',
  license_period: '',
  owner_rights: '',
  license_items: '',
  project_name: '',
  product_name: '',
  project_owner: '',
  issuer: '',
  issue_batch: '',
  issue_year: new Date().getFullYear(),
  batch_quantity: 1,
  price: 0
})

function onFormArtistChange(e) {
  const v = e.target.value
  form.value.artist_id = v === '' ? '' : Number(v)
}

function onAssociateArtistChange(e) {
  const v = e.target.value
  associateArtistId.value = v === '' ? null : Number(v)
}

const retryFetchArtworks = () => {
  listError.value = ''
  fetchArtworks()
}

const fetchArtworks = async () => {
  listLoading.value = true
  listError.value = ''
  try {
    const data = await axios.get('/digital-artworks/admin')
    if (Array.isArray(data)) {
      artworks.value = data.map((artwork) => ({
        ...artwork,
        image_url: getImageUrl(artwork.image_url),
        is_hidden: artwork.is_hidden || false,
        show_purchase_link:
          artwork.show_purchase_link === 0 || artwork.show_purchase_link === false ? false : true
      }))
    } else {
      artworks.value = []
      listError.value = '接口返回格式异常，无法展示列表'
    }
  } catch (error) {
    console.error('获取数字艺术品列表失败：', error)
    artworks.value = []
    listError.value = '获取数字艺术品列表失败，请检查网络或稍后重试'
  } finally {
    listLoading.value = false
  }
}

const fetchArtists = async () => {
  try {
    const data = await axios.get('/artists')
    if (Array.isArray(data)) {
      artistOptions.value = data
    } else {
      artistOptions.value = []
      ElMessage.error('获取艺术家数据格式不正确')
    }
  } catch (error) {
    console.error('获取艺术家列表失败：', error)
    artistOptions.value = []
    ElMessage.error('获取艺术家列表失败')
  }
}

const handleAdd = () => {
  isEdit.value = false
  form.value = {
    title: '',
    image_url: '',
    artist_id: '',
    description: '',
    registration_certificate: '',
    license_rights: '',
    license_period: '',
    owner_rights: '',
    license_items: '',
    project_name: '',
    product_name: '',
    project_owner: '',
    issuer: '',
    issue_batch: '',
    issue_year: new Date().getFullYear(),
    batch_quantity: 1,
    price: 0
  }
  artistFilter.value = ''
  resetImageUploadState()
  dialogVisible.value = true
}

const handleEdit = async (row) => {
  isEdit.value = true
  try {
    let detail = await axios.get(`/digital-artworks/${row.id}`)
    if (detail && detail.data) {
      detail = detail.data
    }

    form.value = {
      id: detail.id,
      title: detail.title || '',
      image_url: detail.image_url || '',
      artist_id: detail.artist?.id || '',
      description: detail.description || '',
      registration_certificate: detail.registration_certificate || '',
      license_rights: detail.license_rights || '',
      license_period: detail.license_period || '',
      owner_rights: detail.owner_rights || '',
      license_items: detail.license_items || '',
      project_name: detail.project_name || '',
      product_name: detail.product_name || '',
      project_owner: detail.project_owner || '',
      issuer: detail.issuer || '',
      issue_batch: detail.issue_batch || '',
      issue_year: Number(detail.issue_year) || new Date().getFullYear(),
      batch_quantity: Number(detail.batch_quantity) || 1,
      price: Number(detail.price) || 0
    }

    artistFilter.value = ''
    resetImageUploadState()
    dialogVisible.value = true
  } catch (error) {
    console.error('获取详细信息失败:', error)
    ElMessage.error('获取详细信息失败，无法编辑')
  }
}

const openAssociateArtist = (row) => {
  associateRow.value = row
  const aid = row.artist?.id ?? row.artist_id
  associateArtistId.value = aid !== undefined && aid !== null && aid !== '' ? Number(aid) : null
  associateArtistSearch.value = ''
  associateArtistVisible.value = true
}

const saveAssociateArtist = async () => {
  if (!associateRow.value) return
  try {
    let payloadArtistId = null
    if (associateArtistId.value !== null && associateArtistId.value !== undefined && associateArtistId.value !== '') {
      const n = Number(associateArtistId.value)
      if (!Number.isFinite(n) || n <= 0) {
        ElMessage.error('请选择有效艺术家或清空以取消关联')
        return
      }
      payloadArtistId = n
    }
    await axios.patch(`/digital-artworks/${associateRow.value.id}/artist`, {
      artist_id: payloadArtistId
    })
    ElMessage.success('艺术家关联已保存')
    associateArtistVisible.value = false
    fetchArtworks()
  } catch (error) {
    console.error('关联艺术家失败:', error)
    const msg = error.response?.data?.error || '保存失败'
    ElMessage.error(msg)
  }
}

const handlePurchaseLinkToggle = async (row, val) => {
  try {
    await axios.patch(`/digital-artworks/${row.id}/purchase-link`, {
      show_purchase_link: val
    })
    row.show_purchase_link = val ? 1 : 0
    ElMessage.success(val ? '已开启购买链接' : '已关闭购买链接')
  } catch (error) {
    console.error('更新购买链接开关失败:', error)
    ElMessage.error(error.response?.data?.error || '更新失败')
    fetchArtworks()
  }
}

const handleToggleVisibility = (row) => {
  const action = row.is_hidden ? '显示' : '隐藏'
  ElMessageBox.confirm(`确定要${action}这个作品吗？`, '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await axios.patch(`/digital-artworks/${row.id}/hide`, {
        is_hidden: !row.is_hidden
      })
      ElMessage.success(`${action}成功`)
      fetchArtworks()
    } catch (error) {
      console.error(`${action}失败:`, error)
      if (error.response) {
        ElMessage.error(error.response.data.error || `${action}失败`)
      } else {
        ElMessage.error(`${action}失败`)
      }
    }
  })
}

const handleDelete = (row) => {
  ElMessageBox.confirm('确定要删除这个作品吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await axios.delete(`/digital-artworks/${row.id}`)
      ElMessage.success('删除成功')
      fetchArtworks()
    } catch (error) {
      console.error('删除失败:', error)
      if (error.response) {
        ElMessage.error(error.response.data.error || '删除失败')
      } else {
        ElMessage.error('删除失败')
      }
    }
  })
}

const triggerImageInput = () => {
  if (!isImageUploading.value && !isImageProcessing.value) {
    imageInput.value?.click()
  }
}

const handleImageFileSelect = (event) => {
  const file = event.target.files[0]
  if (file) {
    uploadImageFile(file)
  }
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

const removeImage = async () => {
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
    form.value.image_url = ''
    ElMessage.success('图片已删除')
  } catch {
    // 用户取消删除
  }
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
  if (files.length > 0) {
    uploadImageFile(files[0])
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
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`
}

const getSubmitData = () => {
  const {
    artist_id, title, image_url, description, registration_certificate,
    license_rights, license_period, owner_rights, license_items,
    project_name, product_name, project_owner, issuer, issue_batch,
    issue_year, batch_quantity, price
  } = form.value
  return {
    artist_id:
      artist_id === '' || artist_id == null ? artist_id : Number(artist_id),
    title, title, image_url, description, registration_certificate,
    license_rights, license_period, owner_rights, license_items,
    project_name, product_name, project_owner, issuer, issue_batch,
    issue_year, batch_quantity, price
  }
}

const handleSubmit = async () => {
  if (!form.value.title || !form.value.title.trim()) {
    ElMessage.warning('请输入作品标题')
    return
  }
  if (!form.value.image_url) {
    ElMessage.warning('请上传作品图片')
    return
  }
  if (!form.value.artist_id) {
    ElMessage.warning('请选择艺术家')
    return
  }
  if (!form.value.description || !form.value.description.trim()) {
    ElMessage.warning('请输入作品描述')
    return
  }
  if (!form.value.project_name || !form.value.project_name.trim()) {
    ElMessage.warning('请输入项目名称')
    return
  }
  if (!form.value.product_name || !form.value.product_name.trim()) {
    ElMessage.warning('请输入产品名称')
    return
  }
  if (!form.value.project_owner || !form.value.project_owner.trim()) {
    ElMessage.warning('请输入项目方')
    return
  }
  if (!form.value.issuer || !form.value.issuer.trim()) {
    ElMessage.warning('请输入发行方')
    return
  }
  if (!form.value.issue_batch || !form.value.issue_batch.trim()) {
    ElMessage.warning('请输入发行批次')
    return
  }
  if (!form.value.issue_year) {
    ElMessage.warning('请输入发行年份')
    return
  }
  if (!form.value.batch_quantity) {
    ElMessage.warning('请输入本批发行数量')
    return
  }
  if (form.value.price === undefined || form.value.price < 0) {
    ElMessage.warning('请输入有效的价格')
    return
  }

  try {
    if (isEdit.value) {
      await axios.put(`/digital-artworks/${form.value.id}`, getSubmitData())
    } else {
      await axios.post('/digital-artworks', getSubmitData())
    }
    ElMessage.success(isEdit.value ? '更新成功' : '添加成功')
    dialogVisible.value = false
    fetchArtworks()
  } catch (error) {
    ElMessage.error(isEdit.value ? '更新失败' : '添加失败')
  }
}

onMounted(() => {
  fetchArtists()
  fetchArtworks()
})
</script>
