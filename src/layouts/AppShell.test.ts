// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useTemplateStore } from '@/stores/templates'
import AppShell from './AppShell.vue'

const { list } = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/storage', () => ({
  templateStorageMode: () => 'api',
  createTemplateRepository: () => ({ list }),
}))
vi.mock('@/stores/session', () => ({ useSessionStore: () => ({}) }))
vi.mock('@/components/SideNav.vue', () => ({ default: { template: '<nav />' } }))

it('retries a previously failed template list when the authenticated shell mounts', async () => {
  list.mockRejectedValueOnce(new Error('Mock unavailable')).mockResolvedValueOnce([])
  const pinia = createPinia()
  const templates = useTemplateStore(pinia)
  await templates.load()
  expect(templates.ready).toBe(false)
  expect(templates.error).toBe('無法讀取範本文件。')
  expect(list).toHaveBeenCalledTimes(1)

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/templates', component: { template: '<div />' } }],
  })
  await router.push('/templates')
  const app = createApp(AppShell).use(pinia).use(router)
  app.mount(document.createElement('div'))
  try {
    expect(list).toHaveBeenCalledTimes(2)
    await templates.load()
    expect(templates.ready).toBe(true)
    expect(templates.error).toBe('')
  } finally {
    app.unmount()
  }
})
