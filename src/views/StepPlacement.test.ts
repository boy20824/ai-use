// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import type { CaseCategory } from '@/types/domain'
import CategoryView from './CategoryView.vue'

const mocks = vi.hoisted(() => ({
  category: null as CaseCategory | null,
  library: [] as { id: string; fileName: string; placeholders: string[] }[],
  render: vi.fn<(bytes: Uint8Array, values: Record<string, string>) => Uint8Array>(
    () => new Uint8Array(),
  ),
  download: vi.fn(),
}))
vi.mock('@/stores/categories', () => ({
  useCategoryStore: () => ({ byId: () => mocks.category, ready: true }),
}))
vi.mock('@/stores/templates', () => ({
  useTemplateStore: () => ({
    get items() {
      return mocks.library
    },
    byId: (id: string) => mocks.library.find((item) => item.id === id),
    bytesFor: async () => new Uint8Array(),
  }),
}))
vi.mock('@/stores/session', () => ({
  useSessionStore: () => ({
    authenticated: true,
    canEditCategory: false,
    canDeleteCategory: false,
  }),
}))
vi.mock('@/services/docxTemplates', () => ({
  renderDocx: mocks.render,
  zipGeneratedFiles: vi.fn(),
  templateMimeType: 'mock/docx',
}))
vi.mock('@/utils/download', () => ({ downloadBytes: mocks.download }))
let app: App
let host: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-10T16:30:00Z'))
  mocks.category = reactive({
    id: 'mock',
    name: 'Mock',
    summary: '',
    updatedAt: '',
    templateCount: 4,
    builtinFields: { 姓名: false },
    fields: [],
    steps: [
      { id: 's1', body: 'Mock 第一步', templateIds: [] },
      { id: 's2', body: 'Mock 第二步', templateIds: ['a', 'dup'] },
      { id: 's3', body: 'Mock 第三步', templateIds: [] },
      { id: 's4', body: 'Mock 第四步', templateIds: [] },
      { id: 's5', body: 'Mock 第五步', templateIds: ['b'], canRunInParallel: true },
      { id: 'hidden', body: 'Mock 未選模組步驟', templateIds: ['hidden'] },
    ],
    baseSteps: ['s1', 's2', 's3', 's4', 's5'].map((stepId, sortOrder) => ({ stepId, sortOrder })),
    modules: [
      {
        id: 'module',
        categoryId: 'mock',
        name: 'Mock 情境',
        sortOrder: 0,
        steps: [{ stepId: 'hidden', sortOrder: 0 }],
      },
    ],
  })
  mocks.library = reactive([
    { id: 'a', fileName: 'a.docx', placeholders: ['被害人姓名', '案由', '姓名', '日期', '年'] },
    { id: 'dup', fileName: 'dup.docx', placeholders: ['案由', '被害人姓名', '日期_民國'] },
    { id: 'b', fileName: 'b.docx', placeholders: ['案由', '日期_民國', '月', '日'] },
    { id: 'hidden', fileName: 'hidden.docx', placeholders: ['隱藏必填'] },
    { id: 'temporary', fileName: 'temporary.docx', placeholders: ['案由'] },
  ])
  vi.clearAllMocks()
})
afterEach(() => {
  app?.unmount()
  host?.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
async function mount() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/categories/:id', component: CategoryView },
      { path: '/categories', component: { render: () => h('div') } },
    ],
  })
  await router.push('/categories/mock')
  host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(RouterView) }).use(router)
  app.mount(host)
  await nextTick()
  return router
}
function main(id: string) {
  return [...host.querySelectorAll('.fixed-step')].find(
    (el) => el.querySelector('h3')?.textContent?.trim() === `Mock 第${id}步`,
  )!
}
function field(root: ParentNode, name: string) {
  return root.querySelector<HTMLInputElement>(`[data-field-key="${name}"] input`)!
}
function button(root: ParentNode, label: string) {
  return [...root.querySelectorAll('button')].find((el) => el.textContent?.trim() === label)!
}
async function fill(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}
async function click(root: ParentNode, label: string) {
  button(root, label).click()
  await nextTick()
}

