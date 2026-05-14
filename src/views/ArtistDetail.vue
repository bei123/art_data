<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div class="flex items-center gap-2">
      <Button variant="ghost" size="sm" class="gap-1.5 px-2" @click="goBack">
        <ArrowLeft class="size-4 shrink-0" aria-hidden="true" />
        返回列表
      </Button>
    </div>

    <Card class="relative overflow-hidden">
      <div
        v-if="loading"
        class="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-[1px]"
        aria-busy="true"
        aria-label="加载中"
      >
        <Loader2 class="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>

      <CardHeader class="gap-4 border-b border-border pb-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle class="text-lg">艺术家详情</CardTitle>
          <div class="flex flex-wrap gap-2">
            <Button variant="outline" @click="goToFeaturedManager">
              管理代表作品
            </Button>
            <Button @click="handleEdit">
              编辑
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent class="flex flex-col gap-6 pt-6">
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
          <div class="flex flex-col gap-2">
            <Label for="artist-name">艺术家姓名</Label>
            <Input id="artist-name" v-model="form.name" autocomplete="off" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="artist-era">所属时代</Label>
            <Input id="artist-era" v-model="form.era" autocomplete="off" />
          </div>
        </div>

        <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div class="flex flex-col gap-2">
            <Label>头像 <span class="text-destructive">*</span></Label>
            <div class="w-full max-w-[400px]">
              <div
                v-if="form.avatar"
                class="group/preview relative size-[200px] max-h-[200px] max-w-full overflow-hidden rounded-lg shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <img :src="getImageUrl(form.avatar)" class="size-full object-cover" alt="头像">
                <div
                  class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-foreground/50 opacity-0 transition-opacity group-hover/preview:opacity-100"
                >
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon-sm"
                    class="rounded-full"
                    aria-label="删除头像"
                    @click="removeAvatar"
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                  <Button type="button" size="sm" @click="triggerAvatarInput">
                    更换头像
                  </Button>
                </div>
              </div>

              <div
                v-else
                class="relative flex size-[200px] max-w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-border bg-muted/30 transition hover:border-primary/40 hover:bg-muted/50"
                :class="{
                  'border-primary/60 bg-primary/5 shadow-md scale-[1.02]': isAvatarDragOver,
                  'pointer-events-none opacity-70 border-primary/40': isAvatarUploading || isAvatarProcessing,
                }"
                role="button"
                tabindex="0"
                @click="triggerAvatarInput"
                @keydown.enter.prevent="triggerAvatarInput"
                @keydown.space.prevent="triggerAvatarInput"
                @dragenter="handleAvatarDragEnter"
                @dragleave="handleAvatarDragLeave"
                @dragover="handleAvatarDragOver"
                @drop="handleAvatarDrop"
              >
                <div class="flex h-full flex-col items-center justify-center px-5 text-center">
                  <Loader2
                    v-if="isAvatarUploading || isAvatarProcessing"
                    class="mb-4 size-12 shrink-0 animate-spin text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Upload
                    v-else
                    class="mb-4 size-12 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <p class="mb-2 text-sm font-medium text-foreground">
                    {{ isAvatarProcessing ? '正在处理头像...' : isAvatarUploading ? '正在上传...' : '点击或拖拽头像到此处上传' }}
                  </p>
                  <p class="m-0 text-xs leading-snug text-muted-foreground">
                    支持 JPG、PNG、GIF 格式，自动转换为 WebP 格式并压缩至 5MB 以内
                  </p>
                </div>
                <div
                  v-if="isAvatarDragOver && !form.avatar"
                  class="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-primary/10 font-semibold text-primary"
                >
                  <Upload class="mb-2 size-12" aria-hidden="true" />
                  <p>释放鼠标上传头像</p>
                </div>
              </div>

              <input
                ref="avatarInput"
                type="file"
                accept="image/*"
                class="hidden"
                @change="handleAvatarFileSelect"
              >

              <div v-if="isAvatarProcessing" class="mt-4 rounded-lg border border-border bg-muted/40 p-4">
                <div class="mb-2 flex items-center justify-between text-sm">
                  <span class="font-medium text-foreground">头像处理中</span>
                  <span class="font-semibold text-primary">处理中...</span>
                </div>
                <div class="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuetext="处理中">
                  <div class="h-full w-full animate-pulse rounded-full bg-primary/70" />
                </div>
                <div class="mt-2 flex justify-between text-xs text-muted-foreground">
                  <span class="max-w-[150px] truncate">{{ avatarFileName }}</span>
                  <span>{{ formatFileSize(avatarFileSize) }}</span>
                </div>
                <p class="mt-2 text-center text-xs italic text-muted-foreground">
                  正在将头像转换为 WebP 格式并压缩...
                </p>
              </div>

              <div
                v-if="avatarUploadProgress > 0 && avatarUploadProgress < 100 && !isAvatarProcessing"
                class="mt-4 rounded-lg border border-border bg-muted/40 p-4"
              >
                <div class="mb-2 flex items-center justify-between text-sm">
                  <span class="font-medium text-foreground">上传进度</span>
                  <span class="font-semibold text-primary">{{ avatarUploadProgress }}%</span>
                </div>
                <Progress :model-value="avatarUploadProgress" class="h-2" />
                <div class="mt-2 flex justify-between text-xs text-muted-foreground">
                  <span class="max-w-[150px] truncate">{{ avatarFileName }}</span>
                  <span>{{ formatFileSize(avatarFileSize) }}</span>
                </div>
              </div>

              <div v-if="avatarUploadProgress === 100" class="mt-4">
                <Alert>
                  <CircleCheck class="text-primary" aria-hidden="true" />
                  <AlertTitle>头像上传成功！</AlertTitle>
                </Alert>
              </div>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <Label>背景图 <span class="text-destructive">*</span></Label>
            <div class="w-full max-w-[400px]">
              <div
                v-if="form.banner"
                class="group/preview relative size-[200px] max-h-[200px] max-w-full overflow-hidden rounded-lg shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <img :src="getImageUrl(form.banner)" class="size-full object-cover" alt="背景图">
                <div
                  class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-foreground/50 opacity-0 transition-opacity group-hover/preview:opacity-100"
                >
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon-sm"
                    class="rounded-full"
                    aria-label="删除背景图"
                    @click="removeBanner"
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                  <Button type="button" size="sm" @click="triggerBannerInput">
                    更换背景图
                  </Button>
                </div>
              </div>

              <div
                v-else
                class="relative flex size-[200px] max-w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-border bg-muted/30 transition hover:border-primary/40 hover:bg-muted/50"
                :class="{
                  'border-primary/60 bg-primary/5 shadow-md scale-[1.02]': isBannerDragOver,
                  'pointer-events-none opacity-70 border-primary/40': isBannerUploading || isBannerProcessing,
                }"
                role="button"
                tabindex="0"
                @click="triggerBannerInput"
                @keydown.enter.prevent="triggerBannerInput"
                @keydown.space.prevent="triggerBannerInput"
                @dragenter="handleBannerDragEnter"
                @dragleave="handleBannerDragLeave"
                @dragover="handleBannerDragOver"
                @drop="handleBannerDrop"
              >
                <div class="flex h-full flex-col items-center justify-center px-5 text-center">
                  <Loader2
                    v-if="isBannerUploading || isBannerProcessing"
                    class="mb-4 size-12 shrink-0 animate-spin text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Upload
                    v-else
                    class="mb-4 size-12 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <p class="mb-2 text-sm font-medium text-foreground">
                    {{ isBannerProcessing ? '正在处理背景图...' : isBannerUploading ? '正在上传...' : '点击或拖拽背景图到此处上传' }}
                  </p>
                  <p class="m-0 text-xs leading-snug text-muted-foreground">
                    支持 JPG、PNG、GIF 格式，自动转换为 WebP 格式并压缩至 5MB 以内
                  </p>
                </div>
                <div
                  v-if="isBannerDragOver && !form.banner"
                  class="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-primary/10 font-semibold text-primary"
                >
                  <Upload class="mb-2 size-12" aria-hidden="true" />
                  <p>释放鼠标上传背景图</p>
                </div>
              </div>

              <input
                ref="bannerInput"
                type="file"
                accept="image/*"
                class="hidden"
                @change="handleBannerFileSelect"
              >

              <div v-if="isBannerProcessing" class="mt-4 rounded-lg border border-border bg-muted/40 p-4">
                <div class="mb-2 flex items-center justify-between text-sm">
                  <span class="font-medium text-foreground">背景图处理中</span>
                  <span class="font-semibold text-primary">处理中...</span>
                </div>
                <div class="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuetext="处理中">
                  <div class="h-full w-full animate-pulse rounded-full bg-primary/70" />
                </div>
                <div class="mt-2 flex justify-between text-xs text-muted-foreground">
                  <span class="max-w-[150px] truncate">{{ bannerFileName }}</span>
                  <span>{{ formatFileSize(bannerFileSize) }}</span>
                </div>
                <p class="mt-2 text-center text-xs italic text-muted-foreground">
                  正在将背景图转换为 WebP 格式并压缩...
                </p>
              </div>

              <div
                v-if="bannerUploadProgress > 0 && bannerUploadProgress < 100 && !isBannerProcessing"
                class="mt-4 rounded-lg border border-border bg-muted/40 p-4"
              >
                <div class="mb-2 flex items-center justify-between text-sm">
                  <span class="font-medium text-foreground">上传进度</span>
                  <span class="font-semibold text-primary">{{ bannerUploadProgress }}%</span>
                </div>
                <Progress :model-value="bannerUploadProgress" class="h-2" />
                <div class="mt-2 flex justify-between text-xs text-muted-foreground">
                  <span class="max-w-[150px] truncate">{{ bannerFileName }}</span>
                  <span>{{ formatFileSize(bannerFileSize) }}</span>
                </div>
              </div>

              <div v-if="bannerUploadProgress === 100" class="mt-4">
                <Alert>
                  <CircleCheck class="text-primary" aria-hidden="true" />
                  <AlertTitle>背景图上传成功！</AlertTitle>
                </Alert>
              </div>
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <Label for="artist-description">简介</Label>
          <Textarea id="artist-description" v-model="form.description" class="min-h-28" rows="4" />
        </div>

        <div class="flex flex-col gap-2">
          <Label for="artist-journey">艺术历程</Label>
          <Textarea
            id="artist-journey"
            v-model="form.journey"
            class="min-h-40"
            rows="6"
            placeholder="请按时间顺序记录艺术家的重要创作时期、重大作品、获奖经历等"
          />
        </div>

        <div class="flex items-center gap-4 py-2">
          <Separator class="flex-1" />
          <span class="shrink-0 text-sm text-muted-foreground">成就列表</span>
          <Separator class="flex-1" />
        </div>

        <div
          v-for="(achievement, index) in form.achievements"
          :key="index"
          class="rounded-lg border border-border bg-card/50 p-4"
        >
          <div class="grid grid-cols-1 items-end gap-4 md:grid-cols-12">
            <div class="flex flex-col gap-2 md:col-span-4">
              <Label :for="`ach-title-${index}`">成就标题</Label>
              <Input :id="`ach-title-${index}`" v-model="achievement.title" />
            </div>
            <div class="flex flex-col gap-2 md:col-span-7">
              <Label :for="`ach-desc-${index}`">成就描述</Label>
              <Input :id="`ach-desc-${index}`" v-model="achievement.description" />
            </div>
            <div class="flex md:col-span-1 md:justify-end">
              <Button type="button" variant="destructive" @click="removeAchievement(index)">
                删除
              </Button>
            </div>
          </div>
        </div>

        <Button type="button" @click="addAchievement">
          添加成就
        </Button>
      </CardContent>
    </Card>

    <Card>
      <CardHeader class="border-b border-border pb-4">
        <CardTitle class="text-base">代表作品</CardTitle>
      </CardHeader>
      <CardContent class="pt-6">
        <div
          v-if="featuredList.length === 0"
          class="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground"
        >
          <ImageIcon class="size-10 opacity-40" aria-hidden="true" />
          <p class="text-sm">暂无代表作品</p>
        </div>
        <div v-else class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Card
            v-for="item in featuredList"
            :key="item.id"
            class="overflow-hidden shadow-none ring-1 transition hover:shadow-md"
          >
            <CardContent class="p-3">
              <img :src="getImageUrl(item.image)" class="aspect-square w-full rounded-md object-cover" alt="thumb">
              <div class="mt-2 flex flex-col gap-0.5">
                <div class="truncate text-sm font-medium" :title="item.title">{{ item.title }}</div>
                <div class="text-xs text-muted-foreground">#{{ item.id }} · {{ item.year || '-' }}</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>

    <div v-if="showFeaturedManager" ref="featuredManagerRef">
      <Card>
        <CardHeader class="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle class="text-base">代表作品管理</CardTitle>
          <Button :disabled="savingFeatured" @click="saveFeatured">
            {{ savingFeatured ? '保存中…' : '保存代表作品' }}
          </Button>
        </CardHeader>
        <CardContent class="pt-6">
          <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card class="shadow-none ring-1">
              <CardHeader class="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle class="text-sm font-medium">该艺术家全部作品</CardTitle>
                <div class="flex max-w-full flex-1 items-center gap-1 sm:max-w-[240px] sm:justify-end">
                  <Input
                    v-model="artworkSearch"
                    type="search"
                    placeholder="搜索标题"
                    class="h-8 min-w-0 flex-1"
                  />
                  <Button
                    v-if="artworkSearch"
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    class="shrink-0"
                    aria-label="清空搜索"
                    @click="artworkSearch = ''"
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent class="p-0">
                <div class="h-[400px] overflow-y-auto p-3">
                  <div
                    v-if="filteredAllArtworks.length === 0"
                    class="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground"
                  >
                    <ImageIcon class="size-10 opacity-40" aria-hidden="true" />
                    <p class="text-sm">暂无作品或未匹配</p>
                  </div>
                  <div v-else class="flex flex-col gap-2">
                    <div
                      v-for="item in filteredAllArtworks"
                      :key="item.id"
                      class="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background/80 p-2"
                    >
                      <img :src="getImageUrl(item.image)" class="size-14 shrink-0 rounded-md object-cover" alt="thumb">
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-sm font-medium" :title="item.title">{{ item.title }}</div>
                        <div class="text-xs text-muted-foreground">#{{ item.id }} · {{ item.year || '-' }}</div>
                      </div>
                      <div class="flex shrink-0 gap-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          :disabled="isInFeatured(item.id)"
                          @click="addToFeatured(item)"
                        >
                          {{ isInFeatured(item.id) ? '已添加' : '添加' }}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card class="shadow-none ring-1">
              <CardHeader class="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle class="text-sm font-medium">已选代表作品（可排序）</CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  :disabled="featuredList.length === 0"
                  @click="clearFeatured"
                >
                  清空
                </Button>
              </CardHeader>
              <CardContent class="p-0">
                <div class="h-[400px] overflow-y-auto p-3">
                  <div
                    v-if="featuredList.length === 0"
                    class="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground"
                  >
                    <ImageIcon class="size-10 opacity-40" aria-hidden="true" />
                    <p class="text-sm">未选择</p>
                  </div>
                  <div v-else class="flex flex-col gap-2">
                    <div
                      v-for="(item, index) in featuredList"
                      :key="item.id"
                      class="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background/80 p-2"
                    >
                      <img :src="getImageUrl(item.image)" class="size-14 shrink-0 rounded-md object-cover" alt="thumb">
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-sm font-medium" :title="item.title">
                          {{ index + 1 }}. {{ item.title }}
                        </div>
                        <div class="text-xs text-muted-foreground">#{{ item.id }} · {{ item.year || '-' }}</div>
                      </div>
                      <div class="flex shrink-0 flex-wrap gap-1">
                        <Button size="sm" variant="secondary" :disabled="index === 0" @click="moveUp(index)">
                          上移
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          :disabled="index === featuredList.length - 1"
                          @click="moveDown(index)"
                        >
                          下移
                        </Button>
                        <Button size="sm" variant="destructive" @click="removeFromFeatured(index)">
                          移除
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft,
  CircleCheck,
  Image as ImageIcon,
  Loader2,
  Trash2,
  Upload,
  X,
} from 'lucide-vue-next'
import { ElMessage, ElMessageBox } from 'element-plus'
import axios from '../utils/axios'
import { API_BASE_URL, isOssPublicUrl } from '../config'
import { uploadImageToWebpLimit5MB } from '../utils/image'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertTitle } from '@/components/ui/alert'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const savingFeatured = ref(false)
const artworkSearch = ref('')
const allArtworks = ref([])
const featuredList = ref([])
const showFeaturedManager = ref(true)
const featuredManagerRef = ref(null)

