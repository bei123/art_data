<script setup>
import { computed } from 'vue'
import WmsImageThumb from '@/components/wms-image-thumb.vue'

const props = defineProps({
  artworkId: { type: [Number, String], required: true },
  paths: { type: Array, default: () => [] },
  selectedIndex: { type: Number, default: 0 },
  previewSizeClass: { type: String, default: 'size-[220px]' },
  thumbSizeClass: { type: String, default: 'size-14' },
  /** 点击主图时触发预览（由父级打开大图对话框） */
  previewable: { type: Boolean, default: false },
  /** 缩略图过多时在固定高度内滚动，避免撑开布局挡住底部按钮 */
  thumbsScrollable: { type: Boolean, default: false },
})

defineOptions({
  inheritAttrs: false,
})

const emit = defineEmits(['update:selectedIndex', 'preview'])

const selected = computed({
  get: () => props.selectedIndex,
  set: (v) => emit('update:selectedIndex', v),
})

const safePaths = computed(() =>
  Array.isArray(props.paths) ? props.paths.filter((p) => p != null && String(p).trim()) : []
)

function wmsPathLabel(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  if (s.startsWith('http')) {
    try {
      return decodeURIComponent(new URL(s).pathname.split('/').pop() || s)
    } catch {
      return s
    }
  }
  return s.split('/').pop() || s
}

function handleMainPreview() {
  if (!props.previewable || !props.artworkId || !safePaths.value.length) return
  emit('preview', selected.value)
}

function handleThumbPreview(i) {
  if (!props.previewable || !props.artworkId) return
  selected.value = i
  emit('preview', i)
}
</script>

<template>
  <div class="flex flex-col gap-3" v-bind="$attrs">
    <button
      v-if="previewable && artworkId && safePaths.length"
      type="button"
      class="group relative shrink-0 overflow-hidden rounded-md border border-border bg-muted/20 transition hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :class="previewSizeClass"
      :aria-label="`预览仓库图 ${selected + 1}`"
      @click="handleMainPreview"
    >
      <WmsImageThumb
        :key="`wms-main-${artworkId}-${selected}`"
        :artwork-id="artworkId"
        :index="selected"
        :lazy="false"
        :alt="`仓库图 ${selected + 1}`"
        img-class="size-full object-cover"
      />
      <span
        class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 text-xs font-medium text-white opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100"
      >
        点击预览
      </span>
    </button>
    <div
      v-else
      class="shrink-0 overflow-hidden rounded-md border border-border bg-muted/20"
      :class="previewSizeClass"
    >
      <WmsImageThumb
        v-if="artworkId && safePaths.length"
        :key="`wms-main-${artworkId}-${selected}`"
        :artwork-id="artworkId"
        :index="selected"
        :lazy="false"
        :alt="`仓库图 ${selected + 1}`"
        img-class="size-full object-cover"
      />
    </div>

    <div
      v-if="safePaths.length > 1"
      :class="thumbsScrollable ? 'max-h-[min(140px,22vh)] overflow-y-auto overflow-x-hidden pr-1' : ''"
    >
      <div
        class="flex flex-wrap gap-2"
        role="listbox"
        aria-label="选择仓库图片"
      >
        <button
          v-for="(path, i) in safePaths"
          :key="`${artworkId}-${i}-${path}`"
          type="button"
          role="option"
          :aria-selected="selected === i"
          :aria-label="`仓库图 ${i + 1}`"
          class="overflow-hidden rounded-md border border-border transition-shadow focus-visible:ring-2 focus-visible:ring-ring"
          :class="[
            thumbSizeClass,
            selected === i ? 'ring-2 ring-primary ring-offset-1' : 'opacity-80 hover:opacity-100',
          ]"
          @click="selected = i"
          @dblclick.prevent="handleThumbPreview(i)"
        >
          <WmsImageThumb
            :artwork-id="artworkId"
            :index="i"
            :lazy="true"
            :alt="`缩略图 ${i + 1}`"
            img-class="size-full object-cover"
          />
        </button>
      </div>
    </div>

    <p v-if="safePaths[selected]" class="break-all text-xs text-muted-foreground">
      {{ wmsPathLabel(safePaths[selected]) }}
      <span v-if="safePaths.length > 1" class="text-foreground/70">
        （{{ selected + 1 }} / {{ safePaths.length }}）
      </span>
      <span v-if="previewable && safePaths.length > 1" class="text-foreground/70">
        · 双击缩略图可预览
      </span>
    </p>
  </div>
</template>
