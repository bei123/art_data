import { createRouter, createWebHistory } from 'vue-router'
import { ElMessage } from 'element-plus'
import Login from '../views/Login.vue'
import { useUserStore } from '@/stores/user'
import { userHasAnyRole } from '@/utils/roles'

/**
 * 子路由 path 使用相对片段（如 orders、refund-approval），不要写成 /orders，避免与 Vue Router「绝对子路径」语义混淆。
 * 上述子路由挂在 path: '/' 的 DefaultLayout 下，主内容区由 DefaultLayout 内 <router-view> 渲染。
 * meta.roles 在 beforeEach 中校验；侧栏菜单仍用完整 index（如 /orders）与最终 URL 一致。
 */
const routes = [
  {
    path: '/',
    component: () => import('@/layouts/DefaultLayout.vue'),
    children: [
      {
        path: '',
        name: 'Dashboard',
        component: () => import('@/views/Dashboard.vue')
      },
      {
        path: 'original-artworks',
        name: 'OriginalArtworks',
        component: () => import('@/views/OriginalArtworks.vue')
      },
      {
        path: 'original-artworks/:id',
        name: 'OriginalArtworkDetail',
        component: () => import('@/views/OriginalArtworkDetail.vue')
      },
      {
        path: 'artists',
        name: 'Artists',
        component: () => import('@/views/Artists.vue')
      },
      {
        path: 'artists/:id',
        name: 'ArtistDetail',
        component: () => import('@/views/ArtistDetail.vue')
      },
      {
        path: 'institutions',
        name: 'Institutions',
        component: () => import('@/views/Institutions.vue'),
        meta: {
          title: '机构管理',
          requiresAuth: true
        }
      },
      {
        path: 'digital-artworks',
        name: 'DigitalArtworks',
        component: () => import('@/views/DigitalArtworks.vue')
      },
      {
        path: 'physical-categories',
        name: 'PhysicalCategories',
        component: () => import('@/views/PhysicalCategories.vue')
      },
      {
        path: 'rights',
        name: 'Rights',
        component: () => import('@/views/Rights.vue')
      },
      {
        path: 'rights/:id',
        name: 'RightDetail',
        component: () => import('@/views/RightDetail.vue')
      },
      {
        path: 'exhibitions',
        name: 'Exhibitions',
        component: () => import('@/views/Exhibitions.vue'),
        meta: {
          title: '展览管理',
          requiresAuth: true,
          roles: ['admin']
        }
      },
      {
        path: 'exhibitions/:id',
        name: 'ExhibitionDetail',
        component: () => import('@/views/Exhibitions.vue'),
        meta: {
          title: '展览作品管理',
          requiresAuth: true,
          roles: ['admin']
        }
      },
      {
        path: 'digital-identity/purchases/:user_id',
        name: 'DigitalIdentityPurchases',
        component: () => import('@/views/DigitalIdentityPurchases.vue'),
        meta: {
          title: '数字身份购买记录',
          requiresAuth: true
        }
      },
      {
        path: 'banners',
        name: 'Banners',
        component: () => import('@/views/Banners.vue')
      },
      {
        path: 'merchants',
        name: 'Merchants',
        component: () => import('@/views/Merchants.vue'),
        meta: {
          title: '商家管理',
          requiresAuth: true
        }
      },
      {
        path: 'merchants/:id',
        name: 'MerchantDetail',
        component: () => import('@/views/MerchantDetail.vue'),
        meta: {
          title: '商家详情',
          requiresAuth: true
        }
      },
      {
        path: 'refund-approval',
        name: 'RefundApproval',
        component: () => import('@/views/RefundApproval.vue'),
        meta: {
          title: '退款审批',
          requiresAuth: true,
          roles: ['admin']
        }
      },
      {
        path: 'orders',
        name: 'Orders',
        component: () => import('@/views/Orders.vue'),
        meta: {
          title: '订单管理',
          requiresAuth: true
        }
      }
    ]
  },
  {
    path: '/login',
    name: 'Login',
    component: Login,
    meta: { requiresAuth: false }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

function hydrateUserFromStorage() {
  const store = useUserStore()
  if (store.userInfo && Object.keys(store.userInfo).length > 0) return
  const raw = localStorage.getItem('user')
  if (!raw) return
  try {
    store.setUserInfo(JSON.parse(raw))
  } catch {
    // ignore invalid cache
  }
}

router.beforeEach((to, from, next) => {
  const tokenExpiry = localStorage.getItem('tokenExpiry')

  const isExpired = () => {
    const token = localStorage.getItem('token')
    if (!token || !tokenExpiry) return true
    const expiryTime = parseInt(tokenExpiry, 10)
    return Number.isFinite(expiryTime) && Date.now() >= expiryTime
  }

  const requiresAuth = to.matched.some((record) => record.meta.requiresAuth !== false)

  if (isExpired()) {
    localStorage.removeItem('token')
    localStorage.removeItem('tokenExpiry')
    localStorage.removeItem('user')
    if (to.path !== '/login') {
      next({ path: '/login', query: { reason: 'session_expired' } })
      return
    }
  }

  if (requiresAuth && !localStorage.getItem('token')) {
    next({ path: '/login', query: { reason: 'auth_required' } })
    return
  }

  const requiredRoles = [
    ...new Set(
      to.matched.flatMap((r) => (Array.isArray(r.meta?.roles) ? r.meta.roles : []))
    )
  ]

  // 合并 matched 上各段的 meta.roles（任一满足即可，见 @/utils/roles userHasAnyRole）
  if (requiredRoles.length > 0 && localStorage.getItem('token')) {
    hydrateUserFromStorage()
    const store = useUserStore()
    if (!userHasAnyRole(store.userInfo, requiredRoles)) {
      ElMessage.error('无权限访问该页面')
      next({ path: '/' })
      return
    }
  }

  next()
})

export default router