it('places deduplicated first-occurrence fields in their step, with only Taipei ROC today above (1,4,6)', async () => {
  await mount()
  const base = host.querySelector('.basic-data-row')!
  expect(
    [...base.querySelectorAll('[data-field-key]')].map((el) => el.getAttribute('data-field-key')),
  ).toEqual(['日期'])
  expect([...base.querySelectorAll<HTMLSelectElement>('select')].map((el) => el.value)).toEqual([
    '115',
    '11',
    '11',
  ])
  expect(
    [...main('二').querySelectorAll('[data-field-key]')].map((el) =>
      el.getAttribute('data-field-key'),
    ),
  ).toEqual(['被害人姓名', '案由', '姓名'])
  expect(field(main('五'), '被害人姓名')).toBeNull()
  expect(main('二').querySelector('h4')?.textContent).toBe('本步驟欄位')
  expect(main('二').querySelector('select')).toBeNull()
  expect(host.textContent).not.toContain('編輯流程')
})
it('synchronizes shared mock data in both directions including parallel work, labels steps 2/5 and renders both documents (3)', async () => {
  await mount()
  const parallel = host.querySelector('.parallel-work-item')!
  await fill(field(main('二'), '被害人姓名'), '王小明（Mock）')
  await fill(field(main('二'), '姓名'), '<script>Mock</script>')
  await fill(field(main('五'), '案由'), '詐欺（Mock）')
  expect(field(main('二'), '案由').value).toBe('詐欺（Mock）')
  expect(field(parallel, '案由').value).toBe('詐欺（Mock）')
  expect(main('二').textContent).toContain('共用：步驟 2、5')
  expect(parallel.textContent).toContain('共用：步驟 2、5')
  await fill(field(parallel, '案由'), '更新（Mock）')
  expect(field(main('五'), '案由').value).toBe('更新（Mock）')
  await fill(field(main('五'), '案由'), '詐欺（Mock）')
  await click(main('二'), '產生')
  await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1))
  await click(parallel, '產生')
  await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(2))
  expect(mocks.render.mock.calls.map((call) => call[1]['案由'])).toEqual([
    '詐欺（Mock）',
    '詐欺（Mock）',
  ])
  expect(mocks.render.mock.calls[0]![1]).toMatchObject({
    被害人姓名: '王小明（Mock）',
    日期: '115年11月11日',
  })
  expect(host.querySelector('script')).toBeNull()
  expect(field(main('二'), '姓名').value).toBe('<script>Mock</script>')
})
it('deduplicates missing prompts in a step and overview; clicking either focuses the first occurrence (8)', async () => {
  await mount()
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
  expect(main('二').querySelectorAll('p button')).toHaveLength(3)
  await click(main('五'), '案由')
  expect(document.activeElement).toBe(field(main('二'), '案由'))
  expect(scroll).toHaveBeenCalledOnce()
  await click(host, '全部文件總覽')
  const overview = host.querySelector('#panel-overview')!
  expect(
    [...overview.querySelectorAll('p button')].filter((el) => el.textContent?.trim() === '案由'),
  ).toHaveLength(1)
  await click(overview, '案由')
  expect(host.querySelector('#panel-steps')).not.toBeNull()
  expect(document.activeElement).toBe(field(main('二'), '案由'))
  expect(scroll).toHaveBeenCalledTimes(2)
})
it('focuses a missing top date and opens its collapsed details from overview (6,8)', async () => {
  await mount()
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
  const year = host.querySelector<HTMLSelectElement>('.basic-data-row select')!
  year.value = ''
  year.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
  host.querySelector<HTMLDetailsElement>('.basic-data-row details')!.open = false
  await click(host, '全部文件總覽')
  await click(host.querySelector('#panel-overview')!, '日期')
  expect(document.activeElement).toBe(host.querySelector('.basic-data-row select'))
  expect(host.querySelector<HTMLDetailsElement>('.basic-data-row details')!.open).toBe(true)
})
it('shows explicit base fields and restored built-in name above, preserves entered values on configuration reload (5,9)', async () => {
  await mount()
  await fill(field(main('二'), '被害人姓名'), '王小明（Mock）')
  mocks.category!.fields!.push({ id: 'unit', key: '承辦單位', type: 'text', scope: 'base' })
  await nextTick()
  await fill(field(host.querySelector('.basic-data-row')!, '承辦單位'), 'Mock 單位')
  mocks.category!.builtinFields!['姓名'] = true
  await nextTick()
  expect(field(main('二'), '姓名')).toBeNull()
  await fill(field(host.querySelector('.basic-data-row')!, '姓名'), 'Mock 姓名')
  mocks.category!.builtinFields!['姓名'] = false
  await nextTick()
  expect(field(main('二'), '姓名').value).toBe('Mock 姓名')
  expect(field(main('二'), '被害人姓名').value).toBe('王小明（Mock）')
  mocks.category!.fields!.push({ id: 'name', key: '姓名', type: 'text', scope: 'base' })
  await nextTick()
  expect(field(main('二'), '姓名')).toBeNull()
  expect(field(host.querySelector('.basic-data-row')!, '姓名').value).toBe('Mock 姓名')
})
it('hides unselected module fields without blocking generation and shares temporarily added tags (7)', async () => {
  await mount()
  expect(host.textContent).not.toContain('隱藏必填')
  await fill(field(main('二'), '被害人姓名'), '王小明（Mock）')
  await fill(field(main('二'), '姓名'), 'Mock')
  await fill(field(main('五'), '案由'), '詐欺（Mock）')
  expect(button(main('二'), '產生').disabled).toBe(false)
  const module = host.querySelector<HTMLInputElement>('[aria-label="情境模組選擇"] input')!
  module.checked = true
  module.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
  expect(host.querySelector('[data-field-key="隱藏必填"]')).not.toBeNull()
  module.checked = false
  module.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
  expect(host.querySelector('[data-field-key="隱藏必填"]')).toBeNull()
  expect(button(main('二'), '產生').disabled).toBe(false)
  await click(host, '全部文件總覽')
  await click(host, '從範本庫選取')
  const choice = [...host.querySelectorAll('label')]
    .find((el) => el.textContent?.includes('temporary.docx'))!
    .querySelector('input')!
  choice.checked = true
  choice.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
  const temp = host.querySelector('[aria-label="本次暫加"]')!
  expect(field(temp, '案由').value).toBe('詐欺（Mock）')
  await fill(field(temp, '案由'), '暫加共用（Mock）')
  await click(host, '範本步驟')
  expect(field(main('二'), '案由').value).toBe('暫加共用（Mock）')
  expect(host.textContent).not.toContain('隱藏必填')
})
