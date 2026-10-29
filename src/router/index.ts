import { appName } from '@/config/app'
import { createRouter, createWebHistory } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    title: string
  }
}

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { title: '登入' },
    },
    {
      path: '/',
      component: () => import('@/layouts/AppShell.vue'),
      children: [
        {
          path: '',
          name: 'home',
          component: () => import('@/views/HomeView.vue'),
          meta: { title: '總覽' },
        },
        {
          path: 'cases',
          name: 'cases',
          component: () => import('@/views/CasesView.vue'),
          meta: { title: '案件' },
        },
        {
          path: 'personnel',
          name: 'personnel',
          component: () => import('@/views/PersonnelView.vue'),
          meta: { title: '人員' },
        },
        {
          path: 'access',
          name: 'access',
          component: () => import('@/views/AccessView.vue'),
          meta: { title: '存取權限' },
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : appName
  document.title = `${title} · ${appName}`
})
