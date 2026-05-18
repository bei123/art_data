<template>
  <nav
    class="flex h-full w-52 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-2 text-sidebar-foreground"
    aria-label="主导航"
  >
    <div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
      <RouterLink
        v-for="item in visibleNavItems"
        :key="item.path"
        :to="item.path"
        :class="navLinkClass(item.path)"
      >
        <component :is="item.icon" class="size-4 shrink-0 opacity-80" aria-hidden="true" />
        <span class="truncate">{{ item.label }}</span>
      </RouterLink>
    </div>

    <div class="mt-2 shrink-0 border-t border-sidebar-border pt-2">
      <p
        v-if="displayName"
        class="mb-2 truncate px-2.5 text-xs text-sidebar-foreground/70"
        :title="displayName"
      >
        {{ displayName }}
      </p>
      <Button
        type="button"
        variant="outline"
        class="w-full justify-start gap-2 border-sidebar-border bg-sidebar text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        :disabled="isLoggingOut"
        aria-label="退出登录"
        @click="handleLogout"
      >
        <Loader2 v-if="isLoggingOut" class="size-4 shrink-0 animate-spin" aria-hidden="true" />
        <LogOut v-else class="size-4 shrink-0" aria-hidden="true" />
        {{ isLoggingOut ? '退出中…' : '退出登录' }}
      </Button>
    </div>
  </nav>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Building2,
  FileText,
  FolderTree,
  Image,
  Images,
  LayoutDashboard,
  Loader2,
  LogOut,
  Store,
  User,
  Wallet,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { useUserStore } from '@/stores/user'
import { userMatchesRole } from '@/utils/roles'
import { logoutCurrentUser } from '@/utils/sessionLogout'
import { cn } from '@/lib/utils'

const route = useRoute()
const userStore = useUserStore()
const isLoggingOut = ref(false)

const displayName = computed(() => {
  const u = userStore.userInfo
  if (!u || typeof u !== 'object') return ''
  return String(u.username || u.name || u.nickname || u.email || '').trim()
})

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

async function handleLogout() {
  if (isLoggingOut.value) return
  isLoggingOut.value = true
  try {
    await logoutCurrentUser()
    ElMessage.success('已退出登录')
  } finally {
    isLoggingOut.value = false
  }
}
</script>
