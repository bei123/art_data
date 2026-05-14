<template>
  <div class="flex h-screen min-h-0 w-full bg-background text-foreground">
    <Sidebar />
    <div class="flex min-w-0 flex-1 flex-col">
      <header
        class="flex shrink-0 items-center border-b border-border bg-card px-4 py-3 shadow-sm"
      >
        <h1 class="text-lg font-semibold tracking-tight text-foreground">
          艺术数据管理系统
        </h1>
      </header>
      <main class="min-h-0 flex-1 overflow-auto">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup>
import Sidebar from '../layout/components/Sidebar.vue'
</script>
