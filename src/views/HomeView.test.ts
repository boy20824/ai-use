// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import HomeView from './HomeView.vue'

vi.mock('@/stores/categories', () => ({
  useCategoryStore: () => ({ items: [], ready: true, total: 0 }),
}))
vi.mock('@/stores/templates', () => ({
  useTemplateStore: () => ({ items: [], ready: true }),
}))
vi.mock('@/stores/session', () => ({
  useSessionStore: () => ({ canEditCategory: false }),
}))

it('offers one primary workbench action and one secondary library action without duplicate entry cards', async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: HomeView }],
  })
  await router.push('/')
  const host = document.createElement('div')
  const app = createApp(HomeView).use(router)
  app.mount(host)
  try {
    expect(host.querySelector('.overview-entries')).toBeNull()
    const primary = host.querySelector('a.btn-primary')!
    expect(primary.textContent).toBe('選擇案件、開始填寫')
    expect(primary.getAttribute('href')).toBe('/categories')
    const secondary = host.querySelector('a.btn-secondary')!
    expect(secondary.textContent).toBe('範本庫')
    expect(secondary.getAttribute('href')).toBe('/templates')
    expect(host.querySelectorAll('a.btn-primary')).toHaveLength(1)
    expect(host.querySelectorAll('a.btn-secondary')).toHaveLength(1)
    expect(host.querySelectorAll('.data-panel')).toHaveLength(2)
  } finally {
    app.unmount()
  }
})
