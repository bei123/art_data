<template>
  <nav
    class="flex h-full w-52 shrink-0 flex-col gap-0.5 border-r border-sidebar-border bg-sidebar p-2 text-sidebar-foreground"
    aria-label="主导航"
  >
    <RouterLink
      v-for="item in visibleNavItems"
      :key="item.path"
      :to="item.path"
      :class="navLinkClass(item.path)"
    >
      <component :is="item.icon" class="size-4 shrink-0 opacity-80" aria-hidden="true" />
      <span class="truncate">{{ item.label }}</span>
    </RouterLink>
  </nav>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import {
  Building2,
  FileText,
  FolderTree,
  Image,
  Images,
  LayoutDashboard,
  Store,
  User,
  Wallet,
} from 'lucide-vue-next'
import { useUserStore } from '@/stores/user'
import { userMatchesRole } from '@/utils/roles'
import { cn } from '@/lib/utils'

const route = useRoute()
const userStore = useUserStore()

const navItems = [
  { path: '/', label: '仪表盘', icon: LayoutDashboard },
  { path: '/original-artworks', label: '原作管理', icon: Image },
  { path: '/artists', label: '艺术家管理', icon: User },
  { path: '/institutions', label: '机构管理', icon: Building2 },
  { path: '/digital-artworks', label: '数字艺术品', icon: Images },
  { path: '/physical-categories', label: '实物分类', icon: FolderTree },
  { path: '/rights', label: '权益管理', icon: FileText },
  { path: '/exhibitions', label: '展览管理', icon: FileText, role: 'admin' },
  { path: '/banners', label: '轮播图管理', icon: Image },
  { path: '/merchants', label: '商家管理', icon: Store },
  { path: '/refund-approval', label: '退款审批', icon: Wallet, role: 'admin' },
  { path: '/orders', label: '订单管理', icon: FileText },
]

const visibleNavItems = computed(() =>
  navItems.filter((item) => !item.role || hasRole(item.role)),
)

function hasRole(role) {
  return userMatchesRole(userStore.userInfo, role)
}

function isNavActive(path) {
  const p = route.path
  if (path === '/') return p === '/' || p === ''
  return p === path || p.startsWith(`${path}/`)
}

function navLinkClass(path) {
  return cn(
    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors outline-none',
    'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
    'focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar',
    isNavActive(path)
      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
      : 'text-sidebar-foreground/90',
  )
}
</script>
