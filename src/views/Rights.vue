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
                  <Button size="sm" variant="destructive" type="button" @click="openDeleteRightDialog(row)">
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
      <DialogContent class="flex max-h-[92vh] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader class="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle>{{ isEdit ? '编辑版权实物' : '添加版权实物' }}</DialogTitle>
          <DialogDescription>
            <template v-if="isEdit">
              正在编辑「{{ form.title || '未命名' }}」<span v-if="form.id" class="text-muted-foreground">（ID {{ form.id }}）</span>
            </template>
            <template v-else>
              上传配图并填写权益信息；带 <span class="text-destructive">*</span> 为必填
            </template>
          </DialogDescription>
        </DialogHeader>

        <div class="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(260px,320px)_1fr]">
          <!-- 左侧：配图 -->
          <div class="flex min-h-0 flex-col gap-3 border-border bg-muted/15 p-4 lg:border-r">
            <div class="flex items-center justify-between gap-2">
              <Label class="text-sm font-medium">
                配图 <span class="text-destructive">*</span>
              </Label>
              <Badge variant="secondary" class="tabular-nums">
                {{ form.images.length }} / 5
              </Badge>
            </div>
            <p class="text-xs text-muted-foreground">
              至少 1 张，最多 5 张，支持多选或拖拽
            </p>

            <ScrollArea class="min-h-0 flex-1 lg:max-h-[min(56vh,560px)]">
              <div class="flex flex-wrap gap-2.5 pr-3">
                <div
                  v-for="(image, index) in form.images"
                  :key="`${image}-${index}`"
                  class="group relative size-[100px] overflow-hidden rounded-lg border border-border bg-background shadow-sm"
                >
                  <img
                    :src="getImageUrl(image)"
                    :alt="`配图 ${index + 1}`"
                    class="size-full object-cover"
                    loading="lazy"
                  >
                  <Button
                    type="button"
                    size="icon"
                    variant="destructive"
                    class="absolute right-1 top-1 size-7 opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                    :aria-label="`移除第 ${index + 1} 张`"
                    @click="removeRightsImage(index)"
                  >
                    <X class="size-3.5" aria-hidden="true" />
                  </Button>
                  <span class="absolute bottom-1 left-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
                    {{ index + 1 }}
                  </span>
                </div>

                <div
                  v-if="form.images.length < 5"
                  class="relative flex size-[100px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-background transition hover:border-primary/40"
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
                    class="mb-1 size-7 animate-spin text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Plus v-else class="mb-1 size-7 text-muted-foreground" aria-hidden="true" />
                  <span class="text-[11px] font-medium">添加</span>
                  <div
                    v-if="isImageDragOver"
                    class="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-primary/10 text-[10px] font-medium text-primary"
                  >
                    释放上传
                  </div>
                </div>
              </div>
            </ScrollArea>

            <input
              ref="imageInput"
              type="file"
              accept="image/*"
              multiple
              class="hidden"
              @change="handleImageFileSelect"
            >

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

          <!-- 右侧：Tab -->
          <div class="flex min-h-0 flex-col">
            <Tabs v-model="rightFormTab" class="flex min-h-0 flex-1 flex-col">
              <div class="shrink-0 border-b border-border px-4 pt-3">
                <TabsList class="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4">
                  <TabsTrigger value="basic" class="text-xs sm:text-sm">
                    基本信息
                  </TabsTrigger>
                  <TabsTrigger value="pricing" class="text-xs sm:text-sm">
                    价格库存
                  </TabsTrigger>
                  <TabsTrigger value="discount" class="text-xs sm:text-sm">
                    优惠条件
                  </TabsTrigger>
                  <TabsTrigger value="content" class="text-xs sm:text-sm">
                    详情内容
                  </TabsTrigger>
                </TabsList>
              </div>

              <ScrollArea class="min-h-[320px] flex-1 lg:max-h-[min(56vh,560px)]">
                <TabsContent value="basic" class="mt-0 space-y-4 p-4">
                  <div class="flex flex-col gap-2">
                    <Label for="r-title">标题 <span class="text-destructive">*</span></Label>
                    <Input id="r-title" v-model="form.title" autocomplete="off" placeholder="版权实物标题" />
                  </div>
                  <div class="flex flex-col gap-2">
                    <Label for="r-status">状态 <span class="text-destructive">*</span></Label>
                    <Select :model-value="statusSelectValue" @update:model-value="onStatusSelectChange">
                      <SelectTrigger id="r-status" class="max-w-md">
                        <SelectValue placeholder="请选择状态" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem :value="SELECT_NONE" disabled>
                          请选择状态
                        </SelectItem>
                        <SelectItem value="onsale">在售</SelectItem>
                        <SelectItem value="soldout">已售罄</SelectItem>
                        <SelectItem value="upcoming">即将发售</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div class="flex flex-col gap-2">
                    <Label for="r-cat">所属分类</Label>
                    <Select :model-value="categorySelectValue" @update:model-value="onCategorySelectChange">
                      <SelectTrigger id="r-cat" class="max-w-md">
                        <SelectValue placeholder="请选择分类" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem :value="SELECT_NONE" disabled>
                          请选择分类
                        </SelectItem>
                        <SelectItem
                          v-for="cat in categories"
                          :key="cat.id"
                          :value="String(cat.id)"
                        >
                          {{ cat.title }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div class="flex flex-col gap-2">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <Label for="r-artist-filter">关联艺术家</Label>
                      <Button
                        v-if="form.artist_id"
                        type="button"
                        variant="ghost"
                        size="sm"
                        class="h-7 px-2 text-xs text-muted-foreground"
                        @click="clearArtistAssociation"
                      >
                        取消关联
                      </Button>
                    </div>
                    <p v-if="form.artist_id && selectedArtistName" class="text-xs text-muted-foreground">
                      已选：<span class="font-medium text-foreground">{{ selectedArtistName }}</span>
                    </p>
                    <Input
                      id="r-artist-filter"
                      v-model="artistFilter"
                      placeholder="输入姓名搜索艺术家"
                      autocomplete="off"
                    />
                    <ScrollArea class="h-36 rounded-lg border border-border">
                      <div class="p-1">
                        <button
                          v-for="artist in filteredArtists"
                          :key="artist.id"
                          type="button"
                          class="flex w-full items-center rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                          :class="form.artist_id === artist.id ? 'bg-primary/10 font-medium text-primary' : ''"
                          @click="selectArtist(artist.id)"
                        >
                          {{ artist.name }}
                        </button>
                        <p
                          v-if="!filteredArtists.length"
                          class="px-3 py-6 text-center text-xs text-muted-foreground"
                        >
                          未找到艺术家
                        </p>
                      </div>
                    </ScrollArea>
                  </div>
                  <div class="flex flex-col gap-2">
                    <Label for="r-period">期限</Label>
                    <Input id="r-period" v-model="form.period" placeholder="如：永久 / 1年" />
                  </div>
                  <div class="flex flex-col gap-2">
                    <Label for="r-desc">简介</Label>
                    <Textarea id="r-desc" v-model="form.description" class="min-h-[120px]" rows="4" placeholder="简短描述" />
                  </div>
                </TabsContent>

                <TabsContent value="pricing" class="mt-0 space-y-4 p-4">
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
                </TabsContent>

                <TabsContent value="discount" class="mt-0 space-y-4 p-4">
                  <div class="flex flex-col gap-2">
                    <Label>可享优惠的数字资产</Label>
                    <Input v-model="digitalFilter" placeholder="筛选标题…" class="max-w-md" />
                    <p class="text-xs text-muted-foreground">
                      不选择则不限制；设置后仅拥有所选数字资产的用户可享受优惠价。
                    </p>
                  </div>
                  <ScrollArea class="h-[min(320px,40vh)] rounded-lg border border-border">
                    <ul class="space-y-2 p-3">
                      <li
                        v-for="item in filteredDigitalOptions"
                        :key="item.id"
                        class="flex items-start gap-2 rounded-md px-1 py-0.5 hover:bg-muted/50"
                      >
                        <Checkbox
                          :id="`digital-eligible-${item.id}`"
                          :model-value="eligibleIdSet.has(Number(item.id))"
                          class="mt-0.5"
                          @update:model-value="(checked) => toggleEligibleDigital(Number(item.id), checked === true)"
                        />
                        <label
                          :for="`digital-eligible-${item.id}`"
                          class="min-w-0 flex-1 cursor-pointer text-sm leading-snug"
                        >
                          {{ item.title }}
                        </label>
                      </li>
                    </ul>
                    <p
                      v-if="filteredDigitalOptions.length === 0"
                      class="py-8 text-center text-sm text-muted-foreground"
                    >
                      无匹配项
                    </p>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="content" class="mt-0 p-4">
                  <div class="flex flex-col gap-2">
                    <Label>富文本详情</Label>
                    <div class="overflow-hidden rounded-lg border border-border">
                      <Toolbar :editor="editorRef" class="w-full border-b border-border" />
                      <Editor
                        v-model="richTextHtml"
                        :default-config="{ placeholder: '请输入富文本内容...', ...editorConfig }"
                        mode="default"
                        class="min-h-[min(320px,40vh)] w-full min-w-0"
                        style="min-height: min(320px, 40vh)"
                        @onCreated="handleEditorCreated"
                      />
                    </div>
                  </div>
                </TabsContent>
              </ScrollArea>
            </Tabs>
          </div>
        </div>

        <DialogFooter class="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-end">
          <Button type="button" variant="outline" :disabled="savingForm" @click="dialogVisible = false">
            取消
          </Button>
          <Button type="button" :disabled="savingForm" @click="handleSubmit">
            <Loader2 v-if="savingForm" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            {{ isEdit ? '保存' : '添加' }}
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

    <AlertDialog v-model:open="deleteRightDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除版权实物</AlertDialogTitle>
          <AlertDialogDescription>
            确定要删除这个版权实物吗？此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter class="gap-2 sm:justify-end">
          <AlertDialogCancel type="button">
            取消
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            :disabled="deletingRight"
            @click="confirmDeleteRight"
          >
            <Loader2 v-if="deletingRight" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            删除
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { AlertCircle, Loader2, Plus, X } from 'lucide-vue-next'
import axios from '../utils/axios'
import { API_BASE_URL, isOssPublicUrl } from '../config'
import { uploadImageToWebpLimit5MB } from '../utils/image'
import '@wangeditor/editor/dist/css/style.css'
import { Editor, Toolbar } from '@wangeditor/editor-for-vue'
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Textarea } from '@/components/ui/textarea'

