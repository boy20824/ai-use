// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import CategoryFormView from './CategoryFormView.vue'
import type { CaseCategory } from '@/types/domain'

const mocks = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: 'created' })),
  byId: vi.fn<() => CaseCategory | undefined>(() => undefined),
}))
vi.mock('@/stores/categories', () => ({
  useCategoryStore: () => ({ ready: true, byId: mocks.byId, create: mocks.create }),
}))
vi.mock('@/stores/templates', () => ({
  useTemplateStore: () => ({ items: [], byId: () => undefined }),
}))
vi.mock('@/stores/session', () => ({
  useSessionStore: () => ({ canEditCategory: true }),
}))

let app: App | undefined
let host: HTMLDivElement
const execCommandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand')
afterEach(() => {
  app?.unmount()
  host?.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  mocks.create.mockClear()
  mocks.byId.mockReset()
  if (execCommandDescriptor) Object.defineProperty(document, 'execCommand', execCommandDescriptor)
  else Reflect.deleteProperty(document, 'execCommand')
})
function button(text: string) {
  const element = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!element) throw new Error(`Missing button: ${text}`)
  return element
}
async function type(selector: string, value: string) {
  const element = host.querySelector(selector) as HTMLInputElement
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}
async function submit() {
  host
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await nextTick()
}
async function mountForm(path = '/categories/new') {
  host = document.createElement('div')
  document.body.append(host)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/categories/new', name: 'category-new', component: CategoryFormView },
      { path: '/categories/:id/edit', name: 'category-edit', component: CategoryFormView },
      { path: '/categories/:id', component: { render: () => h('div') } },
      { path: '/categories', component: { render: () => h('div') } },
    ],
  })
  await router.push(path)
  await router.isReady()
  app = createApp({ render: () => h(RouterView) }).use(router)
  app.mount(host)
  await nextTick()
  return router
}
async function mountFields() {
  await mountForm()
  await type('#category-name', '公共危險')
  await submit()
  expect(button('繼續設定步驟')).toBeDefined()
  await submit()
  button('新增欄位').click()
  await nextTick()
  await type('[aria-label="欄位名稱"]', '  酒測值  ')
}

it('skips optional variants, copies the trimmed key and reports a field with no output', async () => {
  const writeText = vi.fn(async () => {})
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  await mountFields()
  expect(host.querySelector('input[aria-label="欄位鍵"]')).toBeNull()
  expect(host.querySelector('code')?.textContent).toBe('{{酒測值}}')
  button('複製').click()
  await vi.waitFor(() => expect(button('已複製')).toBeDefined())
  expect(writeText).toHaveBeenCalledWith('{{酒測值}}')
  await submit()
  expect(mocks.create).not.toHaveBeenCalled()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('{{酒測值}}')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('偵測到的欄位：無')
})

it('keeps create views narrow throughout the wizard', async () => {
  await mountForm()
  await type('#category-name', '公共危險')
  for (let step = 1; step <= 3; step++) {
    expect(host.querySelector('form')?.classList.contains('max-w-3xl')).toBe(true)
    expect(host.querySelector('form')?.classList.contains('xl:max-w-none')).toBe(false)
    if (step < 3) await submit()
  }
})

it('widens only the existing SOP step and preserves its reorder across internal transitions', async () => {
  mocks.byId.mockReturnValue({
    id: 'existing',
    name: '公共危險',
    summary: '',
    updatedAt: '',
    templateCount: 0,
    steps: ['A', 'B'].map((id) => ({ id, body: id, templateIds: [] })),
    baseSteps: ['A', 'B'].map((stepId, sortOrder) => ({ stepId, sortOrder })),
    modules: [],
  })
  const router = await mountForm('/categories/existing/edit')
  const form = host.querySelector('form')!
  expect(form.classList.contains('xl:max-w-none')).toBe(false)
  await submit()
  expect(form.classList.contains('xl:max-w-none')).toBe(false)
  await submit()
  expect(form.classList.contains('max-w-3xl')).toBe(true)
  expect(form.classList.contains('xl:max-w-none')).toBe(true)
  const editor = host.querySelector('[aria-label="組合專屬順序"]')!
  expect(editor.parentElement?.classList.contains('xl:grid-cols-2')).toBe(true)
  expect(editor.parentElement?.classList.contains('grid-cols-2')).toBe(false)
  const move = host.querySelector('[aria-label="B：上移"]') as HTMLButtonElement
  move.click()
  await nextTick()
  const order = () =>
    [...editor.querySelectorAll('[data-step-id]')].map((li) => li.getAttribute('data-step-id'))
  expect(order()).toEqual(['B', 'A'])
  button('上一步').click()
  await nextTick()
  expect(form.classList.contains('xl:max-w-none')).toBe(false)
  expect(host.querySelector('[aria-label="組合專屬順序"]')).toBe(editor)
  button('上一步').click()
  await nextTick()
  expect(form.classList.contains('xl:max-w-none')).toBe(false)
  await submit()
  const confirm = vi.fn(() => false)
  vi.stubGlobal('confirm', confirm)
  await router.push('/categories')
  expect(router.currentRoute.value.path).toBe('/categories/existing/edit')
  expect(confirm).toHaveBeenCalledOnce()
  await submit()
  expect(form.classList.contains('xl:max-w-none')).toBe(true)
  expect(order()).toEqual(['B', 'A'])
  expect(editor.textContent).toContain('順序尚未儲存')
})

it.each(['unavailable', 'rejected'])(
  'falls back when the clipboard is %s and cleans up',
  async (mode) => {
    vi.stubGlobal(
      'navigator',
      mode === 'unavailable'
        ? {}
        : {
            clipboard: {
              writeText: vi.fn(async () => {
                throw new Error('denied')
              }),
            },
          },
    )
    const copy = vi.fn(() => {
      const area = document.querySelector(
        'textarea[aria-label="複製欄位寫法"]',
      ) as HTMLTextAreaElement
      expect(area.value).toBe('{{酒測值}}')
      return true
    })
    Object.defineProperty(document, 'execCommand', { value: copy, configurable: true })
    await mountFields()
    button('複製').click()
    await vi.waitFor(() => expect(button('已複製')).toBeDefined())
    expect(copy).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea[aria-label="複製欄位寫法"]')).toBeNull()
  },
)

it('shows a manual-copy message when both clipboard methods fail', async () => {
  vi.stubGlobal('navigator', {})
  Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true })
  await mountFields()
  button('複製').click()
  await nextTick()
  expect(host.textContent).toContain('無法自動複製')
  expect(host.textContent).not.toContain('已複製')
})
