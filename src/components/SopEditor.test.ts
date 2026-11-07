// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import SopEditor from './SopEditor.vue'
import type { CaseCategory } from '@/types/domain'
const mocks = vi.hoisted(() => ({ request: vi.fn(), reload: vi.fn(async () => {}) }))
vi.mock('./CombinationOrderEditor.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/services/api', () => ({
  apiRequest: mocks.request,
  apiErrorMessage: async () => 'Error',
}))
vi.mock('@/stores/categories', () => ({ useCategoryStore: () => ({ reload: mocks.reload }) }))
vi.mock('@/stores/session', () => ({ useSessionStore: () => ({ isSysadmin: false }) }))
vi.mock('@/stores/templates', () => ({
  useTemplateStore: () => ({ items: [], byId: () => undefined }),
}))
const category: CaseCategory = {
  id: 'mock',
  name: 'Mock category',
  summary: '',
  updatedAt: '',
  templateCount: 0,
  steps: [
    { id: 's', body: 'Shared Mock', templateIds: [] },
    { id: 't', body: 'Other Mock', templateIds: [] },
  ],
  baseSteps: [
    { stepId: 's', sortOrder: 0 },
    { stepId: 't', sortOrder: 1 },
  ],
  modules: [
    {
      id: 'm',
      categoryId: 'mock',
      name: 'Mock module',
      sortOrder: 0,
      steps: [{ stepId: 's', sortOrder: 0 }],
    },
  ],
}
let app: App | undefined
let host: HTMLDivElement
async function mount() {
  mocks.request.mockImplementation(
    async () =>
      new Response(JSON.stringify({ category }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  )
  host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(SopEditor, { category }) })
  app.mount(host)
  await nextTick()
}
function button(text: string) {
  const element = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!element) throw new Error(`Missing ${text}`)
  return element
}
afterEach(() => {
  app?.unmount()
  host?.remove()
  vi.clearAllMocks()
})
it('shows both sections, hides entity deletes for maintainers, and removes only a reference', async () => {
  await mount()
  expect(host.querySelector('[aria-label="基本 SOP"]')).not.toBeNull()
  expect(host.querySelector('[aria-label="情境模組"]')).not.toBeNull()
  expect(host.textContent).not.toContain('來源樣態')
  expect(host.textContent).not.toContain('目標樣態')
  expect(host.textContent).not.toContain('刪除共用步驟實體')
  expect(host.textContent).not.toContain('刪除模組實體')
  button('移除引用（保留共用步驟）').click()
  await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledOnce())
  expect(mocks.request).toHaveBeenCalledExactlyOnceWith('/api/categories/mock/refs/base/s', {
    method: 'DELETE',
  })
})
it('keeps source ordering controls but removes reference-existing-step entry points', async () => {
  await mount()
  expect(host.querySelector('[aria-label="引用既有步驟"]')).toBeNull()
  expect(host.textContent).not.toContain('引用既有步驟')
  button('引用下移').click()
  await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledOnce())
  expect(mocks.request).toHaveBeenLastCalledWith('/api/categories/mock/order/base', {
    method: 'PUT',
    body: JSON.stringify({ ids: ['t', 's'] }),
  })
})
