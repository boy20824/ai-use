// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import TemplatesView from './TemplatesView.vue'

const mocks = vi.hoisted(() => ({
  pdf: false,
  previewPdf: vi.fn(async () => {}),
  canUpload: false,
  canDelete: false,
  bytesFor: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
  downloadBytes: vi.fn(),
}))
vi.mock('@/services/pdfPreview', () => ({ previewPdf: mocks.previewPdf }))
vi.mock('@/utils/download', () => ({ downloadBytes: mocks.downloadBytes }))
vi.mock('@/stores/session', () => ({ useSessionStore: () => mocks }))
vi.mock('@/stores/categories', () => ({
  useCategoryStore: () => ({
    items: [
      { id: 'criminal', name: '刑事類別', group: 'criminal' },
      { id: 'admin', name: '行政類別', group: 'admin' },
    ],
    byId: (id: string) => ({ id, name: id, group: id }),
  }),
}))
vi.mock('@/stores/templates', () => ({
  useTemplateStore: () => ({
    ready: true,
    total: 3,
    bytesFor: mocks.bytesFor,
    items: [
      {
        id: 'one',
        fileName: '刑事文件.docx',
        placeholders: ['姓名'],
        usages: [
          { categoryId: 'criminal', categoryName: '刑事類別', stepId: 's1', stepBody: '受理' },
        ],
      },
      {
        id: 'two',
        fileName: '行政文件.docx',
        placeholders: ['文號'],
        usages: [{ categoryId: 'admin', categoryName: '行政類別', stepId: 's2', stepBody: '登錄' }],
      },
      {
        id: 'three',
        fileName: mocks.pdf ? '作業規定（Mock）.pdf' : '未連結.docx',
        kind: mocks.pdf ? 'pdf' : 'docx',
        mimeType: mocks.pdf ? 'application/pdf' : undefined,
        placeholders: [],
        usages: [],
      },
    ].map((item) => ({ ...item, sizeBytes: 1024, addedAt: '2026-11-07T00:00:00Z' })),
  }),
}))
let app: App | undefined
let host: HTMLDivElement
async function mount() {
  host = document.createElement('div')
  document.body.append(host)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/templates', component: TemplatesView }],
  })
  await router.push('/templates')
  await router.isReady()
  app = createApp({ render: () => h(TemplatesView) }).use(router)
  app.mount(host)
  await nextTick()
  return router
}
afterEach(() => {
  app?.unmount()
  host?.remove()
  mocks.pdf = false
  mocks.canUpload = false
  mocks.canDelete = false
  vi.clearAllMocks()
})
const rows = () => host.querySelectorAll('tbody tr')
it('combines real filename/field search, group tabs, and the existing route filter', async () => {
  const router = await mount()
  expect(rows()).toHaveLength(3)
  const search = host.querySelector('#template-search') as HTMLInputElement
  search.value = '文號'
  search.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  expect(rows()).toHaveLength(1)
  expect(rows()[0]?.textContent).toContain('行政文件.docx')
  search.value = ''
  search.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  const criminal = [...host.querySelectorAll('[role="tab"]')].find(
    (el) => el.textContent?.trim() === '刑案',
  ) as HTMLButtonElement
  criminal.click()
  await nextTick()
  expect(rows()).toHaveLength(1)
  expect(rows()[0]?.textContent).toContain('刑事文件.docx')
  await router.replace('/templates?category=admin')
  await nextTick()
  expect(rows()).toHaveLength(0)
  expect(host.textContent).toContain('沒有符合的範本')
  const clear = [...host.querySelectorAll('button')].find(
    (el) => el.textContent?.trim() === '看全部範本',
  )!
  clear.click()
  await vi.waitFor(() => expect(rows()).toHaveLength(3))
})
it('downloads the selected original template and hides maintenance controls for readers', async () => {
  await mount()
  expect(host.querySelector('input[type="file"]')).toBeNull()
  expect(host.textContent).not.toContain('替換')
  expect(host.querySelector('[aria-label^="移除"]')).toBeNull()
  ;(host.querySelector('[aria-label="下載 刑事文件.docx"]') as HTMLButtonElement).click()
  await vi.waitFor(() => expect(mocks.downloadBytes).toHaveBeenCalledOnce())
  expect(mocks.bytesFor).toHaveBeenCalledWith('one')
  expect(mocks.downloadBytes).toHaveBeenCalledWith(
    new Uint8Array([1, 2, 3]),
    '刑事文件.docx',
    expect.stringContaining('wordprocessingml'),
  )
})
it('keeps upload, replacement, and deletion available to authorized users', async () => {
  mocks.canUpload = true
  mocks.canDelete = true
  await mount()
  expect(host.querySelector('input[type="file"]')).not.toBeNull()
  expect(host.textContent).toContain('替換')
  expect(host.querySelectorAll('[aria-label^="移除"]')).toHaveLength(3)
})

it('shows PDF badges and reference actions and downloads the original PDF name and MIME', async () => {
  mocks.pdf = true
  await mount()
  const row = rows()[2]!
  expect(row.textContent).toContain('PDF')
  expect(row.textContent).toContain('參考文件')
  const preview = [...row.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === '預覽',
  )!
  preview.click()
  await vi.waitFor(() => expect(mocks.previewPdf).toHaveBeenCalledWith('three'))
  row.querySelector<HTMLButtonElement>('[aria-label^="下載"]')!.click()
  await vi.waitFor(() =>
    expect(mocks.downloadBytes).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
      '作業規定（Mock）.pdf',
      'application/pdf',
    ),
  )
  expect(rows()[0]?.textContent).toContain('Word')
})
