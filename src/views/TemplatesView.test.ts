// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import TemplatesView from './TemplatesView.vue'

vi.mock('vue', async (importOriginal) => {
  const vue = await importOriginal<typeof import('vue')>()
  return {
    ...vue,
    TransitionGroup: vue.defineComponent({
      props: { tag: { type: String, required: true }, name: String, appear: Boolean },
      setup:
        (props, { slots }) =>
        () =>
          vue.h(props.tag, slots.default?.()),
    }),
  }
})

const mocks = vi.hoisted(() => ({
  pdf: false,
  additionalCategoryCount: 0,
  previewPdf: vi.fn(async () => {}),
  canUpload: false,
  canDelete: false,
  bytesFor: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
  downloadBytes: vi.fn(),
  remove: vi.fn(async () => {}),
}))
vi.mock('@/services/pdfPreview', () => ({ previewPdf: mocks.previewPdf }))
vi.mock('@/utils/download', () => ({ downloadBytes: mocks.downloadBytes }))
vi.mock('@/stores/session', () => ({ useSessionStore: () => mocks }))
vi.mock('@/stores/categories', () => {
  const items = [
    { id: 'criminal', name: '刑事類別', group: 'criminal' },
    { id: 'admin', name: '行政類別', group: 'admin' },
  ]
  return {
    useCategoryStore: () => ({
      reload: vi.fn(async () => {}),
      items,
      byId: (id: string) => items.find((item) => item.id === id),
    }),
  }
})
vi.mock('@/stores/templates', () => ({
  useTemplateStore: () => ({
    ready: true,
    total: 3,
    bytesFor: mocks.bytesFor,
    remove: mocks.remove,
    items: [
      {
        id: 'one',
        fileName: '刑事文件.docx',
        placeholders: ['姓名'],
        usages: [
          { categoryId: 'criminal', categoryName: '舊刑事類別', stepId: 's1', stepBody: '受理' },
          ...[
            { categoryId: 'admin', categoryName: '行政類別', stepId: 's2', stepBody: '登錄' },
            { categoryId: 'civil', categoryName: '民事類別', stepId: 's3', stepBody: '送達' },
          ].slice(0, mocks.additionalCategoryCount),
          {
            categoryId: 'criminal',
            categoryName: '舊刑事類別',
            stepId: 's4',
            stepBody: '  複核\n  12345678901234567890123456  ',
          },
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
    routes: [
      { path: '/templates', component: TemplatesView },
      { path: '/categories/:id', component: { render: () => null } },
    ],
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
  mocks.additionalCategoryCount = 0
  mocks.canUpload = false
  mocks.canDelete = false
  vi.clearAllMocks()
})
const rows = () => host.querySelectorAll('tbody tr')
const usageCell = (row: number) => rows()[row]!.querySelector('.template-usages')!

it('shows 尚未使用 for an unused template and lists a single category directly', async () => {
  await mount()
  expect(usageCell(2).textContent?.trim()).toBe('尚未使用')
  const cell = usageCell(0)
  expect(cell.querySelector('details')).toBeNull()
  expect(cell.querySelectorAll('a')).toHaveLength(1)
  expect(cell.querySelector('a')?.getAttribute('href')).toBe('/categories/criminal')
  expect(cell.querySelector('a')?.textContent?.trim()).toBe('刑事類別')
})

it('lists two categories directly and groups shortened steps under their own category', async () => {
  mocks.additionalCategoryCount = 1
  await mount()
  const cell = usageCell(0)
  expect(cell.querySelector('details')).toBeNull()
  const groups = [...cell.querySelectorAll('li')]
  expect(
    groups.map((group) => [
      group.querySelector('a')?.getAttribute('href'),
      group.querySelector('a')?.textContent?.trim(),
      group.querySelector('p')?.textContent?.trim(),
    ]),
  ).toEqual([
    ['/categories/criminal', '刑事類別', '受理、複核 123456789012345678901…'],
    ['/categories/admin', '行政類別', '登錄'],
  ])
})

it('starts with a collapsed summary that counts distinct categories and contains every group', async () => {
  mocks.additionalCategoryCount = 2
  await mount()
  const cell = usageCell(0)
  const details = cell.querySelector('details')!
  const summary = details.querySelector('summary')!
  expect(details.open).toBe(false)
  expect(details.firstElementChild).toBe(summary)
  expect(summary.textContent?.trim()).toBe('3 個案件')
  expect(
    [...details.querySelectorAll('a')].map((link) => [
      link.getAttribute('href'),
      link.textContent?.trim(),
    ]),
  ).toEqual([
    ['/categories/criminal', '刑事類別'],
    ['/categories/admin', '行政類別'],
    ['/categories/civil', '民事類別'],
  ])
  expect(details.querySelector('li:last-child p')?.textContent?.trim()).toBe('送達')
  expect(cell.querySelectorAll('[id]')).toHaveLength(0)
})

it('hides the tab slider from accessibility and announces the current result count', async () => {
  await mount()
  const tablist = host.querySelector('[role="tablist"]')
  expect(tablist?.querySelector('span.tab-slider')?.getAttribute('aria-hidden')).toBe('true')

  const status = host.querySelector('p[role="status"]')
  expect(status?.querySelector('.count-roll')?.textContent).toBe('3')
  expect(status?.textContent?.trim()).toBe('顯示 3 筆')

  tablist?.querySelectorAll('button')[1]?.click()
  await nextTick()
  expect(status?.textContent?.trim()).toBe('顯示 1 筆')
})

it('immediately hides leaving rows and the upload sheen when reduced motion is requested', () => {
  expect(readFileSync('src/style.css', 'utf8')).toMatch(
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.templates-page \.row-leave-active,\s*\.templates-page \.compact-upload::after\s*\{\s*display:\s*none;/,
  )
})

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
  const category = host.querySelector<HTMLSelectElement>('#template-category')!
  category.value = 'admin'
  category.dispatchEvent(new Event('change', { bubbles: true }))
  await vi.waitFor(() => expect(rows()).toHaveLength(0))
  expect(router.currentRoute.value.query.category).toBe('admin')
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

it('uses the shared keyboard dialog for deletion, preserves existing loss copy, and cancels without deleting', async () => {
  mocks.canDelete = true
  await mount()
  const opener = host.querySelector<HTMLButtonElement>('[aria-label="移除 刑事文件.docx"]')!
  opener.focus()
  opener.click()
  await nextTick()
  const dialog = host.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain(
    '確定後會解除這些連結，並從範本庫刪除檔案。案件範本與步驟會保留。',
  )
  expect(dialog.textContent).toContain('受理')
  expect(dialog.contains(document.activeElement)).toBe(true)
  document.activeElement!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  )
  await nextTick()
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(opener)
  expect(mocks.remove).not.toHaveBeenCalled()
  opener.click()
  await nextTick()
  host.querySelector<HTMLButtonElement>('[role="dialog"] .btn-danger')!.click()
  await vi.waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('one'))
  await vi.waitFor(() => expect(host.querySelector('[role="dialog"]')).toBeNull())
})
