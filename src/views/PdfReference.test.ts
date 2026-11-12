// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import JSZip from 'jszip'
import CategoryView from './CategoryView.vue'
import type { CaseCategory } from '@/types/domain'
import type { TemplateSummary } from '@/storage'
import { buildMockPdf } from '../../shared/mockPdfFixture'
import { buildDocx, paragraph, run, wordDocument } from '../../shared/docxFixture'

const mocks = vi.hoisted(() => ({
  category: null as CaseCategory | null,
  library: [] as (TemplateSummary & { data: Uint8Array })[],
  downloadBytes: vi.fn(),
  downloadBlob: vi.fn(),
  previewPdf: vi.fn(async () => {}),
  bytesFor: vi.fn(),
}))
vi.mock('@/stores/categories', () => ({
  useCategoryStore: () => ({ ready: true, byId: () => mocks.category }),
}))
vi.mock('@/stores/session', () => ({
  useSessionStore: () => ({
    authenticated: true,
    canEditCategory: false,
    canDeleteCategory: false,
  }),
}))
vi.mock('@/stores/templates', () => ({
  useTemplateStore: () => ({
    get items() {
      return mocks.library
    },
    byId: (id: string) => mocks.library.find((item) => item.id === id),
    bytesFor: mocks.bytesFor,
  }),
}))
vi.mock('@/utils/download', () => ({
  downloadBytes: mocks.downloadBytes,
  downloadBlob: mocks.downloadBlob,
}))
vi.mock('@/services/pdfPreview', () => ({ previewPdf: mocks.previewPdf }))
let app: App | undefined
let host: HTMLDivElement
async function mount(mixed = false) {
  const pdf: TemplateSummary & { data: Uint8Array } = {
    kind: 'pdf',
    id: 'mock-pdf',
    fileName: '作業規定（Mock）.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 0,
    addedAt: '',
    placeholders: ['MockIgnored'],
    origin: 'upload',
    usages: [],
    data: buildMockPdf(),
  }
  const word = (id: string) => ({
    ...pdf,
    id,
    kind: 'docx' as const,
    fileName: `${id}.docx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    placeholders: ['MockField'],
    data: buildDocx({ document: wordDocument(paragraph(run('', '{{MockField}}'))) }),
  })
  mocks.library = mixed ? [pdf, word('mock-word-a'), word('mock-word-b')] : [pdf]
  mocks.bytesFor.mockImplementation(async (id: string) => {
    const data = mocks.library.find((item) => item.id === id)?.data
    return data ? new Uint8Array(data).buffer : null
  })
  mocks.category = {
    id: 'mock',
    name: 'Mock',
    summary: '',
    updatedAt: '',
    templateCount: mocks.library.length,
    builtinFields: { 姓名: false },
    fields: [],
    steps: [
      {
        id: 'mock-step',
        body: 'Mock step',
        templateIds: mocks.library.map((item) => item.id),
        canRunInParallel: true,
      },
    ],
    baseSteps: [{ stepId: 'mock-step', sortOrder: 0 }],
  }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/categories/:id', component: CategoryView }],
  })
  await router.push('/categories/mock')
  host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(CategoryView) }).use(router)
  app.mount(host)
  await nextTick()
}
const buttons = (root: ParentNode) => [...root.querySelectorAll('button')]
const button = (root: ParentNode, label: string) =>
  buttons(root).find((item) => item.textContent?.trim() === label)!
afterEach(() => {
  app?.unmount()
  host?.remove()
  vi.clearAllMocks()
})
it('keeps a PDF-only step in reference areas with no generated documents or missing fields', async () => {
  await mount()
  const step = host.querySelector('.fixed-step')!
  const parallel = host.querySelector('#parallel-work')!
  for (const region of [step, parallel]) {
    expect(region.querySelector('[aria-label="參考文件"]')?.textContent).toContain(
      '作業規定（Mock）.pdf',
    )
    expect(region.textContent).not.toMatch(/產出文件|請先填寫|沒有偵測到欄位|這個步驟還沒有範本/)
    expect(buttons(region).some((item) => item.textContent?.includes('產生'))).toBe(false)
    expect(region.querySelector('[aria-label="本步驟欄位"]')).toBeNull()
  }
  expect(mocks.bytesFor).not.toHaveBeenCalled()
  button(step, '預覽').click()
  await vi.waitFor(() => expect(mocks.previewPdf).toHaveBeenCalledWith('mock-pdf'))
  button(step, '下載').click()
  await vi.waitFor(() =>
    expect(mocks.downloadBytes).toHaveBeenCalledWith(
      buildMockPdf(),
      '作業規定（Mock）.pdf',
      'application/pdf',
    ),
  )
  host.querySelector<HTMLButtonElement>('#tab-overview')!.click()
  await nextTick()
  const overview = host.querySelector('#panel-overview')!
  expect(overview.querySelector('[aria-label="參考文件"]')).not.toBeNull()
  expect(overview.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
  expect(button(overview, '產生勾選文件').disabled).toBe(true)
  expect(overview.textContent).not.toContain('MockIgnored')
  expect(mocks.downloadBlob).not.toHaveBeenCalled()
})
it('generates Word only for single, step ZIP, and overview ZIP actions with a PDF attached', async () => {
  await mount(true)
  const step = host.querySelector('.fixed-step')!
  const field = step.querySelector<HTMLInputElement>('input[type="text"]')!
  field.value = 'Mock value'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  expect(step.textContent).not.toContain('MockIgnored')
  expect(step.querySelectorAll('.step-template-list li')).toHaveLength(2)
  button(step, '產生').click()
  await vi.waitFor(() => expect(mocks.downloadBytes).toHaveBeenCalledOnce())
  expect(mocks.downloadBytes.mock.calls[0]![1]).toBe('產生-mock-word-a.docx')
  button(step, '產生本步驟全部').click()
  await vi.waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledOnce())
  const assertWordZip = async (index: number) => {
    const blob = mocks.downloadBlob.mock.calls[index]![0] as Blob
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files).sort()).toEqual([
      '產生-mock-word-a.docx',
      '產生-mock-word-b.docx',
    ])
  }
  await assertWordZip(0)
  host.querySelector<HTMLButtonElement>('#tab-overview')!.click()
  await nextTick()
  const overview = host.querySelector('#panel-overview')!
  expect(overview.querySelectorAll('input[type="checkbox"]')).toHaveLength(2)
  button(overview, '產生勾選文件').click()
  await vi.waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledTimes(2))
  await assertWordZip(1)
  expect(mocks.bytesFor.mock.calls.every(([id]) => id !== 'mock-pdf')).toBe(true)
})
