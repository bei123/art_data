<script setup>
import { computed, ref, watch } from 'vue'
import { watchDebounced } from '@vueuse/core'
import axios from '@/utils/axios'
import { API_BASE_URL, isOssPublicUrl } from '@/config'
import { ElMessage } from 'element-plus'
import { Check, ChevronLeft, ChevronRight, Loader2, Search, X } from 'lucide-vue-next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const props = defineProps({
  open: { type: Boolean, default: false },
  exhibitionId: { type: Number, default: null },
  existingItems: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:open', 'success'])

const PICKER_PAGE_SIZE = 24

const itemsPickerTab = ref('original')
const artworkPickerQuery = ref('')
const loadingArtworkOptions = ref(false)
const savingItems = ref(false)
const pickerArtworks = ref([])
const pendingItems = ref([])

const pickerPagination = ref({
  page: 1,
  pageSize: PICKER_PAGE_SIZE,
  total: 0,
  totalPages: 0,
  hasNext: false,
  hasPrev: false,
})

const searchType = computed(() => (
  itemsPickerTab.value === 'original' ? 'original_artwork' : 'digital_artwork'
))

const totalPages = computed(() => Math.max(1, pickerPagination.value.totalPages || 1))

function getImageUrl(url) {
  if (!url) return ''
  if (isOssPublicUrl(url)) return url
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`
}

function mapSearchResultItem(item) {
  const type = itemsPickerTab.value
  let image = item?.image || ''
  if (image && !image.startsWith('http')) image = `${API_BASE_URL}${image}`
  return {
    id: item.id,
    title: item.title,
    image,
    artist_name: item.artist_name || '',
    artwork_type: type,
  }
}

function applyPickerPagination(pagination) {
  if (!pagination) {
    pickerPagination.value.total = 0
    pickerPagination.value.totalPages = 0
    pickerPagination.value.hasNext = false
    pickerPagination.value.hasPrev = false
    return
  }
  pickerPagination.value.page = pagination.current_page || 1
  pickerPagination.value.pageSize = pagination.page_size || PICKER_PAGE_SIZE
  pickerPagination.value.total = pagination.total_count || 0
  pickerPagination.value.totalPages = pagination.total_pages || 0
  pickerPagination.value.hasNext = Boolean(pagination.has_next)
  pickerPagination.value.hasPrev = Boolean(pagination.has_prev)
}

async function fetchPickerArtworks() {
  const keyword = artworkPickerQuery.value.trim()
  if (!keyword) {
    pickerArtworks.value = []
    applyPickerPagination(null)
    return
  }

  loadingArtworkOptions.value = true
  try {
    const res = await axios.get('/search', {
      params: {
        keyword,
        type: searchType.value,
        page: pickerPagination.value.page,
        limit: pickerPagination.value.pageSize,
      },
    })
    const list = Array.isArray(res?.data) ? res.data : []
    pickerArtworks.value = list.map(mapSearchResultItem)
    applyPickerPagination(res?.pagination)
  } catch (e) {
    pickerArtworks.value = []
    applyPickerPagination(null)
    ElMessage.error(e?.error || e?.response?.data?.error || e?.message || '搜索失败')
  } finally {
    loadingArtworkOptions.value = false
  }
}

function resetDialogState() {
  pendingItems.value = []
  itemsPickerTab.value = 'original'
  artworkPickerQuery.value = ''
  pickerArtworks.value = []
  pickerPagination.value.page = 1
  applyPickerPagination(null)
}

function isArtworkInExhibition(type, artworkId) {
  const sid = String(artworkId)
  return (props.existingItems || []).some(
    (it) => it.artwork_type === type && String(it.artwork?.id) === sid,
  )
}

function isArtworkInPending(type, artworkId) {
  const sid = String(artworkId)
  return pendingItems.value.some(
    (p) => p.artwork_type === type && String(p.artwork_id) === sid,
  )
}

function getArtworkThumb(artwork) {
  return artwork?.image ? getImageUrl(artwork.image) : ''
}

function getPickerCardClass(artwork) {
  const type = artwork.artwork_type || itemsPickerTab.value
  if (isArtworkInExhibition(type, artwork.id)) {
    return 'cursor-not-allowed border-border opacity-50'
  }
  if (isArtworkInPending(type, artwork.id)) {
    return 'border-primary ring-1 ring-primary'
  }
  return 'border-border hover:border-primary/50 hover:bg-muted/30'
}

function togglePickArtwork(artwork) {
  const type = artwork.artwork_type || itemsPickerTab.value
  if (isArtworkInExhibition(type, artwork.id)) return
  const sid = String(artwork.id)
  const idx = pendingItems.value.findIndex(
    (p) => p.artwork_type === type && String(p.artwork_id) === sid,
  )
  if (idx >= 0) {
    pendingItems.value.splice(idx, 1)
    return
  }
  pendingItems.value.push({
    artwork_type: type,
    artwork_id: artwork.id,
    title: artwork.title,
    artist_name: artwork.artist_name,
    image: artwork.image,
  })
}

function getPendingArtworkTitle(row) {
  return row?.title || String(row?.artwork_id || '-')
}

function getPendingArtworkArtist(row) {
  return row?.artist_name || ''
}

function getPendingArtworkThumb(row) {
  return row?.image ? getImageUrl(row.image) : ''
}

function removePendingItem(index) {
  pendingItems.value.splice(index, 1)
}

function handleOpenChange(value) {
  emit('update:open', value)
  if (!value) resetDialogState()
}

function handlePickerPageChange(nextPage) {
  if (nextPage < 1 || nextPage > totalPages.value) return
  if (nextPage === pickerPagination.value.page) return
  pickerPagination.value.page = nextPage
  fetchPickerArtworks()
}

function handlePickerTabChange() {
  pickerPagination.value.page = 1
  if (artworkPickerQuery.value.trim()) fetchPickerArtworks()
  else pickerArtworks.value = []
}

async function submitItems() {
  if (!props.exhibitionId || !pendingItems.value.length) return
  const existingLen = props.existingItems?.length || 0
  const items = pendingItems.value.map((row, idx) => ({
    artwork_type: row.artwork_type,
    artwork_id: row.artwork_id,
    sort_order: existingLen + idx + 1,
  }))

  savingItems.value = true
  try {
    await axios.post(`/exhibitions/${props.exhibitionId}/items`, { items })
    ElMessage.success(`已追加 ${items.length} 件作品`)
    emit('update:open', false)
    emit('success')
    resetDialogState()
  } catch (e) {
    ElMessage.error(e?.response?.data?.error || e?.error || '追加失败')
  } finally {
    savingItems.value = false
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) resetDialogState()
  },
)

watch(
  () => itemsPickerTab.value,
  () => {
    handlePickerTabChange()
  },
)

watchDebounced(
  artworkPickerQuery,
  () => {
    pickerPagination.value.page = 1
    fetchPickerArtworks()
  },
  { debounce: 350 },
)
</script>

<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent class="flex max-h-[92vh] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
      <DialogHeader class="shrink-0 border-b border-border px-6 py-4">
        <DialogTitle>追加展览作品</DialogTitle>
        <DialogDescription>
          搜索并点击作品加入待选列表；已在本展览中的作品不可重复添加
        </DialogDescription>
      </DialogHeader>

      <div class="grid min-h-0 flex-1 gap-0 lg:grid-cols-[1fr_17rem]">
        <div class="flex min-h-0 flex-col border-border lg:border-r">
          <div class="shrink-0 space-y-3 border-b border-border px-4 py-3">
            <Tabs v-model="itemsPickerTab" class="w-full">
              <TabsList class="grid w-full max-w-xs grid-cols-2">
                <TabsTrigger value="original">
                  原作
                </TabsTrigger>
                <TabsTrigger value="digital">
                  数字作品
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div class="relative">
              <Search
                class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                v-model="artworkPickerQuery"
                placeholder="搜索作品名称、艺术家"
                class="pl-9"
                autocomplete="off"
              />
            </div>
          </div>

          <ScrollArea class="min-h-[280px] flex-1 lg:max-h-[min(48vh,480px)]">
            <div class="p-4">
              <div
                v-if="!artworkPickerQuery.trim()"
                class="py-16 text-center text-sm text-muted-foreground"
              >
                请输入关键词搜索作品
              </div>
              <div
                v-else-if="loadingArtworkOptions"
                class="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground"
              >
                <Loader2 class="size-8 animate-spin" aria-hidden="true" />
                <span class="text-sm">搜索中…</span>
              </div>
              <div
                v-else-if="!pickerArtworks.length"
                class="py-16 text-center text-sm text-muted-foreground"
              >
                未找到匹配的作品
              </div>
              <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <button
                  v-for="artwork in pickerArtworks"
                  :key="`${artwork.artwork_type}-${artwork.id}`"
                  type="button"
                  class="group relative flex flex-col overflow-hidden rounded-lg border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :class="getPickerCardClass(artwork)"
                  :disabled="isArtworkInExhibition(artwork.artwork_type, artwork.id)"
                  :aria-pressed="isArtworkInPending(artwork.artwork_type, artwork.id)"
                  @click="togglePickArtwork(artwork)"
                >
                  <div class="relative aspect-square w-full bg-muted/40">
                    <img
                      v-if="getArtworkThumb(artwork)"
                      :src="getArtworkThumb(artwork)"
                      :alt="artwork.title || '作品'"
                      class="size-full object-cover"
                      loading="lazy"
                      draggable="false"
                    >
                    <div
                      v-else
                      class="flex size-full items-center justify-center text-xs text-muted-foreground"
                    >
                      无图
                    </div>
                    <div
                      v-if="isArtworkInPending(artwork.artwork_type, artwork.id)"
                      class="absolute inset-0 flex items-center justify-center bg-primary/20"
                    >
                      <span class="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                        <Check class="size-4" aria-hidden="true" />
                      </span>
                    </div>
                    <Badge
                      v-if="isArtworkInExhibition(artwork.artwork_type, artwork.id)"
                      variant="secondary"
                      class="absolute left-1.5 top-1.5 text-[10px]"
                    >
                      已在展览
                    </Badge>
                  </div>
                  <div class="space-y-0.5 p-2">
                    <p class="line-clamp-2 text-xs font-medium leading-snug">
                      {{ artwork.title || '未命名' }}
                    </p>
                    <p v-if="artwork.artist_name" class="truncate text-[11px] text-muted-foreground">
                      {{ artwork.artist_name }}
                    </p>
                  </div>
                </button>
              </div>
            </div>
          </ScrollArea>

          <div
            v-if="artworkPickerQuery.trim() && pickerPagination.total > 0"
            class="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-2"
          >
            <span class="text-xs text-muted-foreground tabular-nums">
              共 {{ pickerPagination.total }} 件
            </span>
            <div class="flex items-center gap-1">
              <Button
                type="button"
                size="icon"
                variant="outline"
                class="size-7"
                :disabled="!pickerPagination.hasPrev || loadingArtworkOptions"
                aria-label="上一页"
                @click="handlePickerPageChange(pickerPagination.page - 1)"
              >
                <ChevronLeft class="size-4" aria-hidden="true" />
              </Button>
              <span class="min-w-[4.5rem] text-center text-xs tabular-nums text-muted-foreground">
                {{ pickerPagination.page }} / {{ totalPages }}
              </span>
              <Button
                type="button"
                size="icon"
                variant="outline"
                class="size-7"
                :disabled="!pickerPagination.hasNext || loadingArtworkOptions"
                aria-label="下一页"
                @click="handlePickerPageChange(pickerPagination.page + 1)"
              >
                <ChevronRight class="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>

        <div class="flex min-h-0 flex-col bg-muted/20">
          <div class="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
            <span class="text-sm font-medium">已选作品</span>
            <Badge variant="secondary" class="tabular-nums">
              {{ pendingItems.length }}
            </Badge>
          </div>
          <ScrollArea class="min-h-[200px] flex-1 lg:max-h-[min(52vh,520px)]">
            <div class="space-y-2 p-3">
              <div
                v-if="pendingItems.length === 0"
                class="rounded-lg border border-dashed border-border bg-background/60 px-3 py-10 text-center text-xs text-muted-foreground"
              >
                搜索后点击作品加入
              </div>
              <div
                v-for="(row, idx) in pendingItems"
                :key="`${row.artwork_type}-${row.artwork_id}`"
                class="flex gap-2 rounded-lg border border-border bg-background p-2 shadow-sm"
              >
                <div class="size-12 shrink-0 overflow-hidden rounded-md bg-muted/40">
                  <img
                    v-if="getPendingArtworkThumb(row)"
                    :src="getPendingArtworkThumb(row)"
                    :alt="getPendingArtworkTitle(row)"
                    class="size-full object-cover"
                    loading="lazy"
                  >
                  <div
                    v-else
                    class="flex size-full items-center justify-center text-[10px] text-muted-foreground"
                  >
                    无图
                  </div>
                </div>
                <div class="min-w-0 flex-1">
                  <p class="line-clamp-2 text-xs font-medium leading-snug">
                    {{ getPendingArtworkTitle(row) }}
                  </p>
                  <p class="mt-0.5 text-[10px] text-muted-foreground">
                    {{ row.artwork_type === 'digital' ? '数字' : '原作' }}
                    <span v-if="getPendingArtworkArtist(row)"> · {{ getPendingArtworkArtist(row) }}</span>
                  </p>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  class="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                  :aria-label="`移除 ${getPendingArtworkTitle(row)}`"
                  @click="removePendingItem(idx)"
                >
                  <X class="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>

      <DialogFooter class="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-end">
        <Button type="button" variant="outline" @click="handleOpenChange(false)">
          取消
        </Button>
        <Button
          type="button"
          :disabled="pendingItems.length === 0 || savingItems"
          @click="submitItems"
        >
          <Loader2 v-if="savingItems" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
          确认追加{{ pendingItems.length ? `（${pendingItems.length}）` : '' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
