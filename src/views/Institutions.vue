<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h2 class="text-xl font-semibold tracking-tight text-foreground">
        机构管理
      </h2>
      <Button type="button" @click="handleAdd">
        添加机构
      </Button>
    </div>

    <Alert v-if="listError && !listLoading" variant="destructive">
      <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
      <AlertTitle>{{ listError }}</AlertTitle>
      <AlertDescription class="mt-2">
        <Button type="button" variant="secondary" size="sm" @click="retryFetchInstitutions">
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
        <table class="w-full min-w-[960px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="h-10 w-20 px-3 text-left font-medium">Logo</th>
              <th class="h-10 px-3 text-left font-medium">机构名称</th>
              <th class="h-10 max-w-[12rem] px-3 text-left font-medium">描述</th>
              <th class="h-10 max-w-[12rem] px-3 text-left font-medium">地址</th>
              <th class="h-10 w-28 px-3 text-left font-medium">电话</th>
              <th class="h-10 min-w-[8rem] px-3 text-left font-medium">网站</th>
              <th class="h-10 min-w-[17rem] px-3 text-left font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in institutions"
              :key="row.id"
              class="border-b border-border transition-colors hover:bg-muted/30"
            >
              <td class="px-3 py-2">
                <div class="size-12 overflow-hidden rounded-md border border-border bg-muted/30">
                  <img
                    :src="getImageUrl(row.logo)"
                    :alt="row.name ? `${row.name} Logo` : '机构 Logo'"
                    class="size-full object-cover"
                    loading="lazy"
                    @error="(e) => { e.target.style.opacity = '0.35' }"
                  >
                </div>
              </td>
              <td class="px-3 py-2.5 font-medium">{{ row.name }}</td>
              <td class="max-w-[12rem] truncate px-3 py-2.5 text-muted-foreground" :title="row.description">
                {{ row.description }}
              </td>
              <td class="max-w-[12rem] truncate px-3 py-2.5 text-muted-foreground" :title="row.address">
                {{ row.address }}
              </td>
              <td class="px-3 py-2.5 tabular-nums text-muted-foreground">{{ row.phone }}</td>
              <td class="max-w-[10rem] truncate px-3 py-2.5 text-primary underline-offset-2 hover:underline">
                <a
                  v-if="row.website"
                  :href="normalizeWebsiteHref(row.website)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="block truncate"
                  :title="row.website"
                >{{ row.website }}</a>
                <span v-else class="text-muted-foreground">—</span>
              </td>
              <td class="px-3 py-2.5">
                <div class="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="secondary" type="button" @click="handleEdit(row)">
                    编辑
                  </Button>
                  <Button size="sm" variant="outline" type="button" @click="handleViewArtists(row)">
                    查看艺术家
                  </Button>
                  <Button size="sm" variant="destructive" type="button" @click="handleDelete(row)">
                    删除
                  </Button>
                </div>
              </td>
            </tr>
            <tr v-if="institutions.length === 0 && !listLoading">
              <td colspan="7" class="px-3 py-12 text-center text-muted-foreground">
                暂无机构数据
              </td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>

    <Dialog v-model:open="dialogVisible">
      <DialogContent class="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{{ isEdit ? '编辑机构' : '添加机构' }}</DialogTitle>
        </DialogHeader>

        <div class="grid gap-4 py-2">
          <div class="flex flex-col gap-2">
            <Label for="inst-name">机构名称</Label>
            <Input id="inst-name" v-model="form.name" autocomplete="organization" />
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
                  <Button type="button" size="icon" variant="destructive" @click="removeLogo">
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
              <Alert v-if="logoUploadProgress === 100" class="border-primary/30">
                <AlertCircle class="size-4 shrink-0 text-primary" aria-hidden="true" />
                <AlertTitle>Logo 上传成功</AlertTitle>
              </Alert>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <Label for="inst-desc">描述</Label>
            <Textarea id="inst-desc" v-model="form.description" class="min-h-24" rows="4" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="inst-address">地址</Label>
            <Input id="inst-address" v-model="form.address" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="inst-phone">电话</Label>
            <Input id="inst-phone" v-model="form.phone" type="tel" autocomplete="tel" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="inst-website">网站</Label>
            <Input id="inst-website" v-model="form.website" type="url" autocomplete="url" placeholder="https://" />
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

    <Dialog v-model:open="artistsDialogVisible">
      <DialogContent class="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{{ selectedInstitution?.name || '' }} — 艺术家列表</DialogTitle>
        </DialogHeader>

        <div v-if="institutionArtists.length === 0" class="py-12 text-center text-sm text-muted-foreground">
          该机构下暂无艺术家
        </div>
        <div v-else class="overflow-x-auto rounded-lg border border-border">
          <table class="w-full min-w-[640px] text-sm">
            <thead>
              <tr class="border-b border-border bg-muted/40">
                <th class="h-10 w-20 px-3 text-left font-medium">头像</th>
                <th class="h-10 px-3 text-left font-medium">姓名</th>
                <th class="h-10 px-3 text-left font-medium">时代</th>
                <th class="h-10 max-w-[14rem] px-3 text-left font-medium">艺术历程</th>
                <th class="h-10 w-40 px-3 text-left font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in institutionArtists"
                :key="row.id"
                class="border-b border-border last:border-0 hover:bg-muted/30"
              >
                <td class="px-3 py-2">
                  <div class="size-12 overflow-hidden rounded-md border border-border bg-muted/30">
                    <img
                      :src="getImageUrl(row.avatar)"
                      :alt="row.name ? `${row.name} 头像` : '艺术家头像'"
                      class="size-full object-cover"
                      loading="lazy"
                      @error="(e) => { e.target.style.opacity = '0.35' }"
                    >
                  </div>
                </td>
                <td class="px-3 py-2.5 font-medium">{{ row.name }}</td>
                <td class="px-3 py-2.5 text-muted-foreground">{{ row.era }}</td>
                <td class="max-w-[14rem] truncate px-3 py-2.5 text-muted-foreground" :title="row.description">
                  {{ row.description }}
                </td>
                <td class="px-3 py-2.5">
                  <Button size="sm" variant="secondary" type="button" @click="handleEditArtist(row)">
                    编辑艺术家
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" @click="artistsDialogVisible = false">
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
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

