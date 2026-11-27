// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { TemplateSummary } from '@/storage'
import HomeView from './HomeView.vue'

const mocks = vi.hoisted(() => ({
  items: [] as Pick<TemplateSummary, 'id' | 'fileName' | 'usages'>[],
}))
vi.mock('@/stores/categories', () => ({
  useCategoryStore: () => ({
    items: [],
    ready: true,
    total: 0,
    byId: (id: string) => (id === 'current' ? { name: '目前案件名稱' } : undefined),
  }),
}))
vi.mock('@/stores/templates', () => ({
  useTemplateStore: () => ({ items: mocks.items, ready: true }),
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
    expect(host.querySelector('.page-intro.enter.enter-1')).not.toBeNull()
    expect(host.querySelector('.data-panel.enter.enter-2.lift-card.spot')).not.toBeNull()
    expect(host.querySelector('.overview-library.enter.enter-3.lift-card.spot')).not.toBeNull()
  } finally {
    app.unmount()
  }
})

it('uses step titles and falls back to the usage category name and legacy step body', async () => {
  mocks.items = [
    {
      id: 'mock',
      fileName: 'Mock.docx',
      usages: [
        {
          categoryId: 'current',
          categoryName: '原案件名稱',
          stepId: 'one',
          stepTitle: '步驟名稱',
          stepBody: '步驟內容',
          sortOrder: 0,
        },
        {
          categoryId: 'missing',
          categoryName: '其他案件',
          stepId: 'two',
          stepBody: '舊步驟內容',
          sortOrder: 0,
        },
      ],
    },
  ]
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: HomeView },
      { path: '/categories', component: { render: () => null } },
      { path: '/templates', component: { render: () => null } },
    ],
  })
  await router.push('/')
  const host = document.createElement('div')
  const app = createApp(HomeView).use(router)
  app.mount(host)
  try {
    expect(host.querySelector('.library-preview-row small')?.textContent).toBe(
      '目前案件名稱 → 步驟名稱、其他案件 → 舊步驟內容',
    )
  } finally {
    app.unmount()
    mocks.items = []
  }
})
