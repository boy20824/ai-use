import { appName } from '@/config/app'
import { useSessionStore } from '@/stores/session'
import { safeRedirect } from '@/utils/redirect'
import { createRouter, createWebHistory } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    requiresAuth?: boolean
    public?: boolean
  }
}

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior() {
    return { top: 0 }
  },
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { title: '登入', public: true },
    },
    {
      path: '/',
      component: () => import('@/layouts/AppShell.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          name: 'home',
          component: () => import('@/views/HomeView.vue'),
          meta: { title: '總覽' },
        },
        {
          path: 'categories',
          name: 'categories',
          component: () => import('@/views/CategoriesView.vue'),
          meta: { title: '案件類別' },
        },
        {
          path: 'categories/:id',
          name: 'category',
          component: () => import('@/views/CategoryView.vue'),
          meta: { title: '類別工作台' },
        },
        {
          path: 'drafts',
          name: 'drafts',
          component: () => import('@/views/DraftsView.vue'),
          meta: { title: '我的草稿' },
        },
        {
          path: 'access',
          name: 'access',
          component: () => import('@/views/AccessView.vue'),
          meta: { title: '存取權限' },
        },
        { path: 'cases', redirect: { name: 'categories' } },
        { path: 'personnel', redirect: { name: 'categories' } },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

router.beforeEach((to) => {
  const session = useSessionStore()

  if (to.name === 'login') {
    if (session.authenticated) {
      return { path: safeRedirect(to.query.redirect) }
    }
    return
  }

  const needsAuth = to.matched.some((record) => record.meta.requiresAuth === true)
  if (needsAuth && !session.authenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
})

router.afterEach((to) => {
  const titled = [...to.matched].reverse().find((record) => typeof record.meta.title === 'string')
  const title = titled?.meta.title ?? appName
  document.title = title === appName ? appName : `${title} · ${appName}`
})
