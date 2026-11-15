// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import CategoryView from './CategoryView.vue'
import CategoriesView from './CategoriesView.vue'
import AppShell from '@/layouts/AppShell.vue'

const mocks = vi.hoisted(() => ({
  session: { authenticated: true, canEditCategory: true, canDeleteCategory: true, logout: vi.fn() },
}))
vi.mock('@/components/SideNav.vue', () => ({
  default: { template: '<button @click="$emit(\'logout\')">Mock logout</button>' },
}))
const items = ['one', 'two'].map((id) => ({
  id,
  name: `Mock ${id}`,
  summary: '',
  group: 'criminal',
  updatedAt: '',
  templateCount: 1,
  fields: ['姓名', '警局'].map((key) => ({ id: key, key, type: 'text', scope: 'base' })),
  steps: [{ id: 'step', body: 'Mock step', templateIds: ['mock-template'] }],
  baseSteps: [{ stepId: 'step', sortOrder: 0 }],
}))
vi.mock('@/stores/categories', () => ({
  useCategoryStore: () => ({
    ready: true,
    total: 2,
    get items() {
      return items
    },
    byId: (id: string) => items.find((item) => item.id === id),
  }),
}))
vi.mock('@/stores/session', () => ({ useSessionStore: () => mocks.session }))
vi.mock('@/stores/templates', () => ({
  useTemplateStore: () => ({
    load: vi.fn(),
    items: [{ id: 'mock-template', placeholders: ['姓名', '日期'] }],
    byId: () => ({ id: 'mock-template', fileName: 'Mock.docx', placeholders: ['姓名', '日期'] }),
  }),
}))
let app: App
let host: HTMLDivElement
beforeEach(() => {
  mocks.session = reactive({
    authenticated: true,
    canEditCategory: true,
    canDeleteCategory: true,
    logout: vi.fn(async () => {
      mocks.session.authenticated = false
    }),
  })
})
afterEach(() => {
  app?.unmount()
  host?.remove()
  vi.restoreAllMocks()
})
async function mount(path = '/categories/one', shell = false) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/categories', component: CategoriesView },
      { path: '/categories/:id', component: CategoryView },
      { path: '/login', name: 'login', component: { template: '<p>Mock login</p>' } },
      { path: '/away', component: { template: '<p>Mock destination</p>' } },
    ],
  })
  await router.push(path)
  host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(shell ? AppShell : RouterView) }).use(router)
  app.mount(host)
  await nextTick()
  return router
}
const nameInput = () => host.querySelector<HTMLInputElement>('[data-field-key="姓名"] input')!
async function fill() {
  nameInput().value = 'Mock draft name'
  nameInput().dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}
