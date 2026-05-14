<template>
  <div class="relative flex min-h-[240px] flex-col gap-6 p-4 md:p-6">
    <div
      v-if="statsLoading"
      class="absolute inset-0 z-10 flex items-center justify-center bg-background/70 backdrop-blur-[1px]"
      aria-busy="true"
      aria-label="加载中"
    >
      <Loader2 class="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
    </div>

    <Alert v-if="statsError && !statsLoading" variant="destructive">
      <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
      <AlertTitle>{{ statsError }}</AlertTitle>
      <AlertDescription class="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" @click="retryFetchStats">
          重试
        </Button>
      </AlertDescription>
    </Alert>

    <h3 class="text-lg font-semibold tracking-tight text-foreground">
      数据概览
    </h3>

    <div class="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-5">
      <Card v-for="stat in statCards" :key="stat.key" class="shadow-none ring-1 transition hover:shadow-md">
        <CardHeader class="flex flex-row items-center justify-between gap-2 border-b border-border pb-3">
          <CardTitle class="text-sm font-medium">{{ stat.title }}</CardTitle>
          <Button type="button" variant="link" class="h-auto shrink-0 px-0 text-primary" @click="router.push(stat.to)">
            查看全部
          </Button>
        </CardHeader>
        <CardContent class="flex flex-col items-center gap-2 py-8">
          <div class="text-4xl font-bold tabular-nums text-primary">
            {{ stat.value }}
          </div>
          <div class="text-sm text-muted-foreground">
            {{ stat.suffix }}
          </div>
        </CardContent>
      </Card>
    </div>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
      <Card class="shadow-none ring-1">
        <CardHeader class="border-b border-border pb-3">
          <CardTitle class="text-sm font-medium">最近添加的原作艺术品</CardTitle>
        </CardHeader>
        <CardContent class="p-0">
          <div class="overflow-x-auto">
            <table class="w-full min-w-[320px] text-sm">
              <thead>
                <tr class="border-b border-border bg-muted/40">
                  <th class="h-10 px-3 text-left font-medium text-foreground">
                    标题
                  </th>
                  <th class="h-10 px-3 text-left font-medium text-foreground md:min-w-[10rem]">
                    艺术家
                  </th>
                  <th class="h-10 px-3 text-left font-medium text-foreground">
                    添加时间
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in recentOriginalArtworks"
                  :key="row.id ?? row.title"
                  class="border-b border-border transition-colors last:border-b-0 hover:bg-muted/30"
                >
                  <td class="max-w-[12rem] truncate px-3 py-2.5" :title="row.title">
                    {{ row.title }}
                  </td>
                  <td class="px-3 py-2.5">
                    <div class="flex min-w-0 items-center gap-2">
                      <Avatar class="size-7 shrink-0">
                        <AvatarImage
                          :src="getImageUrl(row.artist?.avatar)"
                          :alt="row.artist?.name ? `${row.artist.name} 头像` : ''"
                        />
                        <AvatarFallback>{{ (row.artist?.name || '?').charAt(0) }}</AvatarFallback>
                      </Avatar>
                      <span class="truncate">{{ row.artist?.name || '未知艺术家' }}</span>
                    </div>
                  </td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                    {{ formatDate(row.created_at) }}
                  </td>
                </tr>
                <tr v-if="recentOriginalArtworks.length === 0 && !statsLoading">
                  <td colspan="3" class="px-3 py-10 text-center text-muted-foreground">
                    暂无最近添加的原作
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card class="shadow-none ring-1">
        <CardHeader class="border-b border-border pb-3">
          <CardTitle class="text-sm font-medium">最近添加的数字艺术品</CardTitle>
        </CardHeader>
        <CardContent class="p-0">
          <div class="overflow-x-auto">
            <table class="w-full min-w-[320px] text-sm">
              <thead>
                <tr class="border-b border-border bg-muted/40">
                  <th class="h-10 px-3 text-left font-medium text-foreground">
                    标题
                  </th>
                  <th class="h-10 px-3 text-left font-medium text-foreground md:min-w-[10rem]">
                    艺术家
                  </th>
                  <th class="h-10 px-3 text-left font-medium text-foreground">
                    添加时间
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in recentDigitalArtworks"
                  :key="row.id ?? row.title"
                  class="border-b border-border transition-colors last:border-b-0 hover:bg-muted/30"
                >
                  <td class="max-w-[12rem] truncate px-3 py-2.5" :title="row.title">
                    {{ row.title }}
                  </td>
                  <td class="px-3 py-2.5">
                    <div class="flex min-w-0 items-center gap-2">
                      <Avatar class="size-7 shrink-0">
                        <AvatarImage
                          :src="getImageUrl(row.artist?.avatar)"
                          :alt="row.artist?.name ? `${row.artist.name} 头像` : ''"
                        />
                        <AvatarFallback>{{ (row.artist?.name || '?').charAt(0) }}</AvatarFallback>
                      </Avatar>
                      <span class="truncate">{{ row.artist?.name || '未知艺术家' }}</span>
                    </div>
                  </td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                    {{ formatDate(row.created_at) }}
                  </td>
                </tr>
                <tr v-if="recentDigitalArtworks.length === 0 && !statsLoading">
                  <td colspan="3" class="px-3 py-10 text-center text-muted-foreground">
                    暂无最近添加的数字艺术品
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { AlertCircle, Loader2 } from 'lucide-vue-next'
import axios from '../utils/axios'
import { API_BASE_URL, isOssPublicUrl } from '../config'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const router = useRouter()