const form = ref({
  name: '',
  avatar: '',
  banner: '',
  era: '',
  description: '',
  journey: '',
  achievements: [],
})

const avatarInput = ref(null)
const isAvatarDragOver = ref(false)
const avatarUploadProgress = ref(0)
const isAvatarUploading = ref(false)
const isAvatarProcessing = ref(false)
const avatarFileName = ref('')
const avatarFileSize = ref(0)

const bannerInput = ref(null)
const isBannerDragOver = ref(false)
const bannerUploadProgress = ref(0)
const isBannerUploading = ref(false)
const isBannerProcessing = ref(false)
const bannerFileName = ref('')
const bannerFileSize = ref(0)

const fetchArtistDetail = async () => {
  loading.value = true
  try {
    const response = await axios.get(`/artists/${route.params.id}`)
    const data = response.data
    form.value = {
      ...data,
      achievements: data.achievements || [],
    }
  } catch {
    ElMessage.error('获取艺术家详情失败')
  } finally {
    loading.value = false
  }
}

const triggerAvatarInput = () => {
  if (!isAvatarUploading.value && !isAvatarProcessing.value)
    avatarInput.value?.click()
}

const handleAvatarFileSelect = (event) => {
  const file = event.target.files[0]
  if (file)
    uploadAvatarFile(file)

  event.target.value = ''
}

