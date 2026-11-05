// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import CategoryFormView from './CategoryFormView.vue'

const mocks = vi.hoisted(() => ({ create: vi.fn(async () => ({ id: 'created' })) }))
vi.mock('@/stores/categories', () => ({
  useCategoryStore: () => ({ ready: true, byId: () => undefined, create: mocks.create }),
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
async function mountFields() {
  host = document.createElement('div')
  document.body.append(host)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/categories/new', name: 'category-new', component: CategoryFormView },
      { path: '/categories/:id', component: { render: () => h('div') } },
      { path: '/categories', component: { render: () => h('div') } },
    ],
  })
  await router.push('/categories/new')
  await router.isReady()
  app = createApp({ render: () => h(RouterView) }).use(router)
  app.mount(host)
  await nextTick()
  await type('#category-name', '公共危險')
  await submit()
  expect(button('跳過樣態')).toBeDefined()
  await submit()
  button('新增欄位').click()
  await nextTick()
  await type('[aria-label="欄位名稱"]', '  酒測值  ')
}

it('skips optional variants, derives the key from the trimmed name and copies its placeholder', async () => {
  const writeText = vi.fn(async () => {})
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  await mountFields()
  expect(host.querySelector('input[aria-label="欄位鍵"]')).toBeNull()
  expect(host.querySelector('code')?.textContent).toBe('{{酒測值}}')
  button('複製').click()
  await vi.waitFor(() => expect(button('已複製')).toBeDefined())
  expect(writeText).toHaveBeenCalledWith('{{酒測值}}')
  await submit()
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      variants: [],
      fields: [expect.objectContaining({ name: '酒測值', key: '酒測值', type: 'text' })],
    }),
  )
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
