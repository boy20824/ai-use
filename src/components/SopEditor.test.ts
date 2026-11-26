// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import SopEditor from './SopEditor.vue'
import { readFileSync } from 'node:fs'
import type { CaseCategory } from '@/types/domain'
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  reload: vi.fn(async () => {}),
  isSysadmin: false,
}))
vi.mock('./CombinationOrderEditor.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/services/api', () => ({
  apiRequest: mocks.request,
  apiErrorMessage: async () => 'Error',
}))
vi.mock('@/stores/categories', () => ({ useCategoryStore: () => ({ reload: mocks.reload }) }))
vi.mock('@/stores/session', () => ({ useSessionStore: () => ({ isSysadmin: mocks.isSysadmin }) }))
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
async function mount(config = structuredClone(category)) {
  const current = ref(config)
  mocks.request.mockImplementation(
    async () =>
      new Response(JSON.stringify({ category }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  )
  host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(SopEditor, { category: current.value }) })
  app.mount(host)
  await nextTick()
  return current
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
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  mocks.isSysadmin = false
})
it('confirms taking a step out of the current list and lets the user add it back', async () => {
  const current = await mount()
  const remove = button('從這裡拿掉（步驟本身還在）')
  remove.focus()
  remove.click()
  await nextTick()
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Shared Mock')
  expect(mocks.request).not.toHaveBeenCalled()
  button('取消').click()
  await nextTick()
  expect(document.activeElement).toBe(remove)
  expect(mocks.request).not.toHaveBeenCalled()

  mocks.reload.mockImplementationOnce(async () => {
    current.value.baseSteps = [{ stepId: 't', sortOrder: 1 }]
  })
  remove.click()
  await nextTick()
  button('從這裡拿掉').click()
  await vi.waitFor(() => expect(host.querySelector('[data-edit-step="s"]')).toBeNull())
  expect(mocks.request).toHaveBeenCalledExactlyOnceWith('/api/categories/mock/refs/base/s', {
    method: 'DELETE',
  })
  expect(current.value.steps).toHaveLength(3)

  const select = host.querySelector('select')!
  expect([...select.options].map((option) => option.value)).toEqual(['', 's', 'unreferenced'])
  select.value = 's'
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
  mocks.reload.mockImplementationOnce(async () => {
    current.value.baseSteps!.push({ stepId: 's', sortOrder: 2 })
  })
  button('加回既有步驟').click()
  await vi.waitFor(() => expect(host.querySelector('[data-edit-step="s"]')).not.toBeNull())
  expect(mocks.request).toHaveBeenLastCalledWith('/api/categories/mock/refs/base/s', {
    method: 'PUT',
    body: JSON.stringify({ stepId: 's', sortOrder: 2 }),
  })
})

it('styles disabled and enabled move buttons differently and keeps focus on the same step', async () => {
  const config = structuredClone(category)
  config.baseSteps!.push({ stepId: 'unreferenced', sortOrder: 2 })
  const current = await mount(config)
  const up = host.querySelector<HTMLButtonElement>('[aria-label="上移：Shared Mock"]')!
  const down = host.querySelector<HTMLButtonElement>('[aria-label="下移：Shared Mock"]')!
  expect(up.disabled).toBe(true)
  expect(down.disabled).toBe(false)
  expect(up.classList.contains('btn-move') && down.classList.contains('btn-move')).toBe(true)
  expect(readFileSync('src/style.css', 'utf8')).toMatch(
    /@utility btn-move\s*{[^}]*btn-secondary[^}]*disabled:bg-transparent[^}]*disabled:opacity-/,
  )
  const setOrder = (ids: string[]) => {
    mocks.reload.mockImplementationOnce(async () => {
      current.value.baseSteps = ids.map((stepId, sortOrder) => ({ stepId, sortOrder }))
    })
  }

  setOrder(['t', 's', 'unreferenced'])
  down.focus()
  down.click()
  await vi.waitFor(() => expect(up.disabled).toBe(false))
  expect(document.activeElement).toBe(down)
  expect(mocks.request).toHaveBeenLastCalledWith('/api/categories/mock/order/base', {
    method: 'PUT',
    body: JSON.stringify({ ids: ['t', 's', 'unreferenced'] }),
  })

  setOrder(['t', 'unreferenced', 's'])
  down.click()
  await vi.waitFor(() => expect(down.disabled).toBe(true))
  expect(document.activeElement).toBe(up)
})

