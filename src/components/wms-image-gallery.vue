<script setup>
import { computed } from 'vue'
import WmsImageThumb from '@/components/wms-image-thumb.vue'

const props = defineProps({
  artworkId: { type: [Number, String], required: true },
  paths: { type: Array, default: () => [] },
  selectedIndex: { type: Number, default: 0 },
  previewSizeClass: { type: String, default: 'size-[220px]' },
  thumbSizeClass: { type: String, default: 'size-14' },
})

const emit = defineEmits(['update:selectedIndex'])

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
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      class="shrink-0 overflow-hidden rounded-md border border-border bg-muted/20"
      :class="previewSizeClass"
    >
      <WmsImageThumb
        v-if="artworkId && safePaths.length"
        :artwork-id="artworkId"
        :index="selected"
        :lazy="false"
        :alt="`仓库图 ${selected + 1}`"
        img-class="size-full object-cover"
      />
    </div>

    <div
      v-if="safePaths.length > 1"
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

    <p v-if="safePaths[selected]" class="break-all text-xs text-muted-foreground">
      {{ wmsPathLabel(safePaths[selected]) }}
      <span v-if="safePaths.length > 1" class="text-foreground/70">
        （{{ selected + 1 }} / {{ safePaths.length }}）
      </span>
    </p>
  </div>
</template>
