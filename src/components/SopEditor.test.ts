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
    { id: 'unreferenced', body: 'Retained Mock', templateIds: ['retained-docx'] },
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
  expect(host.textContent).not.toContain('共用步驟實體（含未引用步驟）')
  expect(host.querySelector('details')).toBeNull()
  expect(category.steps).toHaveLength(3)
  expect(category.steps[2]).toEqual({
    id: 'unreferenced',
    body: 'Retained Mock',
    templateIds: ['retained-docx'],
  })
  expect(host.textContent).not.toContain('Retained Mock')
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

it('loads, toggles and saves the strict parallel boolean with existing step configuration', async () => {
  await mount()
  mocks.request.mockImplementation(
    async () =>
      new Response(JSON.stringify({ impact: { base: [], modules: [] } }), { status: 200 }),
  )
  button('編輯共用步驟').click()
  await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledOnce())
  const checkbox = [...host.querySelectorAll('label')]
    .find((label) => label.textContent?.includes('此步驟可請其他人同步進行'))!
    .querySelector('input')!
  expect(checkbox.checked).toBe(false)
  checkbox.checked = true
  checkbox.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
  button('儲存共用步驟').click()
  await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledTimes(2))
  expect(mocks.request).toHaveBeenLastCalledWith('/api/categories/mock/steps/s', {
    method: 'PATCH',
    body: JSON.stringify({
      title: 'Shared Mock',
      body: 'Shared Mock',
      items: [],
      note: '',
      canRunInParallel: true,
      templateIds: [],
    }),
  })
  category.steps[0] = { ...category.steps[0]!, canRunInParallel: true }
  try {
    button('編輯共用步驟').click()
    await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledTimes(3))
    expect(
      [...host.querySelectorAll('label')]
        .find((label) => label.textContent?.includes('此步驟可請其他人同步進行'))!
        .querySelector('input')!.checked,
    ).toBe(true)
  } finally {
    category.steps[0] = { id: 's', body: 'Shared Mock', templateIds: [] }
  }
})