function dialog() {
  return host.querySelector('[role="dialog"]')
}
async function decision(confirm: boolean) {
  await vi.waitFor(() => expect(dialog()).not.toBeNull())
  dialog()!
    .querySelector<HTMLButtonElement>(confirm ? '.btn-primary' : '.btn-secondary')!
    .click()
  await nextTick()
}
it.each(['/categories/one', '/categories'])(
  'leaves an empty workbench at %s without prompting for automatic defaults',
  async (path) => {
    const router = await mount(path)
    expect(host.querySelector<HTMLInputElement>('[data-field-key="警局"] input')!.value).not.toBe(
      '',
    )
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    await router.push('/away')
    expect(router.currentRoute.value.path).toBe('/away')
    expect(dialog()).toBeNull()
  },
)
it.each(['/categories/one', '/categories'])(
  'keeps a filled draft at %s until leave is confirmed, including cancel and refresh protection',
  async (path) => {
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    const router = await mount(path)
    await fill()
    const navigation = router.push('/away')
    await vi.waitFor(() => expect(dialog()).not.toBeNull())
    expect(nameInput().value).toBe('Mock draft name')
    expect(router.currentRoute.value.path).toBe(path)
    await decision(false)
    await navigation
    expect(router.currentRoute.value.path).toBe(path)
    expect(nameInput().value).toBe('Mock draft name')
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(nameInput().value).toBe('Mock draft name')
    const accepted = router.push('/away')
    await decision(true)
    await accepted
    expect(router.currentRoute.value.path).toBe('/away')
    const after = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
    await router.push(path)
    expect(nameInput().value).toBe('')
    expect(storage).not.toHaveBeenCalled()
  },
)
it('guards reused workbench route updates', async () => {
  const router = await mount()
  await fill()
  const canceled = router.push('/categories/two')
  await decision(false)
  await canceled
  expect(router.currentRoute.value.path).toBe('/categories/one')
  expect(nameInput().value).toBe('Mock draft name')
  const accepted = router.push('/categories/two')
  await decision(true)
  await accepted
  expect(router.currentRoute.value.path).toBe('/categories/two')
  expect(nameInput().value).toBe('')
})
it('guards switching and filtering the embedded workbench without clearing on cancel', async () => {
  await mount('/categories')
  await fill()
  host.querySelectorAll<HTMLButtonElement>('.case-select-row')[1]!.click()
  await decision(false)
  expect(nameInput().value).toBe('Mock draft name')
  expect(host.querySelector('.case-select-row.selected')?.textContent).toContain('Mock one')
  const search = host.querySelector<HTMLInputElement>('#category-search')!
  search.value = 'two'
  search.dispatchEvent(new Event('input', { bubbles: true }))
  await decision(false)
  expect(search.value).toBe('')
  expect(nameInput().value).toBe('Mock draft name')
  host.querySelectorAll<HTMLButtonElement>('.case-select-row')[1]!.click()
  await decision(true)
  await nextTick()
  expect(nameInput().value).toBe('')
  expect(host.querySelector('.case-select-row.selected')?.textContent).toContain('Mock two')
})
it('protects date overrides even without text input and preserves the edit entry', async () => {
  const router = await mount()
  expect(host.querySelector('a[href="/categories/one/edit"]')?.textContent?.trim()).toBe('繼續編輯')
  const toggle = host.querySelector<HTMLInputElement>('[role="switch"]')!
  toggle.checked = true
  toggle.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
  const navigation = router.push('/away')
  await decision(false)
  await navigation
  expect(toggle.checked).toBe(true)
})
it('still clears values and refresh protection on logout', async () => {
  await mount()
  await fill()
  mocks.session.authenticated = false
  await nextTick()
  expect(nameInput().value).toBe('')
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
})

it.each(['/categories/one', '/categories'])(
  'asks before logout at %s and keeps the session and draft on cancel',
  async (path) => {
    const router = await mount(path, true)
    await fill()
    const logout = host.querySelector<HTMLButtonElement>('.desktop-sidebar button')!
    logout.click()
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('離開工作台？'))
    expect(mocks.session.logout).not.toHaveBeenCalled()
    await decision(false)
    expect(mocks.session.logout).not.toHaveBeenCalled()
    expect(mocks.session.authenticated).toBe(true)
    expect(nameInput().value).toBe('Mock draft name')
    logout.click()
    await decision(true)
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('login'))
    expect(mocks.session.logout).toHaveBeenCalledTimes(1)
    expect(mocks.session.authenticated).toBe(false)
  },
)
it.each(['/categories/one', '/categories', '/away'])(
  'logs out immediately at %s without a draft or leave handler',
  async (path) => {
    const router = await mount(path, true)
    host.querySelector<HTMLButtonElement>('.desktop-sidebar button')!.click()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('login'))
    expect(dialog()).toBeNull()
    expect(mocks.session.logout).toHaveBeenCalledTimes(1)
  },
)
it('uses the shared danger modal to delete a category, with Escape and focus restoration', async () => {
  await mount()
  const opener = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === '刪除流程',
  )!
  opener.focus()
  opener.click()
  await nextTick()
  expect(dialog()?.textContent).toContain('刪除「Mock one」')
  expect(dialog()?.querySelector('.btn-danger')?.textContent).toContain('確定刪除')
  expect(dialog()?.parentElement?.classList.contains('fixed')).toBe(true)
  expect(dialog()?.contains(document.activeElement)).toBe(true)
  document.activeElement!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  )
  await nextTick()
  expect(dialog()).toBeNull()
  expect(document.activeElement).toBe(opener)
})
