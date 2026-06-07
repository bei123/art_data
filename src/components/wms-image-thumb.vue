<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { fetchWmsImageObjectUrl } from '@/utils/wms-image-preview'
import { Skeleton } from '@/components/ui/skeleton'

const props = defineProps({
  artworkId: { type: [Number, String], required: true },
  index: { type: Number, default: 0 },
  alt: { type: String, default: '仓库图片' },
  imgClass: { type: String, default: 'size-full object-cover' },
  /** 进入视口后再加载，减轻列表首屏压力 */
  lazy: { type: Boolean, default: true },
})

const emit = defineEmits(['loaded', 'error'])

const rootRef = ref(null)
const displayUrl = ref('')
const isLoading = ref(true)
const hasError = ref(false)

/** 切换 index 时用于强制 img 重新挂载 */
const imgMountKey = computed(() => `${props.artworkId}:${props.index}`)

let loadToken = 0
let abortController = null
let observer = null

function abortInflight() {
  if (abortController) {
    abortController.abort()
    abortController = null
  }
}

function clearDisplay() {
  displayUrl.value = ''
}

function finishLoaded(url) {
  displayUrl.value = url
  isLoading.value = false
  hasError.value = false
  emit('loaded', url)
}

async function loadImage() {
  const token = ++loadToken
  abortInflight()
  clearDisplay()
  isLoading.value = true
  hasError.value = false
  abortController = new AbortController()

  try {
    const url = await fetchWmsImageObjectUrl(props.artworkId, props.index, {
      signal: abortController.signal,
    })
    if (token !== loadToken) return
    finishLoaded(url)
  } catch (e) {
    if (token !== loadToken) return
    if (e?.name === 'AbortError') return
    hasError.value = true
    isLoading.value = false
    emit('error')
  } finally {
    if (token === loadToken) abortController = null
  }
}

function disconnectObserver() {
  if (observer) {
    observer.disconnect()
    observer = null
  }
}

function connectObserver() {
  disconnectObserver()
  const el = rootRef.value
  if (!el) {
    loadImage()
    return
  }
  if (!props.lazy || typeof IntersectionObserver === 'undefined') {
    loadImage()
    return
  }
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries[0]?.isIntersecting) return
      disconnectObserver()
      loadImage()
    },
    { root: null, rootMargin: '120px', threshold: 0.01 }
  )
  observer.observe(el)
}

function scheduleLoad() {
  if (!props.artworkId) return
  disconnectObserver()
  isLoading.value = true
  hasError.value = false
  connectObserver()
}

onMounted(() => {
  scheduleLoad()
})

watch(
  () => [props.artworkId, props.index, props.lazy],
  () => {
    scheduleLoad()
  }
)

onBeforeUnmount(() => {
  loadToken += 1
  abortInflight()
  disconnectObserver()
  clearDisplay()
})

defineExpose({ reload: scheduleLoad, displayUrl })
</script>

<template>
  <div ref="rootRef" class="relative block size-full">
    <Skeleton v-if="isLoading" class="absolute inset-0 rounded-md" />
    <img
      v-else-if="displayUrl && !hasError"
      :key="imgMountKey"
      :src="displayUrl"
      :alt="alt"
      :class="imgClass"
      decoding="async"
      loading="eager"
    >
    <div
      v-else
      class="flex size-full items-center justify-center bg-muted/50 text-[10px] text-muted-foreground"
    >
      无图
    </div>
  </div>
</template>