const route = useRoute()
const router = useRouter()

const SELECT_NONE = '_none'
const rightFormTab = ref('basic')
const savingForm = ref(false)

const listLoading = ref(false)
const listError = ref('')
const rights = ref([])
const dialogVisible = ref(false)
const isEdit = ref(false)
const categories = ref([])
const artists = ref([])
const artistFilter = ref('')
const digitalOptions = ref([])
const digitalFilter = ref('')

const deleteRightDialogOpen = ref(false)
const deleteRightTarget = ref(null)
const deletingRight = ref(false)

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

const statusSelectValue = computed(() => {
  if (!form.value.status) return SELECT_NONE
  return form.value.status
})

const categorySelectValue = computed(() => {
  if (form.value.category_id == null) return SELECT_NONE
  return String(form.value.category_id)
})

const filteredArtists = computed(() => {
  const q = artistFilter.value.trim().toLowerCase()
  if (!q) return artists.value
  return artists.value.filter((a) =>
    String(a.name ?? '')
      .toLowerCase()
      .includes(q)
  )
})

const selectedArtistName = computed(() => {
  if (!form.value.artist_id) return ''
  const artist = artists.value.find((a) => a.id === form.value.artist_id)
  return artist?.name ?? ''
})

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

function onStatusSelectChange(v) {
  form.value.status = v === SELECT_NONE ? '' : v
}

