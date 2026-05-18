<script setup>
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Loader2 } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()

onMounted(() => {
  const id = route.params.id
  if (!id) {
    router.replace({ name: 'Merchants' })
    return
  }
  router.replace({ name: 'Merchants', query: { edit: String(id) } })
})
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
    <Loader2 class="size-8 animate-spin" aria-hidden="true" />
    <p class="text-sm">正在打开编辑…</p>
  </div>
</template>
