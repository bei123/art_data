import { createRouter, createWebHistory } from 'vue-router'
import Login from '../views/Login.vue'

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
        path: 'digital-identity/purchases/:user_id',
        name: 'DigitalIdentityPurchases',
        component: () => import('@/views/DigitalIdentityPurchases.vue')
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
        path: '/refund-approval',
        name: 'RefundApproval',
        component: () => import('@/views/RefundApproval.vue'),
        meta: {
          title: '退款审批',
          requiresAuth: true,
          roles: ['admin']
        }
      },
      {
        path: '/orders',
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

// 路由守卫
router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('token')
  const tokenExpiry = localStorage.getItem('tokenExpiry')
  const requiresAuth = to.matched.some(record => record.meta.requiresAuth !== false)

  // 简单的本地过期检查，避免引入循环依赖
  const isExpired = () => {
    if (!token || !tokenExpiry) return true
    const expiryTime = parseInt(tokenExpiry)
    return Number.isFinite(expiryTime) && Date.now() >= expiryTime
  }

  if (isExpired()) {
    localStorage.removeItem('token')
    localStorage.removeItem('tokenExpiry')
    localStorage.removeItem('user')
    if (to.path !== '/login') {
      next('/login')
      return
    }
  }

  if (requiresAuth && !token) {
    next('/login')
  } else {
    next()
  }
})

export default router 