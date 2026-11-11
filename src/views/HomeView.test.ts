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

it('groups each feature title and description beside its icon', async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: HomeView }],
  })
  await router.push('/')
  const host = document.createElement('div')
  const app = createApp(HomeView).use(router)
  app.mount(host)
  try {
    const cards = [...host.querySelectorAll('.overview-entries .entry-card')]
    expect(cards).toHaveLength(4)
    expect(cards.map((card) => card.querySelector('h2')?.textContent)).toEqual([
      '案件範本',
      '範本步驟',
      '範本庫',
      '產出文件',
    ])
    for (const card of cards) {
      expect(card.children[0]?.classList.contains('entry-icon')).toBe(true)
      const text = card.children[1]!
      expect(text.classList.contains('entry-text')).toBe(true)
      expect([...text.children].map((el) => el.tagName)).toEqual(['H2', 'P'])
      expect(text.querySelector('p')?.textContent?.trim()).not.toBe('')
    }
  } finally {
    app.unmount()
  }
})