const uploadAvatarFile = async (file) => {
  avatarUploadProgress.value = 0
  isAvatarUploading.value = true
  isAvatarProcessing.value = true
  avatarFileName.value = file.name
  avatarFileSize.value = file.size

  try {
    const processedFile = await uploadImageToWebpLimit5MB(file)

    if (!processedFile) {
      resetAvatarUploadState()
      return
    }

    isAvatarProcessing.value = false
    avatarFileName.value = processedFile.name
    avatarFileSize.value = processedFile.size

    const formData = new FormData()
    formData.append('file', processedFile)

    const response = await axios.post(`${API_BASE_URL}/api/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          avatarUploadProgress.value = percent
        } else {
          avatarUploadProgress.value = Math.min(avatarUploadProgress.value + 10, 90)
        }
      },
    })

    handleAvatarUploadSuccess(response)
  } catch (error) {
    handleAvatarUploadError(error)
  }
}

const handleAvatarUploadSuccess = (response) => {
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
    form.value.avatar = imageUrl
    avatarUploadProgress.value = 100

    setTimeout(() => {
      avatarUploadProgress.value = 0
      isAvatarUploading.value = false
      avatarFileName.value = ''
      avatarFileSize.value = 0
    }, 2000)

    ElMessage.success('头像上传成功')
  } else {
    ElMessage.error('头像上传失败：未获取到图片URL')
    resetAvatarUploadState()
  }
}

const handleAvatarUploadError = (error) => {
  ElMessage.error(`头像上传失败：${error.response?.data?.message || '未知错误'}`)
  resetAvatarUploadState()
}

const resetAvatarUploadState = () => {
  avatarUploadProgress.value = 0
  isAvatarUploading.value = false
  isAvatarProcessing.value = false
  avatarFileName.value = ''
  avatarFileSize.value = 0
}

const removeAvatar = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要删除这张头像吗？',
      '确认删除',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
    form.value.avatar = ''
    ElMessage.success('头像已删除')
  } catch {
    // 用户取消删除
  }
}

const handleAvatarDragEnter = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!isAvatarUploading.value && !isAvatarProcessing.value && !form.value.avatar)
    isAvatarDragOver.value = true
}

const handleAvatarDragLeave = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!e.currentTarget.contains(e.relatedTarget))
    isAvatarDragOver.value = false
}

const handleAvatarDragOver = (e) => {
  e.preventDefault()
  e.stopPropagation()
}

const handleAvatarDrop = (e) => {
  e.preventDefault()
  e.stopPropagation()
  isAvatarDragOver.value = false

  if (isAvatarUploading.value || isAvatarProcessing.value || form.value.avatar)
    return

  const files = e.dataTransfer.files
  if (files.length > 0)
    uploadAvatarFile(files[0])
}

const triggerBannerInput = () => {
  if (!isBannerUploading.value && !isBannerProcessing.value)
    bannerInput.value?.click()
}

const handleBannerFileSelect = (event) => {
  const file = event.target.files[0]
  if (file)
    uploadBannerFile(file)

  event.target.value = ''
}

const uploadBannerFile = async (file) => {
  bannerUploadProgress.value = 0
  isBannerUploading.value = true
  isBannerProcessing.value = true
  bannerFileName.value = file.name
  bannerFileSize.value = file.size

  try {
    const processedFile = await uploadImageToWebpLimit5MB(file)

    if (!processedFile) {
      resetBannerUploadState()
      return
    }

    isBannerProcessing.value = false
    bannerFileName.value = processedFile.name
    bannerFileSize.value = processedFile.size

    const formData = new FormData()
    formData.append('file', processedFile)

    const response = await axios.post(`${API_BASE_URL}/api/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          bannerUploadProgress.value = percent
        } else {
          bannerUploadProgress.value = Math.min(bannerUploadProgress.value + 10, 90)
        }
      },
    })

    handleBannerUploadSuccess(response)
  } catch (error) {
    handleBannerUploadError(error)
  }
}