const router = useRouter()
const institutions = ref([])
const listLoading = ref(false)
const listError = ref('')
const dialogVisible = ref(false)
const isEdit = ref(false)
const artistsDialogVisible = ref(false)
const selectedInstitution = ref(null)
const institutionArtists = ref([])

const logoInput = ref(null)
const isLogoDragOver = ref(false)
const logoUploadProgress = ref(0)
const isLogoUploading = ref(false)
const isLogoProcessing = ref(false)
const logoFileName = ref('')
const logoFileSize = ref(0)

const form = ref({
  name: '',
  logo: '',
  description: '',
  address: '',
  phone: '',
  website: ''
})

function normalizeWebsiteHref(website) {
  const w = (website || '').trim()
  if (!w) return '#'
  if (/^https?:\/\//i.test(w)) return w
  return `https://${w}`
}

const retryFetchInstitutions = () => {
  listError.value = ''
  fetchInstitutions()
}

const fetchInstitutions = async () => {
  listLoading.value = true
  listError.value = ''
  try {
    const data = await axios.get('/institutions')
    if (Array.isArray(data)) {
      institutions.value = data
    } else {
      institutions.value = []
      listError.value = '接口返回格式异常，无法展示列表'
    }
  } catch (error) {
    console.error('获取机构列表失败：', error)
    institutions.value = []
    listError.value = '获取机构列表失败，请检查网络或稍后重试'
  } finally {
    listLoading.value = false
  }
}

const handleAdd = () => {
  isEdit.value = false
  form.value = {
    name: '',
    logo: '',
    description: '',
    address: '',
    phone: '',
    website: ''
  }
  resetLogoUploadState()
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  form.value = {
    id: row.id,
    name: row.name,
    logo: row.logo,
    description: row.description,
    address: row.address,
    phone: row.phone,
    website: row.website
  }
  resetLogoUploadState()
  dialogVisible.value = true
}

const handleDelete = (row) => {
  ElMessageBox.confirm('确定要删除这个机构吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await axios.delete(`/institutions/${row.id}`)
      ElMessage.success('删除成功')
      fetchInstitutions()
    } catch (error) {
      ElMessage.error('删除失败')
    }
  })
}

const handleViewArtists = async (row) => {
  try {
    selectedInstitution.value = row
    const response = await axios.get(`/institutions/${row.id}/artists`)
    institutionArtists.value = response.artists || []
    artistsDialogVisible.value = true
  } catch (error) {
    console.error('获取机构艺术家失败：', error)
    ElMessage.error('获取机构艺术家失败')
  }
}

const handleEditArtist = (artist) => {
  router.push({
    path: '/artists',
    query: { edit: String(artist.id) }
  })
}

const triggerLogoInput = () => {
  if (!isLogoUploading.value && !isLogoProcessing.value) {
    logoInput.value?.click()
  }
}

const handleLogoFileSelect = (event) => {
  const file = event.target.files[0]
  if (file) {
    uploadLogoFile(file)
  }
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

    const response = await axios.post('/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          logoUploadProgress.value = percent
        } else {
          logoUploadProgress.value = Math.min(logoUploadProgress.value + 10, 90)
        }
      }
    })

    handleLogoUploadSuccess(response)
  } catch (error) {
    handleLogoUploadError(error)
  }
}

const handleLogoUploadSuccess = (response) => {
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

const removeLogo = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要删除这个Logo吗？',
      '确认删除',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
    form.value.logo = ''
    ElMessage.success('Logo已删除')
  } catch {
    // 用户取消删除
  }
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
  if (files.length > 0) {
    uploadLogoFile(files[0])
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
  if (!form.value.name.trim()) {
    ElMessage.warning('请输入机构名称')
    return
  }

  try {
    const submitData = {
      ...form.value,
      logo: form.value.logo ? (form.value.logo.startsWith('http') ? form.value.logo.replace(API_BASE_URL, '') : form.value.logo) : ''
    }

    if (isEdit.value) {
      await axios.put(`/institutions/${form.value.id}`, submitData)
    } else {
      await axios.post('/institutions', submitData)
    }
    ElMessage.success('保存成功')
    dialogVisible.value = false
    fetchInstitutions()
  } catch (error) {
    ElMessage.error('保存失败')
  }
}

onMounted(() => {
  fetchInstitutions()
})
</script>
