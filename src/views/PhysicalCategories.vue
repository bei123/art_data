<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h2 class="text-xl font-semibold tracking-tight text-foreground">
        实物分类管理
      </h2>
      <Button type="button" @click="handleAdd">
        添加分类
      </Button>
    </div>

    <Alert v-if="listError && !listLoading" variant="destructive">
      <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
      <AlertTitle>{{ listError }}</AlertTitle>
      <AlertDescription class="mt-2">
        <Button type="button" variant="secondary" size="sm" @click="retryFetchCategories">
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
        <table class="w-full min-w-[640px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="h-10 px-3 text-left font-medium">标题</th>
              <th class="h-10 w-28 px-3 text-left font-medium">图片</th>
              <th class="h-10 w-28 px-3 text-left font-medium tabular-nums">作品数量</th>
              <th class="h-10 min-w-[12rem] px-3 text-left font-medium">描述</th>
              <th class="h-10 w-44 px-3 text-left font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in categories"
              :key="row.id"
              class="border-b border-border transition-colors hover:bg-muted/30"
            >
              <td class="px-3 py-2.5 font-medium">{{ row.title }}</td>
              <td class="px-3 py-2">
                <div class="size-20 overflow-hidden rounded-md border border-border bg-muted/30">
                  <img
                    :src="getListThumbnailUrl(getImageUrl(row.image))"
                    :alt="row.title ? `分类：${row.title}` : '分类配图'"
                    class="size-full object-cover"
                    loading="lazy"
                    @error="(e) => { e.target.style.opacity = '0.35' }"
                  >
                </div>
              </td>
              <td class="px-3 py-2.5 tabular-nums text-muted-foreground">{{ row.count }}</td>
              <td class="max-w-[24rem] truncate px-3 py-2.5 text-muted-foreground" :title="row.description">
                {{ row.description }}
              </td>
              <td class="px-3 py-2.5">
                <div class="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="secondary" type="button" @click="handleEdit(row)">
                    编辑
                  </Button>
                  <Button size="sm" variant="destructive" type="button" @click="openDeleteCategoryDialog(row)">
                    删除
                  </Button>
                </div>
              </td>
            </tr>
            <tr v-if="categories.length === 0 && !listLoading">
              <td colspan="5" class="px-3 py-12 text-center text-muted-foreground">
                暂无分类数据
              </td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>

    <Dialog v-model:open="dialogVisible">
      <DialogContent class="flex max-h-[92vh] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader class="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle>{{ isEdit ? '编辑分类' : '添加分类' }}</DialogTitle>
          <DialogDescription>
            <template v-if="isEdit">
              正在编辑「{{ form.title || '未命名' }}」<span v-if="form.id" class="text-muted-foreground">（ID {{ form.id }}）</span>
            </template>
            <template v-else>
              上传分类配图并填写信息；带 <span class="text-destructive">*</span> 为必填
            </template>
          </DialogDescription>
        </DialogHeader>

        <div class="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(240px,280px)_1fr]">
          <!-- 左侧：配图 -->
          <div class="flex flex-col gap-3 border-border bg-muted/15 p-4 lg:border-r">
            <div class="flex flex-col gap-2">
              <Label>分类配图 <span class="text-destructive">*</span></Label>
              <input
                ref="imageInput"
                type="file"
                accept="image/*"
                class="hidden"
                @change="handleImageFileSelect"
              >
              <div
                class="relative aspect-square w-full max-w-[280px] cursor-pointer overflow-hidden rounded-lg border-2 border-dashed border-border bg-background transition hover:border-primary/40"
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
                  v-if="form.image"
                  :src="getImageUrl(form.image)"
                  alt="分类配图"
                  class="size-full object-cover"
                  loading="lazy"
                >
                <div v-else class="flex size-full flex-col items-center justify-center gap-2 p-4 text-center">
                  <Upload class="size-10 text-muted-foreground" aria-hidden="true" />
                  <p class="text-sm font-medium">上传配图</p>
                  <p class="text-xs text-muted-foreground">JPG / PNG / GIF，≤5MB</p>
                </div>
                <div
                  v-if="isImageDragOver"
                  class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-primary/10 text-sm font-medium text-primary"
                >
                  释放以上传
                </div>
                <div
                  v-if="form.image && !isImageUploading && !isImageProcessing"
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
                    @click.stop="clearCategoryImage"
                  >
                    <X class="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <div
                v-if="isImageProcessing || (imageUploadProgress > 0 && imageUploadProgress < 100)"
                class="max-w-[280px] rounded-lg border border-border bg-background p-2 text-xs text-muted-foreground"
              >
                <Progress :model-value="isImageProcessing ? 40 : imageUploadProgress" class="h-1.5" />
                <p class="mt-1.5 text-center">
                  {{ isImageProcessing ? '处理中…' : `上传中 ${imageUploadProgress}%` }}
                </p>
              </div>
            </div>
            <p class="max-w-[280px] text-xs text-muted-foreground">
              标题与描述在右侧填写。
            </p>
          </div>

          <!-- 右侧：基本信息 -->
          <ScrollArea class="min-h-[320px] flex-1 lg:max-h-[min(56vh,560px)]">
            <div class="space-y-4 p-4">
              <div class="flex flex-col gap-2">
                <Label for="pc-title">标题 <span class="text-destructive">*</span></Label>
                <Input id="pc-title" v-model="form.title" autocomplete="off" placeholder="分类名称" />
              </div>
              <div class="flex flex-col gap-2">
                <Label for="pc-desc">描述</Label>
                <Textarea
                  id="pc-desc"
                  v-model="form.description"
                  class="min-h-[min(280px,40vh)]"
                  rows="10"
                  placeholder="分类说明，将展示给用户"
                />
              </div>
              <p
                v-if="isEdit && editCategoryCount != null"
                class="text-xs text-muted-foreground"
              >
                该分类下共有 <span class="font-medium tabular-nums text-foreground">{{ editCategoryCount }}</span> 件版权实物（仅展示，不可在此修改）
              </p>
            </div>
          </ScrollArea>
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

    <AlertDialog v-model:open="deleteCategoryDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除分类</AlertDialogTitle>
          <AlertDialogDescription>
            确定要删除这个分类吗？此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter class="gap-2 sm:justify-end">
          <AlertDialogCancel type="button">
            取消
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            :disabled="deletingCategory"
            @click="confirmDeleteCategory"
          >
            <Loader2 v-if="deletingCategory" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            删除
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { AlertCircle, Loader2, Upload, X } from 'lucide-vue-next'
import axios from '../utils/axios'
import { API_BASE_URL } from '../config'
import { getListThumbnailUrl } from '@/utils/listImageUrl'
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
import { Textarea } from '@/components/ui/textarea'

