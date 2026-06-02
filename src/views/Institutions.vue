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
                    :src="getListThumbnailUrl(getImageUrl(row.logo))"
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
                  <Button size="sm" variant="destructive" type="button" @click="openDeleteInstitutionDialog(row)">
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
      <DialogContent class="flex max-h-[92vh] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader class="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle>{{ isEdit ? '编辑机构' : '添加机构' }}</DialogTitle>
          <DialogDescription>
            <template v-if="isEdit">
              正在编辑「{{ form.name || '未命名' }}」<span v-if="form.id" class="text-muted-foreground">（ID {{ form.id }}）</span>
            </template>
            <template v-else>
              上传 Logo 并填写机构信息；带 <span class="text-destructive">*</span> 为必填
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
                  alt="机构 Logo"
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
                    @click.stop="clearInstitutionLogo"
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
              名称与联系方式在右侧 Tab 中填写。
            </p>
          </div>

          <!-- 右侧：Tab -->
          <div class="flex min-h-0 flex-col">
            <Tabs v-model="institutionFormTab" class="flex min-h-0 flex-1 flex-col">
              <div class="shrink-0 border-b border-border px-4 pt-3">
                <TabsList class="grid h-auto w-full grid-cols-2 gap-1">
                  <TabsTrigger value="basic" class="text-xs sm:text-sm">
                    基本信息
                  </TabsTrigger>
                  <TabsTrigger value="contact" class="text-xs sm:text-sm">
                    联系信息
                  </TabsTrigger>
                </TabsList>
              </div>

              <ScrollArea class="min-h-[320px] flex-1 lg:max-h-[min(56vh,560px)]">
                <TabsContent value="basic" class="mt-0 space-y-4 p-4">
                  <div class="flex flex-col gap-2">
                    <Label for="inst-name">机构名称 <span class="text-destructive">*</span></Label>
                    <Input id="inst-name" v-model="form.name" autocomplete="organization" placeholder="机构全称" />
                  </div>
                  <div class="flex flex-col gap-2">
                    <Label for="inst-desc">描述</Label>
                    <Textarea
                      id="inst-desc"
                      v-model="form.description"
                      class="min-h-[min(240px,36vh)]"
                      rows="8"
                      placeholder="机构简介、特色等"
                    />
                  </div>
                </TabsContent>

                <TabsContent value="contact" class="mt-0 space-y-4 p-4">
                  <div class="flex flex-col gap-2">
                    <Label for="inst-address">地址</Label>
                    <Input id="inst-address" v-model="form.address" autocomplete="street-address" placeholder="详细地址" />
                  </div>
                  <div class="flex flex-col gap-2">
                    <Label for="inst-phone">电话</Label>
                    <Input id="inst-phone" v-model="form.phone" type="tel" autocomplete="tel" placeholder="联系电话" />
                  </div>
                  <div class="flex flex-col gap-2">
                    <Label for="inst-website">网站</Label>
                    <Input
                      id="inst-website"
                      v-model="form.website"
                      type="url"
                      autocomplete="url"
                      placeholder="https://example.com"
                    />
                    <p class="text-xs text-muted-foreground">
                      可填写完整 URL，列表中将自动补全协议头
                    </p>
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
                      :src="getListThumbnailUrl(getImageUrl(row.avatar))"
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

    <AlertDialog v-model:open="deleteInstitutionDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除机构</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除「{{ deleteInstitutionName }}」吗？此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter class="gap-2 sm:justify-end">
          <AlertDialogCancel type="button">
            取消
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            :disabled="deletingInstitution"
            @click="confirmDeleteInstitution"
          >
            <Loader2 v-if="deletingInstitution" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

const route = useRoute()
const router = useRouter()

const institutionFormTab = ref('basic')
const savingForm = ref(false)
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

const deleteInstitutionDialogOpen = ref(false)
const deleteInstitutionTarget = ref(null)
const deletingInstitution = ref(false)
const deleteInstitutionName = computed(() => {
  const row = deleteInstitutionTarget.value
  if (!row) return '该机构'
  return row.name || '未命名'
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
  institutionFormTab.value = 'basic'
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
  institutionFormTab.value = 'basic'
  resetLogoUploadState()
  dialogVisible.value = true
}

function openDeleteInstitutionDialog(row) {
  deleteInstitutionTarget.value = row
  deleteInstitutionDialogOpen.value = true
}

async function confirmDeleteInstitution() {
  const row = deleteInstitutionTarget.value
  if (!row?.id) return
  deletingInstitution.value = true
  try {
    await axios.delete(`/institutions/${row.id}`)
    ElMessage.success('删除成功')
    deleteInstitutionDialogOpen.value = false
    deleteInstitutionTarget.value = null
    fetchInstitutions()
  } catch {
    ElMessage.error('删除失败')
  } finally {
    deletingInstitution.value = false
  }
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

function clearInstitutionLogo() {
  form.value.logo = ''
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
  if (files.length > 0) {
    uploadLogoFile(files[0])
  }
}

const getImageUrl = (url) => {
  if (!url) return ''
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`
}

const handleSubmit = async () => {
  if (!form.value.name.trim()) {
    ElMessage.warning('请输入机构名称')
    institutionFormTab.value = 'basic'
    return
  }
  if (!form.value.logo || !String(form.value.logo).trim()) {
    ElMessage.warning('请上传机构 Logo')
    return
  }

  savingForm.value = true
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
  } finally {
    savingForm.value = false
  }
}

async function openEditFromRouteQuery() {
  const raw = route.query.edit
  if (!raw) return
  const id = Number(raw)
  if (!id) return

  const row = institutions.value.find((i) => i.id === id)
  if (row) {
    handleEdit(row)
  } else {
    ElMessage.error('未找到该机构')
  }

  const nextQuery = { ...route.query }
  delete nextQuery.edit
  router.replace({ path: route.path, query: nextQuery })
}

onMounted(async () => {
  await fetchInstitutions()
  await openEditFromRouteQuery()
})
</script>
