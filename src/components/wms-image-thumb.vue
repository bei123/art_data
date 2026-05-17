<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { fetchWmsImageObjectUrl, revokeWmsImageObjectUrl } from '@/utils/wms-image-preview'
import { Skeleton } from '@/components/ui/skeleton'

const props = defineProps({
  artworkId: { type: [Number, String], required: true },
  index: { type: Number, default: 0 },
  alt: { type: String, default: '仓库图片' },
  imgClass: { type: String, default: 'size-full object-cover' },
})

const emit = defineEmits(['loaded', 'error'])

const objectUrl = ref('')
const isLoading = ref(true)
const hasError = ref(false)
let loadToken = 0

async function loadImage() {
  const token = ++loadToken
  revokeWmsImageObjectUrl(objectUrl.value)
  objectUrl.value = ''
  isLoading.value = true
  hasError.value = false

  try {
    const url = await fetchWmsImageObjectUrl(props.artworkId, props.index)
    if (token !== loadToken) {
      revokeWmsImageObjectUrl(url)
      return
    }
    objectUrl.value = url
    emit('loaded', url)
  } catch {
    if (token !== loadToken) return
    hasError.value = true
    emit('error')
  } finally {
    if (token === loadToken) isLoading.value = false
  }
}

onMounted(() => {
  loadImage()
})

watch(
  () => [props.artworkId, props.index],
  () => {
    loadImage()
  }
)

onBeforeUnmount(() => {
  loadToken += 1
  revokeWmsImageObjectUrl(objectUrl.value)
})

defineExpose({ reload: loadImage, objectUrl })
</script>

<template>
  <div class="relative size-full">
    <Skeleton v-if="isLoading" class="absolute inset-0 rounded-md" />
    <img
      v-else-if="objectUrl && !hasError"
      :src="objectUrl"
      :alt="alt"
      :class="imgClass"
      loading="lazy"
    >
    <div
      v-else
      class="flex size-full items-center justify-center bg-muted/50 text-[10px] text-muted-foreground"
    >
      无图
    </div>
  </div>
</template>
