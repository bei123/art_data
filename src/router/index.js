import { createRouter, createWebHistory } from 'vue-router'

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
      }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router 