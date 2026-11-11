// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import type { CaseCategory } from '@/types/domain'
import CategoryView from './CategoryView.vue'

const mocks = vi.hoisted(() => ({
  category: null as CaseCategory | null,
  session: {
    authenticated: true,
    canEditCategory: false,
    canDeleteCategory: false,
    restore: async () => {},
  },
  download: vi.fn(),
  render: vi.fn<(bytes: Uint8Array, values: Record<string, string>) => Uint8Array>(
    () => new Uint8Array(),
  ),
  bytesFor: vi.fn(async () => new Uint8Array()),
}))
vi.mock('@/stores/categories', () => ({
  useCategoryStore: () => ({ byId: () => mocks.category, ready: true }),
}))
vi.mock('@/stores/session', () => ({ useSessionStore: () => mocks.session }))
vi.mock('@/stores/templates', () => ({
  useTemplateStore: () => ({
    items: [],
    byId: (id: string) => ({
      id,
      fileName: `${id}.docx`,
      placeholders: ['姓名', '日期_民國', '專屬值'],
    }),
    bytesFor: mocks.bytesFor,
  }),
}))
vi.mock('@/utils/download', () => ({ downloadBytes: mocks.download }))
vi.mock('@/services/docxTemplates', () => ({
  renderDocx: mocks.render,
  templateMimeType: 'test/docx',
  zipGeneratedFiles: vi.fn(),
}))

let app: App
let host: HTMLDivElement
const refs = (ids: string) => [...ids].map((stepId, sortOrder) => ({ stepId, sortOrder }))
beforeEach(() => {
  mocks.category = reactive({
    id: 'mock',
    builtinFields: { 姓名: true },
    name: 'Mock',
    summary: '',
    updatedAt: '',
    templateCount: 2,
    steps: [...'ABCDJ'].map((id) => ({
      id,
      body: id,
      title: id,
      templateIds: 'DJ'.includes(id) ? ['same'] : [],
      canRunInParallel: 'DJ'.includes(id),
      items: [`${id} 說明`],
      note: `${id} 注意事項`,
    })),
    baseSteps: refs('ABC'),
    modules: [
      { id: 'alcohol', categoryId: 'mock', name: '酒駕', sortOrder: 0, steps: refs('D') },
      { id: 'arrest', categoryId: 'mock', name: '現行犯', sortOrder: 1, steps: refs('DJ') },
    ],
    combinationOrders: [{ moduleIds: ['alcohol', 'arrest'], stepIds: [...'ADBCJ'] }],
  })
  mocks.session = reactive({
    authenticated: true,
    canEditCategory: false,
    canDeleteCategory: false,
    restore: async () => {},
  })
  vi.clearAllMocks()
})
afterEach(() => {
  app?.unmount()
  host?.remove()
  vi.restoreAllMocks()
})
async function mount() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/categories/:id', component: CategoryView }],
  })
  await router.push('/categories/mock')
  host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(RouterView) }).use(router)
  app.mount(host)
  await nextTick()
  return router
}
function region() {
  return host.querySelector<HTMLElement>('#parallel-work')!
}
function main(id: string) {
  return [...host.querySelectorAll<HTMLElement>('.fixed-step')].find(
    (row) => row.querySelector('h3')?.textContent?.trim() === id,
  )!
}
function item(id: string) {
  return [...region().querySelectorAll<HTMLElement>('.parallel-work-item')].find(
    (row) => row.querySelector('summary')?.textContent?.trim() === id,
  )!
}
async function check(element: HTMLInputElement, checked: boolean) {
  element.checked = checked
  element.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
}
async function select(id: string, checked = true) {
  await check(host.querySelector(`[aria-label="情境模組選擇"] input[value="${id}"]`)!, checked)
}
async function fill(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}
function handled(root: Element) {
  return root.querySelector<HTMLInputElement>('input[type="checkbox"]')!
}