it('uses in-page dialogs for scenario rename and deletion, with keyboard support', async () => {
  const prompt = vi.fn()
  vi.stubGlobal('prompt', prompt)
  const confirm = vi.fn()
  vi.stubGlobal('confirm', confirm)
  mocks.isSysadmin = true
  const current = await mount()
  button('Mock module').click()
  await nextTick()
  expect(host.querySelector('[aria-label="上移：Mock module"]')?.hasAttribute('disabled')).toBe(
    true,
  )
  expect(host.querySelector('[aria-label="下移：Mock module"]')?.hasAttribute('disabled')).toBe(
    true,
  )
  const rename = button('編輯情境')
  rename.focus()
  rename.click()
  await nextTick()
  const dialogInput = () => host.querySelector<HTMLInputElement>('[role="dialog"] input')!
  expect(dialogInput().value).toBe('Mock module')
  expect(document.activeElement).toBe(dialogInput())
  dialogInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await nextTick()
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(rename)
  expect(mocks.request).not.toHaveBeenCalled()

  rename.click()
  await nextTick()
  dialogInput().value = 'Mock renamed'
  dialogInput().dispatchEvent(new Event('input', { bubbles: true }))
  dialogInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledOnce())
  expect(mocks.request).toHaveBeenLastCalledWith('/api/categories/mock/modules/m', {
    method: 'PATCH',
    body: JSON.stringify({ name: 'Mock renamed', sortOrder: 0 }),
  })

  button('刪除這個情境').click()
  await nextTick()
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('刪除這個情境？')
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('步驟與範本會保留')
  expect(mocks.request).toHaveBeenCalledTimes(1)
  button('取消').click()
  await nextTick()
  expect(mocks.request).toHaveBeenCalledTimes(1)

  button('刪除這個情境').click()
  await nextTick()
  mocks.reload.mockImplementationOnce(async () => {
    current.value.modules = []
  })
  host.querySelector<HTMLButtonElement>('[role="dialog"] .btn-danger')!.click()
  await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledTimes(2))
  expect(mocks.request).toHaveBeenLastCalledWith('/api/categories/mock/modules/m', {
    method: 'DELETE',
    body: JSON.stringify({ confirm: true }),
  })
  expect(current.value.steps).toHaveLength(3)
  expect(prompt).not.toHaveBeenCalled()
  expect(confirm).not.toHaveBeenCalled()
})

it('keeps scenario deletion hidden for maintainers', async () => {
  await mount()
  button('Mock module').click()
  await nextTick()
  expect(host.textContent).not.toContain('刪除這個情境')
})

it('loads, toggles and saves the strict parallel boolean with existing step configuration', async () => {
  const current = await mount()
  mocks.request.mockImplementation(
    async () =>
      new Response(JSON.stringify({ impact: { base: [], modules: [] } }), { status: 200 }),
  )
  button('編輯這個步驟').click()
  await vi.waitFor(() => expect(host.textContent).toContain('這個步驟用在'))
  const checkbox = [...host.querySelectorAll('label')]
    .find((label) => label.textContent?.includes('此步驟可請其他人同步進行'))!
    .querySelector('input')!
  expect(checkbox.checked).toBe(false)
  checkbox.checked = true
  checkbox.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
  button('儲存這個步驟').click()
  await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledOnce())
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
  current.value.steps[0] = { ...current.value.steps[0]!, canRunInParallel: true }
  try {
    button('編輯這個步驟').click()
    await vi.waitFor(() => expect(host.textContent).toContain('這個步驟用在'))
    expect(
      [...host.querySelectorAll('label')]
        .find((label) => label.textContent?.includes('此步驟可請其他人同步進行'))!
        .querySelector('input')!.checked,
    ).toBe(true)
  } finally {
    current.value.steps[0] = { id: 's', body: 'Shared Mock', templateIds: [] }
  }
})

it('announces a successful step save and new scenario next to their controls', async () => {
  await mount()
  mocks.request.mockImplementation(async (path: string) =>
    Response.json(path.endsWith('/impact') ? { impact: { base: [{}], modules: [] } } : {}),
  )
  const opener = button('編輯這個步驟')
  opener.click()
  await vi.waitFor(() => expect(host.textContent).toContain('基本步驟 1 處、情境 0 處'))
  button('儲存這個步驟').click()
  await vi.waitFor(() =>
    expect(opener.closest('li')?.querySelector('[role="status"]')?.textContent).toBe('已儲存'),
  )
  expect(document.activeElement).toBe(opener)
  const input = host.querySelector<HTMLInputElement>('[aria-label="情境名稱"]')!
  input.value = 'Mock scenario'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  button('新增情境').click()
  await vi.waitFor(() =>
    expect(host.querySelector('[aria-label="情境"] [role="status"]')?.textContent).toBe(
      '已新增情境「Mock scenario」',
    ),
  )
})

it('moves a scenario and focuses its opposite move button at the boundary', async () => {
  const config = structuredClone(category)
  config.modules!.push({
    id: 'second',
    categoryId: 'mock',
    name: 'Mock second',
    sortOrder: 1,
    steps: [],
  })
  const current = await mount(config)
  button('Mock module').click()
  await nextTick()
  const down = host.querySelector<HTMLButtonElement>('[aria-label="下移：Mock module"]')!
  const up = host.querySelector<HTMLButtonElement>('[aria-label="上移：Mock module"]')!
  mocks.reload.mockImplementationOnce(async () => {
    current.value.modules = [current.value.modules![1]!, current.value.modules![0]!]
  })
  down.focus()
  down.click()
  await vi.waitFor(() => expect(document.activeElement).toBe(up))
  expect(down.disabled).toBe(true)
  expect(mocks.request).toHaveBeenCalledExactlyOnceWith('/api/categories/mock/order/modules', {
    method: 'PUT',
    body: JSON.stringify({ ids: ['second', 'm'] }),
  })
})
