<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { injectDialogRootContext } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
const rootContext = injectDialogRootContext()
</script>

<template>
  <!-- 不用 reka DialogOverlay：其内联 pointer-events:auto 会盖住内容层 -->
  <div
    v-if="rootContext.open.value"
    data-slot="dialog-overlay"
    :class="cn('data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs pointer-events-none fixed inset-0 z-50', props.class)"
    aria-hidden="true"
  />
</template>