const stats = ref({
  originalArtworks: 0,
  digitalArtworks: 0,
  physicalCategories: 0,
})

const recentOriginalArtworks = ref([])
const recentDigitalArtworks = ref([])
const statsLoading = ref(false)
const statsError = ref('')

const statCards = computed(() => [
  {
    key: 'original',
    title: '原作艺术品',
    value: stats.value.originalArtworks,
    suffix: '件作品',
    to: '/original-artworks',
  },
  {
    key: 'digital',
    title: '数字艺术品',
    value: stats.value.digitalArtworks,
    suffix: '件作品',
    to: '/digital-artworks',
  },
  {
    key: 'physical',
    title: '实物分类',
    value: stats.value.physicalCategories,
    suffix: '个分类',
    to: '/physical-categories',
  },
])

const getImageUrl = (url) => {
  if (!url) return ''
  if (isOssPublicUrl(url)) return url
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`
}

const formatDate = (dateString) => {
  if (!dateString) return ''
  const date = new Date(dateString)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const retryFetchStats = () => {
  statsError.value = ''
  fetchStats()
}

const fetchStats = async () => {
  statsLoading.value = true
  statsError.value = ''
  try {
    const originalRes = await axios.get('/original-artworks?pageSize=1000')
    const digitalRes = await axios.get('/digital-artworks?pageSize=1000')
    const categoriesRes = await axios.get('/physical-categories?limit=1000')

    let originalArtworks = []
    if (originalRes && originalRes.data && Array.isArray(originalRes.data)) {
      originalArtworks = originalRes.data
    } else if (Array.isArray(originalRes)) {
      originalArtworks = originalRes
    }

    let digitalArtworks = []
    if (Array.isArray(digitalRes)) {
      digitalArtworks = digitalRes
    }

    let categories = []
    if (categoriesRes && categoriesRes.data && Array.isArray(categoriesRes.data)) {
      categories = categoriesRes.data
    } else if (Array.isArray(categoriesRes)) {
      categories = categoriesRes
    }

    stats.value = {
      originalArtworks: originalArtworks.length,
      digitalArtworks: digitalArtworks.length,
      physicalCategories: categories.length,
    }

    recentOriginalArtworks.value = originalArtworks
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5)

    recentDigitalArtworks.value = digitalArtworks
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5)
  } catch {
    stats.value = {
      originalArtworks: 0,
      digitalArtworks: 0,
      physicalCategories: 0,
    }
    recentOriginalArtworks.value = []
    recentDigitalArtworks.value = []
    statsError.value = '概览数据加载失败，请检查网络或稍后重试'
  } finally {
    statsLoading.value = false
  }
}

onMounted(() => {
  fetchStats()
})
</script>
