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
        path: 'digital-claim-copy',
        name: 'DigitalClaimCopy',
        component: () => import('@/views/DigitalClaimCopy.vue'),
        meta: {
          title: '领取说明配置',
          requiresAuth: true,
          roles: ['admin']
        }
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
      },
      {
        path: 'subscribe-message/templates',
        name: 'SubscribeMessageTemplates',
        component: () => import('@/views/SubscribeMessageTemplates.vue'),
        meta: {
          title: '订阅消息模板',
          requiresAuth: true,
          roles: ['admin']
        }
      },
      {
        path: 'referral/commissions',
        name: 'ReferralCommissions',
        component: () => import('@/views/ReferralCommissions.vue'),
        meta: {
          title: '推荐佣金明细',
          requiresAuth: true,
          roles: ['admin']
        }
      },
      {
        path: 'referral/commission-rules',
        name: 'CommissionRules',
        component: () => import('@/views/CommissionRules.vue'),
        meta: {
          title: '佣金比例规则',
          requiresAuth: true,
          roles: ['admin']
        }
      },
      {
        path: 'referral/withdrawals',
        name: 'ReferralWithdrawals',
        component: () => import('@/views/ReferralWithdrawals.vue'),
        meta: {
          title: '推荐官提现',
          requiresAuth: true,
          roles: ['admin']
        }
      },
      {
        path: 'referral/coupons',
        name: 'ReferralCoupons',
        component: () => import('@/views/ReferralCoupons.vue'),
        meta: {
          title: '微信代金券',
          requiresAuth: true,
          roles: ['admin']
        }
      },
      {
        path: 'referral/advisor-applications',
        name: 'ReferralAdvisorApplications',
        component: () => import('@/views/ReferralAdvisorApplications.vue'),
        meta: {
          title: '艺术顾问申请',
          requiresAuth: true,
          roles: ['admin']
        }
      },
      {
        path: 'referral/vip-early-access',
        name: 'ReferralVipEarlyAccess',
        component: () => import('@/views/ReferralVipEarlyAccess.vue'),
        meta: {
          title: 'VIP优先购',
          requiresAuth: true,
          roles: ['admin']
        }
      },
      {
        path: 'referral/share-events',
        name: 'ReferralShareEvents',
        component: () => import('@/views/ReferralShareEvents.vue'),
        meta: {
          title: '分享记录',
          requiresAuth: true,
          roles: ['admin']
        }
      },
      {
        path: 'referral/reconciliation',
        name: 'ReferralReconciliation',
        component: () => import('@/views/ReferralReconciliation.vue'),
        meta: {
          title: '推荐对账',
          requiresAuth: true,
          roles: ['admin']
        }
      },
      {
        path: 'wx-users',
        name: 'WxUsers',
        component: () => import('@/views/WxUsers.vue'),
        meta: {
          title: '小程序用户',
          requiresAuth: true,
          roles: ['admin']
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