const route = useRoute()
const router = useRouter()

const savingForm = ref(false)
const editCategoryCount = ref(null)

const categories = ref([])
const listLoading = ref(false)
const listError = ref('')
const dialogVisible = ref(false)
const isEdit = ref(false)

const imageInput = ref(null)
const isImageDragOver = ref(false)
const imageUploadProgress = ref(0)
const isImageUploading = ref(false)
const isImageProcessing = ref(false)
const imageFileName = ref('')
const imageFileSize = ref(0)

const form = ref({
  title: '',
  image: '',
  description: ''
})

const deleteCategoryDialogOpen = ref(false)
const deleteCategoryTarget = ref(null)
const deletingCategory = ref(false)

const retryFetchCategories = () => {
  listError.value = ''
  fetchCategories()
}

const fetchCategories = async () => {
  listLoading.value = true
  listError.value = ''
  try {
    const response = await axios.get('/physical-categories')
    let categoriesData = []
    if (response && response.data && Array.isArray(response.data)) {
      categoriesData = response.data
    } else if (response && Array.isArray(response)) {
      categoriesData = response
    } else {
      categories.value = []
      listError.value = '接口返回格式异常，无法展示列表'
      return
    }

    categories.value = categoriesData.map((category) => ({
      ...category,
      image: getImageUrl(category.image)
    }))
  } catch (error) {
    console.error('获取分类失败:', error)
    categories.value = []
    listError.value = '获取分类列表失败，请检查网络或稍后重试'
  } finally {
    listLoading.value = false
  }
}

const handleAdd = () => {
  isEdit.value = false
  form.value = {
    title: '',
    image: '',
    description: ''
  }
  editCategoryCount.value = null
  resetImageUploadState()
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  form.value = { ...row }
  editCategoryCount.value = row.count ?? null
  resetImageUploadState()
  dialogVisible.value = true
}

function openDeleteCategoryDialog(row) {
  deleteCategoryTarget.value = row
  deleteCategoryDialogOpen.value = true
}

async function confirmDeleteCategory() {
  const row = deleteCategoryTarget.value
  if (!row?.id) return
  deletingCategory.value = true
  try {
    await axios.delete(`/physical-categories/${row.id}`)
    ElMessage.success('删除成功')
    deleteCategoryDialogOpen.value = false
    deleteCategoryTarget.value = null
    fetchCategories()
  } catch {
    ElMessage.error('删除失败')
  } finally {
    deletingCategory.value = false
  }
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
    form.value.image = imageUrl
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

function clearCategoryImage() {
  form.value.image = ''
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
  if (files.length > 0) {
    uploadImageFile(files[0])
  }
}

const getImageUrl = (url) => {
  if (!url) return ''
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`
}

const handleSubmit = async () => {
  if (!form.value.title.trim()) {
    ElMessage.warning('请输入分类标题')
    return
  }
  if (!form.value.image || !String(form.value.image).trim()) {
    ElMessage.warning('请上传分类图片')
    return
  }

  savingForm.value = true
  try {
    const submitData = {
      ...form.value,
      image: form.value.image ? (form.value.image.startsWith('http') ? form.value.image.replace(API_BASE_URL, '') : form.value.image) : ''
    }

    if (isEdit.value) {
      await axios.put(`/physical-categories/${form.value.id}`, submitData)
    } else {
      await axios.post('/physical-categories', submitData)
    }
    ElMessage.success('保存成功')
    dialogVisible.value = false
    fetchCategories()
  } catch (error) {
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

  const row = categories.value.find((c) => c.id === id)
  if (row) {
    handleEdit(row)
  } else {
    ElMessage.error('未找到该分类')
  }

  const nextQuery = { ...route.query }
  delete nextQuery.edit
  router.replace({ path: route.path, query: nextQuery })
}

onMounted(async () => {
  await fetchCategories()
  await openEditFromRouteQuery()
})
</script>