it('shows empty state, selected-only stable deduped list and visible main hints (1–5, 11–12)', async () => {
  await mount()
  expect(region().textContent).toContain('此情境組合沒有可同步作業')
  expect(host.querySelector('.parallel-entry')?.textContent).toContain('可同步作業，共 0 項')
  await select('alcohol')
  expect(region().querySelectorAll('summary')).toHaveLength(1)
  expect(item('D')).toBeDefined()
  await select('arrest')
  expect([...host.querySelectorAll('.fixed-step h3')].map((el) => el.textContent?.trim())).toEqual([
    ...'ADBCJ',
  ])
  expect([...region().querySelectorAll('summary')].map((el) => el.textContent?.trim())).toEqual([
    'D',
    'J',
  ])
  for (const id of ['D', 'J']) {
    expect(main(id).classList.contains('parallel-step')).toBe(true)
    expect(main(id).querySelector('.parallel-hint')?.textContent).toContain('可請其他人同步處理')
    expect(main(id).querySelector('.parallel-hint svg[aria-hidden="true"]')).not.toBeNull()
    expect(item(id).querySelector('input[type="text"]')).not.toBeNull()
    expect(item(id).textContent).toContain(`${id} 說明`)
  }
  expect(handled(main('A')).checked).toBe(false)
  expect(host.textContent).not.toContain('編輯流程')
  expect(host.querySelector('input[aria-label*="canRunInParallel"]')).toBeNull()
})
it('shares values bidirectionally across collapse and tabs, shares identical tags and generates from either view (5–6)', async () => {
  await mount()
  await select('alcohol')
  await select('arrest')
  await fill(host.querySelector('#draft-0')!, 'Mock Person')
  await fill(item('D').querySelector('input[type="text"]')!, 'D only')
  expect(main('D').querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('D only')
  expect(item('J').querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('D only')
  await fill(main('D').querySelector('input[type="text"]')!, 'D updated')
  const details = item('D').querySelector('details')!
  details.open = true
  details.open = false
  details.open = true
  host.querySelector<HTMLButtonElement>('#tab-overview')!.click()
  await nextTick()
  host.querySelector<HTMLButtonElement>('#tab-steps')!.click()
  await nextTick()
  expect(item('D').querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('D updated')
  const produce = [...item('D').querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === '產生',
  )!
  expect(produce.disabled).toBe(false)
  produce.click()
  await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledOnce())
  expect(mocks.render.mock.calls[0]?.[1]).toMatchObject({
    姓名: 'Mock Person',
    專屬值: 'D updated',
  })
  expect(handled(main('D')).checked).toBe(false)
})
it('synchronizes reversible manual notes and a separate live count without advancing or completing the flow (7, 13)', async () => {
  await mount()
  await select('alcohol')
  await select('arrest')
  await check(handled(item('D')), true)
  expect(handled(main('D')).checked).toBe(true)
  expect(host.querySelector('.parallel-entry [aria-live="polite"]')?.textContent).toBe(
    '已處理 1／共 2',
  )
  expect(main('D').querySelector('h3')?.classList.contains('line-through')).toBe(false)
  await check(handled(main('D')), false)
  expect(handled(item('D')).checked).toBe(false)
  expect(host.querySelector('.parallel-entry [aria-live]')?.textContent).toBe('已處理 0／共 2')
  expect(host.querySelectorAll('.fixed-step')).toHaveLength(5)
  expect(host.querySelector('progress')).toBeNull()
  expect(handled(main('A')).checked).toBe(false)
  const scroll = vi.fn()
  region().scrollIntoView = scroll
  host.querySelector<HTMLButtonElement>('[aria-controls="parallel-work"]')!.click()
  expect(scroll).toHaveBeenCalledOnce()
  expect(document.activeElement).toBe(region())
  expect(region().getAttribute('role')).toBe('region')
  expect(region().getAttribute('aria-labelledby')).toBe('parallel-work-title')
  expect(item('D').querySelector('summary')?.classList.contains('focus-control')).toBe(true)
  expect(handled(item('D')).getAttribute('aria-label')).toBe('D：本次已處理')
})
it('clears exited notes, retains shared field values, and clears on case change and remount (8–9)', async () => {
  const localWrite = vi.spyOn(Storage.prototype, 'setItem')
  const router = await mount()
  await select('alcohol')
  await select('arrest')
  for (const id of ['D', 'J']) {
    await fill(item(id).querySelector('input[type="text"]')!, `${id} only`)
    await check(handled(item(id)), true)
  }
  await fill(host.querySelector('#draft-0')!, 'Shared')
  await select('arrest', false)
  expect(handled(item('D')).checked).toBe(true)
  expect(item('D').querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('J only')
  await select('arrest')
  expect(handled(item('J')).checked).toBe(false)
  expect(item('J').querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('J only')
  expect((host.querySelector('#draft-0') as HTMLInputElement).value).toBe('Shared')
  await router.push('/categories/other')
  await select('alcohol')
  expect(handled(item('D')).checked).toBe(false)
  expect(item('D').querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('')
  expect((host.querySelector('#draft-0') as HTMLInputElement).value).toBe('')
  await fill(item('D').querySelector('input[type="text"]')!, 'New')
  await check(handled(item('D')), true)
  app.unmount()
  host.remove()
  await mount()
  await select('alcohol')
  expect(handled(item('D')).checked).toBe(false)
  expect(item('D').querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('')
  expect(localWrite).not.toHaveBeenCalled()
})
it('clears in-memory notes and values on sign-out (12)', async () => {
  await mount()
  await select('alcohol')
  await fill(item('D').querySelector('input[type="text"]')!, 'Mock value')
  await check(handled(item('D')), true)
  mocks.session.authenticated = false
  await nextTick()
  expect(region().querySelectorAll('summary')).toHaveLength(0)
  mocks.session.authenticated = true
  await nextTick()
  await select('alcohol')
  expect(handled(item('D')).checked).toBe(false)
  expect(item('D').querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('')
})

it('keeps the production login and maintainer route guards (12)', async () => {
  const { router } = await import('@/router')
  mocks.session.authenticated = false
  await router.push('/categories/mock')
  expect(router.currentRoute.value.name).toBe('login')
  expect(router.currentRoute.value.query.redirect).toBe('/categories/mock')
  mocks.session.authenticated = true
  await router.push('/categories/mock/edit')
  expect(router.currentRoute.value.name).toBe('category')
})