const handleBannerUploadSuccess = (response) => {
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
    form.value.banner = imageUrl
    bannerUploadProgress.value = 100

    setTimeout(() => {
      bannerUploadProgress.value = 0
      isBannerUploading.value = false
      bannerFileName.value = ''
      bannerFileSize.value = 0
    }, 2000)

    ElMessage.success('背景图上传成功')
  } else {
    ElMessage.error('背景图上传失败：未获取到图片URL')
    resetBannerUploadState()
  }
}

const handleBannerUploadError = (error) => {
  ElMessage.error(`背景图上传失败：${error.response?.data?.message || '未知错误'}`)
  resetBannerUploadState()
}

const resetBannerUploadState = () => {
  bannerUploadProgress.value = 0
  isBannerUploading.value = false
  isBannerProcessing.value = false
  bannerFileName.value = ''
  bannerFileSize.value = 0
}

const removeBanner = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要删除这张背景图吗？',
      '确认删除',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
    form.value.banner = ''
    ElMessage.success('背景图已删除')
  } catch {
    // 用户取消删除
  }
}

const handleBannerDragEnter = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!isBannerUploading.value && !isBannerProcessing.value && !form.value.banner)
    isBannerDragOver.value = true
}

const handleBannerDragLeave = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!e.currentTarget.contains(e.relatedTarget))
    isBannerDragOver.value = false
}

