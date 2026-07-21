<template>
  <nav
    class="flex h-full w-52 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-2 text-sidebar-foreground"
    aria-label="主导航"
  >
    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <div
        v-for="group in visibleNavGroups"
        :key="group.id"
        class="flex flex-col gap-0.5"
      >
        <button
          v-if="group.collapsible"
          type="button"
          class="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[11px] font-medium tracking-wide text-sidebar-foreground/55 outline-none transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
          :aria-expanded="isGroupExpanded(group.id)"
          :aria-controls="`nav-group-${group.id}`"
          @click="toggleGroup(group.id)"
        >
          <span class="truncate uppercase">{{ group.label }}</span>
          <ChevronDown
            class="size-3.5 shrink-0 opacity-70 transition-transform"
            :class="{ '-rotate-90': !isGroupExpanded(group.id) }"
            aria-hidden="true"
          />
        </button>
        <p
          v-else
          class="px-2.5 py-1 text-[11px] font-medium tracking-wide text-sidebar-foreground/55 uppercase"
        >
          {{ group.label }}
        </p>

        <div
          v-show="!group.collapsible || isGroupExpanded(group.id)"
          :id="`nav-group-${group.id}`"
          class="flex flex-col gap-0.5"
        >
          <RouterLink
            v-for="item in group.items"
            :key="item.path"
            :to="item.path"
            :class="navLinkClass(item.path)"
          >
            <component :is="item.icon" class="size-4 shrink-0 opacity-80" aria-hidden="true" />
            <span class="truncate">{{ item.label }}</span>
          </RouterLink>
        </div>
      </div>
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
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ChevronDown, Loader2, LogOut } from 'lucide-vue-next'
import { showPageSuccess } from '@/utils/appMessage'
import { Button } from '@/components/ui/button'
import { useUserStore } from '@/stores/user'
import { userMatchesRole } from '@/utils/roles'
import { logoutCurrentUser } from '@/utils/sessionLogout'
import { cn } from '@/lib/utils'
import { ADMIN_NAV_GROUPS, REFERRAL_NAV_STORAGE_KEY } from '@/config/admin-nav'

const route = useRoute()
const userStore = useUserStore()
const isLoggingOut = ref(false)

const displayName = computed(() => {
  const u = userStore.userInfo
  if (!u || typeof u !== 'object') return ''
  return String(u.username || u.name || u.nickname || u.email || '').trim()
})

function hasRole(role) {
  return userMatchesRole(userStore.userInfo, role)
}

function filterItems(items) {
  return (items || []).filter((item) => !item.role || hasRole(item.role))
}

const visibleNavGroups = computed(() =>
  ADMIN_NAV_GROUPS
    .filter((group) => !group.role || hasRole(group.role))
    .map((group) => ({
      ...group,
      items: filterItems(group.items),
    }))
    .filter((group) => group.items.length > 0)
)

function isNavActive(path) {
  const p = route.path
  if (path === '/') return p === '/' || p === ''
  return p === path || p.startsWith(`${path}/`)
}

function groupContainsActiveRoute(group) {
  return (group.items || []).some((item) => isNavActive(item.path))
}

function readStoredReferralExpanded() {
  try {
    const raw = localStorage.getItem(REFERRAL_NAV_STORAGE_KEY)
    if (raw === '1') return true
    if (raw === '0') return false
  } catch {
    // ignore
  }
  return null
}

function writeStoredReferralExpanded(expanded) {
  try {
    localStorage.setItem(REFERRAL_NAV_STORAGE_KEY, expanded ? '1' : '0')
  } catch {
    // ignore
  }
}

const referralExpanded = ref(readStoredReferralExpanded() ?? false)

const referralGroup = computed(() =>
  visibleNavGroups.value.find((group) => group.id === 'referral') || null
)

watch(
  () => [route.path, referralGroup.value],
  () => {
    const group = referralGroup.value
    if (group && groupContainsActiveRoute(group))
      referralExpanded.value = true
  },
  { immediate: true }
)

function isGroupExpanded(groupId) {
  if (groupId !== 'referral') return true
  return referralExpanded.value
}

function toggleGroup(groupId) {
  if (groupId !== 'referral') return
  referralExpanded.value = !referralExpanded.value
  writeStoredReferralExpanded(referralExpanded.value)
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
    showPageSuccess('已退出登录')
    await logoutCurrentUser()
  } finally {
    isLoggingOut.value = false
  }
}
</script>
