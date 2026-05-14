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
                    :src="getImageUrl(row.image)"
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
                  <Button size="sm" variant="destructive" type="button" @click="handleDelete(row)">
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
      <DialogContent class="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ isEdit ? '编辑分类' : '添加分类' }}</DialogTitle>
        </DialogHeader>

        <div class="grid gap-4 py-2">
          <div class="flex flex-col gap-2">
            <Label for="pc-title">标题</Label>
            <Input id="pc-title" v-model="form.title" autocomplete="off" />
          </div>

          <div class="flex flex-col gap-2">
            <Label>图片 <span class="text-destructive">*</span></Label>
            <div class="max-w-[400px] space-y-3">
              <div
                v-if="form.image"
                class="group relative size-[200px] overflow-hidden rounded-lg border border-border shadow-sm"
              >
                <img :src="getImageUrl(form.image)" alt="分类配图" class="size-full object-cover">
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
                  v-if="isImageDragOver && !form.image"
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
            <Label for="pc-desc">描述</Label>
            <Textarea id="pc-desc" v-model="form.description" class="min-h-24" rows="4" />
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
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { AlertCircle, Loader2, Trash2, Upload } from 'lucide-vue-next'
import axios from '../utils/axios'
import { API_BASE_URL } from '../config'
import { uploadImageToWebpLimit5MB } from '../utils/image'
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
import { Textarea } from '@/components/ui/textarea'

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
  resetImageUploadState()
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  form.value = { ...row }
  resetImageUploadState()
  dialogVisible.value = true
}

const handleDelete = (row) => {
  ElMessageBox.confirm('确定要删除这个分类吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await axios.delete(`/physical-categories/${row.id}`)
      ElMessage.success('删除成功')
      fetchCategories()
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
    form.value.image = ''
    ElMessage.success('图片已删除')
  } catch {
    // 用户取消删除
  }
}

const handleImageDragEnter = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!isImageUploading.value && !isImageProcessing.value && !form.value.image) {
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

  if (isImageUploading.value || isImageProcessing.value || form.value.image) return

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
  }
}

onMounted(() => {
  fetchCategories()
})
</script>