const handleBannerDragOver = (e) => {
  e.preventDefault()
  e.stopPropagation()
}

const handleBannerDrop = (e) => {
  e.preventDefault()
  e.stopPropagation()
  isBannerDragOver.value = false

  if (isBannerUploading.value || isBannerProcessing.value || form.value.banner)
    return

  const files = e.dataTransfer.files
  if (files.length > 0)
    uploadBannerFile(files[0])
}

const formatFileSize = (bytes) => {
  if (bytes === 0)
    return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

const getImageUrl = (url) => {
  if (!url)
    return ''
  if (isOssPublicUrl(url))
    return url
  return url.startsWith('http') ? url : `${API_BASE_URL}${url.startsWith('/') ? url : `/${url}`}`
}

const fetchAllArtworks = async () => {
  try {
    const { data } = await axios.get('/original-artworks', { params: { artist_id: route.params.id, pageSize: 1000 } })
    allArtworks.value = data?.data || []
  } catch {
    allArtworks.value = []
  }
}

const fetchFeatured = async () => {
  try {
    const { data } = await axios.get(`/artists/${route.params.id}/featured-artworks`)
    featuredList.value = data?.data || []
  } catch {
    featuredList.value = []
  }
}

const isInFeatured = id => featuredList.value.some(i => i.id === id)
const addToFeatured = (item) => {
  if (!isInFeatured(item.id))
    featuredList.value.push(item)
}
const removeFromFeatured = (index) => {
  featuredList.value.splice(index, 1)
}
const moveUp = (index) => {
  if (index <= 0)
    return
  const tmp = featuredList.value[index - 1]
  featuredList.value[index - 1] = featuredList.value[index]
  featuredList.value[index] = tmp
}
const moveDown = (index) => {
  if (index >= featuredList.value.length - 1)
    return
  const tmp = featuredList.value[index + 1]
  featuredList.value[index + 1] = featuredList.value[index]
  featuredList.value[index] = tmp
}
const clearFeatured = () => {
  featuredList.value = []
}

const filteredAllArtworks = computed(() => {
  const raw = (artworkSearch.value || '').toString().trim().toLowerCase()
  if (!raw)
    return allArtworks.value
  return allArtworks.value.filter((a) => {
    const title = (a.title || '').toString().toLowerCase()
    const idStr = (a.id != null ? String(a.id) : '')
    const yearStr = (a.year != null ? String(a.year) : '')
    return title.includes(raw) || idStr.includes(raw) || yearStr.includes(raw)
  })
})

const saveFeatured = async () => {
  try {
    savingFeatured.value = true
    const ids = featuredList.value.map(i => i.id)
    await axios.put(`/artists/${route.params.id}/featured-artworks`, { artwork_ids: ids })
    ElMessage.success('已保存代表作品')
    await fetchFeatured()
  } catch (e) {
    ElMessage.error(e?.response?.data?.error || '保存失败')
  } finally {
    savingFeatured.value = false
  }
}

const goToFeaturedManager = async () => {
  showFeaturedManager.value = true
  await nextTick()
  const el = featuredManagerRef.value
  if (el?.scrollIntoView)
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const addAchievement = () => {
  form.value.achievements.push({
    title: '',
    description: '',
  })
}

const removeAchievement = (index) => {
  form.value.achievements.splice(index, 1)
}

const handleEdit = async () => {
  try {
    await axios.put(`/artists/${route.params.id}`, form.value)
    ElMessage.success('更新成功')
  } catch {
    ElMessage.error('更新失败')
  }
}

const goBack = () => {
  router.push('/artists')
}

onMounted(() => {
  fetchArtistDetail()
  fetchAllArtworks()
  fetchFeatured()
})
</script>
