// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import CombinationOrderEditor from './CombinationOrderEditor.vue'
import type { CaseCategory } from '@/types/domain'
const mocks = vi.hoisted(() => ({ request: vi.fn(), reload: vi.fn(async () => {}) }))
vi.mock('@/services/api', () => ({
  apiRequest: mocks.request,
  apiErrorMessage: async () => '儲存失敗',
}))
vi.mock('@/stores/categories', () => ({ useCategoryStore: () => ({ reload: mocks.reload }) }))
const refs = (ids: string) => [...ids].map((stepId, sortOrder) => ({ stepId, sortOrder }))
function fixture(): CaseCategory {
  return {
    id: 'mock',
    name: 'Mock',
    summary: '',
    updatedAt: '',
    templateCount: 0,
    steps: [...'ABCDJ'].map((id) => ({ id, title: id, body: id, templateIds: [] })),
    baseSteps: refs('ABC'),
    modules: [
      { id: 'alcohol', categoryId: 'mock', name: '酒駕', sortOrder: 0, steps: refs('D') },
      { id: 'arrest', categoryId: 'mock', name: '現行犯', sortOrder: 1, steps: refs('J') },
    ],
  }
}
let app: App | undefined
let host: HTMLDivElement
async function mount(config = fixture()) {
  mocks.request.mockResolvedValue(new Response('{}', { status: 200 }))
  const category = ref(config)
  host = document.createElement('div')
  document.body.append(host)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/edit/:id',
        component: { render: () => h(CombinationOrderEditor, { category: category.value }) },
      },
      { path: '/away', component: { template: '<p>Away</p>' } },
    ],
  })
  await router.push('/edit/mock')
  app = createApp({ render: () => h(RouterView) })
  app.use(router)
  app.mount(host)
  await router.isReady()
  await nextTick()
  return { router, category }
}
function button(label: string) {
  const found = [...host.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label,
  )
  if (!found) throw new Error(`Missing ${label}`)
  return found
}
async function toggle(label: string) {
  const input = host.querySelector(`[aria-label="組合：${label}"]`) as HTMLInputElement
  input.checked = !input.checked
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
  return input
}
const order = () =>
  [...host.querySelectorAll('[data-step-id]')].map((li) => li.getAttribute('data-step-id')).join('')
const saveLabel = '儲存為這組情境搭配的預設順序'
function dragEvent(type: string, dataTransfer: object) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  return event
}
afterEach(() => {
  app?.unmount()
  host?.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})