function onCategorySelectChange(v) {
  form.value.category_id = v === SELECT_NONE ? null : Number(v)
}

function selectArtist(id) {
  form.value.artist_id = id
}

function clearArtistAssociation() {
  form.value.artist_id = null
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
  artistFilter.value = ''
  resetImageUploadState()
  rightFormTab.value = 'basic'
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
  artistFilter.value = ''
  resetImageUploadState()
  rightFormTab.value = 'basic'
  dialogVisible.value = true
  richTextHtml.value = row.rich_text || ''
  fetchDigitalOptions()
  axios.get(`/rights/${row.id}`).then((data) => {
    form.value.eligible_digital_artwork_ids = Array.isArray(data.eligible_digital_artwork_ids)
      ? data.eligible_digital_artwork_ids
      : []
  }).catch(() => {})
}

function openDeleteRightDialog(row) {
  deleteRightTarget.value = row
  deleteRightDialogOpen.value = true
}

async function confirmDeleteRight() {
  const row = deleteRightTarget.value
  if (!row?.id) return
  deletingRight.value = true
  try {
    await axios.delete(`/rights/${row.id}`)
    ElMessage.success('删除成功')
    deleteRightDialogOpen.value = false
    deleteRightTarget.value = null
    fetchRights()
  } catch {
    ElMessage.error('删除失败')
  } finally {
    deletingRight.value = false
  }
}

function removeRightsImage(index) {
  if (index < 0 || index >= form.value.images.length) return
  form.value.images.splice(index, 1)
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
    rightFormTab.value = 'basic'
    return
  }
  if (!form.value.status) {
    ElMessage.warning('请选择状态')
    rightFormTab.value = 'basic'
    return
  }
  if (form.value.images.length === 0) {
    ElMessage.warning('请上传至少一张图片')
    return
  }

  savingForm.value = true
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
  } finally {
    savingForm.value = false
  }
}

async function openEditFromRouteQuery() {
  const raw = route.query.edit
  if (!raw) return
  const id = Number(raw)
  if (!id) return

  const row = rights.value.find((r) => r.id === id)
  if (row) {
    handleEdit(row)
  } else {
    ElMessage.error('未找到该版权实物')
  }

  const nextQuery = { ...route.query }
  delete nextQuery.edit
  router.replace({ path: route.path, query: nextQuery })
}

onMounted(async () => {
  await fetchRights()
  fetchCategories()
  fetchArtists()
  await openEditFromRouteQuery()
})

onBeforeUnmount(() => {
  if (editorRef.value && editorRef.value.destroy) editorRef.value.destroy()
})
</script>
