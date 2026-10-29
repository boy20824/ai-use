import { appName } from '@/config/app'
import { useSessionStore } from '@/stores/session'
import { safeRedirect } from '@/utils/redirect'
import { createRouter, createWebHistory } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    requiresAuth?: boolean
    requiresCategoryManager?: boolean
    requiresSysadmin?: boolean
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
      path: '/register',
      name: 'register',
      component: () => import('@/views/RegisterView.vue'),
      meta: { title: '註冊帳號', public: true },
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
          path: 'categories/new',
          name: 'category-new',
          component: () => import('@/views/CategoryFormView.vue'),
          meta: { title: '新增案件類別', requiresCategoryManager: true },
        },
        {
          path: 'categories/:id/edit',
          name: 'category-edit',
          component: () => import('@/views/CategoryFormView.vue'),
          meta: { title: '編輯案件類別', requiresCategoryManager: true },
        },
        {
          path: 'categories/:id',
          name: 'category',
          component: () => import('@/views/CategoryView.vue'),
          meta: { title: '類別工作台' },
        },
        {
          path: 'templates',
          name: 'templates',
          component: () => import('@/views/TemplatesView.vue'),
          meta: { title: '範本庫' },
        },
        {
          path: 'drafts',
          redirect: (to) => ({ name: 'templates', query: to.query }),
        },
        {
          path: 'feedback',
          name: 'feedback',
          component: () => import('@/views/FeedbackView.vue'),
          meta: { title: '網頁改善建議' },
        },
        {
          path: 'members',
          name: 'members',
          component: () => import('@/views/MembersView.vue'),
          meta: { title: '會員管理', requiresSysadmin: true },
        },
        { path: 'access', redirect: { name: 'members' } },
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

router.beforeEach(async (to) => {
  const session = useSessionStore()
  await session.restore()

  if (to.name === 'login' || to.name === 'register') {
    if (session.authenticated) {
      return { path: safeRedirect(to.query.redirect) }
    }
    return
  }

  const needsAuth = to.matched.some((record) => record.meta.requiresAuth === true)
  if (needsAuth && !session.authenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  const needsManager = to.matched.some((record) => record.meta.requiresCategoryManager === true)
  if (needsManager && !session.canEditCategory) {
    const raw = to.params.id
    const categoryId = Array.isArray(raw) ? raw[0] : raw
    if (to.name === 'category-edit' && categoryId) {
      return { name: 'category', params: { id: categoryId } }
    }
    return { name: 'categories' }
  }

  const needsSysadmin = to.matched.some((record) => record.meta.requiresSysadmin === true)
  if (needsSysadmin && !session.isSysadmin) return { name: 'home' }
})

router.afterEach((to) => {
  const titled = [...to.matched].reverse().find((record) => typeof record.meta.title === 'string')
  const title = titled?.meta.title ?? appName
  document.title = title === appName ? appName : `${title} · ${appName}`
})