it('drags across sources, saves only IDs explicitly, reloads the same normalized combination', async () => {
  const { category } = await mount()
  await toggle('酒駕')
  await toggle('現行犯')
  expect(order()).toBe('ABCDJ')
  expect(host.querySelector('[data-step-id="A"]')?.textContent).toContain('來源：基本 SOP')
  expect(host.querySelector('[data-step-id="D"]')?.textContent).toContain('來源：酒駕')
  const dataTransfer = { setData: vi.fn(), effectAllowed: 'uninitialized' }
  host.querySelector('[data-step-id="D"]')!.dispatchEvent(dragEvent('dragstart', dataTransfer))
  expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'D')
  expect(dataTransfer.effectAllowed).toBe('move')
  host
    .querySelector('[data-step-id="B"]')!
    .dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
  await nextTick()
  button('J：上移').click()
  await nextTick()
  expect(order()).toBe('ADBJC')
  expect(host.textContent).toContain('順序尚未儲存')
  expect(mocks.request).not.toHaveBeenCalled()
  button(saveLabel).click()
  await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledOnce())
  expect(mocks.request).toHaveBeenCalledExactlyOnceWith('/api/categories/mock/combination-order', {
    method: 'PUT',
    body: JSON.stringify({ moduleIds: ['alcohol', 'arrest'], stepIds: [...'ADBJC'] }),
  })
  category.value = {
    ...category.value,
    combinationOrders: [{ moduleIds: ['alcohol', 'arrest'], stepIds: [...'ADBJC'] }],
  }
  await nextTick()
  expect(host.textContent).toContain('順序無未儲存調整')
  await toggle('酒駕')
  await toggle('現行犯')
  await toggle('現行犯')
  await toggle('酒駕')
  expect(order()).toBe('ADBJC')
  app?.unmount()
  app = undefined
  host.remove()
  await mount(category.value)
  await toggle('現行犯')
  await toggle('酒駕')
  expect(order()).toBe('ADBJC')
})
it('ignores external drop payloads and clears the local drag when it ends or drops', async () => {
  await mount()
  const first = host.querySelector('[data-step-id="A"]')!
  const last = host.querySelector('[data-step-id="C"]')!
  const external = { getData: vi.fn(() => 'C') }
  first.dispatchEvent(dragEvent('drop', external))
  await nextTick()
  expect(order()).toBe('ABC')
  last.dispatchEvent(new Event('dragstart', { bubbles: true }))
  last.dispatchEvent(new Event('dragend', { bubbles: true }))
  first.dispatchEvent(dragEvent('drop', external))
  await nextTick()
  expect(order()).toBe('ABC')
  last.dispatchEvent(new Event('dragstart', { bubbles: true }))
  first.dispatchEvent(dragEvent('drop', external))
  await nextTick()
  expect(order()).toBe('CAB')
  last.dispatchEvent(dragEvent('drop', external))
  await nextTick()
  expect(order()).toBe('CAB')
  expect(external.getData).not.toHaveBeenCalled()
  expect(mocks.request).not.toHaveBeenCalled()
})
it('guards combination switching, route leave/update and browser unload; permits explicit discard', async () => {
  const { router } = await mount()
  button('B：上移').click()
  await nextTick()
  const confirm = vi.fn(() => false)
  vi.stubGlobal('confirm', confirm)
  const input = await toggle('酒駕')
  expect(input.checked).toBe(false)
  expect(order()).toBe('BAC')
  await router.push('/away')
  expect(router.currentRoute.value.path).toBe('/edit/mock')
  await router.push('/edit/other')
  expect(router.currentRoute.value.path).toBe('/edit/mock')
  const unload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(unload)
  expect(unload.defaultPrevented).toBe(true)
  expect(confirm).toHaveBeenCalledTimes(3)
  confirm.mockReturnValue(true)
  await toggle('酒駕')
  expect(order()).toBe('ABCD')
  expect(host.textContent).toContain('順序無未儲存調整')
  await router.push('/away')
  expect(router.currentRoute.value.path).toBe('/away')
})
it('preserves dirty state on failed saves, supports base-only and warns on stale configurations', async () => {
  const config = fixture()
  config.combinationOrders = [{ moduleIds: [], stepIds: [...'AXBC'] }]
  await mount(config)
  expect(order()).toBe('ABC')
  expect(host.textContent).toContain('失效步驟已忽略')
  mocks.request.mockResolvedValue(new Response('{}', { status: 400 }))
  button('C：上移').click()
  await nextTick()
  button(saveLabel).click()
  await vi.waitFor(() =>
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('儲存失敗'),
  )
  expect(host.textContent).toContain('順序尚未儲存')
  mocks.request.mockResolvedValue(new Response('{}', { status: 200 }))
  button(saveLabel).click()
  await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledOnce())
  expect(mocks.request).toHaveBeenLastCalledWith('/api/categories/mock/combination-order', {
    method: 'PUT',
    body: JSON.stringify({ moduleIds: [], stepIds: [...'ACB'] }),
  })
})

it('retains the exact parallel hint when reopening the saved combination preview', async () => {
  const config = fixture()
  config.steps.find((step) => step.id === 'D')!.canRunInParallel = true
  config.combinationOrders = [{ moduleIds: ['alcohol'], stepIds: [...'DABC'] }]
  await mount(config)
  expect(host.textContent).not.toContain('此步驟可請其他人同步進行')
  await toggle('酒駕')
  expect(order()).toBe('DABC')
  expect(host.querySelector('[data-step-id="D"]')?.textContent).toContain(
    '此步驟可請其他人同步進行',
  )
  expect(host.querySelector('[data-step-id="A"]')?.textContent).not.toContain(
    '此步驟可請其他人同步進行',
  )
  app?.unmount()
  app = undefined
  host.remove()
  await mount(config)
  await toggle('酒駕')
  expect(host.querySelector('[data-step-id="D"]')?.textContent).toContain(
    '此步驟可請其他人同步進行',
  )
  expect(order()).toBe('DABC')
})
