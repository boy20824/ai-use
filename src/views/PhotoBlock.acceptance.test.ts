// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { confirmedNavigation } from '@/test/confirmedNavigation'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import PizZip from 'pizzip'
import JSZip from 'jszip'
import CategoryView from './CategoryView.vue'
import { fieldDefaults } from '@/config/fieldDefaults'
import { buildPhotoTemplate } from '../../shared/photoTemplateFixture'
import { mockJpeg, mockPhotoDraft } from '../../shared/photoMock'
import { buildDocx, paragraph, run, wordDocument } from '../../shared/docxFixture'
import { decodeXml, docxZipLimits, listPlaceholders, readSafeZip } from '../../server/src/docxXml'
import type { BlockPhoto } from '../../shared/photoBlockRender'
import type { CaseCategory } from '@/types/domain'

const mocks = vi.hoisted(() => ({
  category: null as CaseCategory | null,
  library: [] as {
    id: string
    fileName: string
    placeholders: string[]
    sizeBytes: number
    data: Uint8Array
  }[],
  download: vi.fn(),
  zip: vi.fn(),
  read: vi.fn(),
}))
vi.mock('@/stores/categories', () => ({
  useCategoryStore: () => ({ byId: () => mocks.category, ready: true }),
}))
vi.mock('@/stores/session', () => ({
  useSessionStore: () => ({ authenticated: true, canEditCategory: false }),
}))
vi.mock('@/stores/templates', () => ({
  useTemplateStore: () => ({
    get items() {
      return mocks.library
    },
    byId: (id: string) => mocks.library.find((t) => t.id === id),
    bytesFor: async (id: string) => mocks.library.find((t) => t.id === id)?.data,
  }),
}))
vi.mock('@/utils/download', () => ({ downloadBytes: mocks.download, downloadBlob: mocks.zip }))
vi.mock('@/photos/files', () => ({ loadBlockPhoto: mocks.read }))
let app: App | undefined
let host: HTMLDivElement
const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}
async function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}
function labeled(root: ParentNode, name: string) {
  return [...root.querySelectorAll('label')]
    .find((label) => label.textContent?.trim() === name)!
    .querySelector('input,textarea') as HTMLInputElement
}
function button(root: ParentNode, name: string) {
  return [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)!
}
function xmlOf(bytes: Uint8Array) {
  return new PizZip(bytes).file('word/document.xml')!.asText()
}
function textOf(bytes: Uint8Array) {
  return [...xmlOf(bytes).matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)]
    .map((m) => decodeXml(m[1]!))
    .join('')
}
afterEach(() => {
  app?.unmount()
  host?.remove()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

async function mountPublicPhotoTemplate(fileName: string) {
  const data = new Uint8Array(readFileSync(`public/templates/${fileName}`))
  mocks.library = [
    { id: 'photo', fileName, data, sizeBytes: data.length, placeholders: listPlaceholders(data) },
  ]
  mocks.category = reactive({
    id: 'mock',
    name: 'Mock 照片驗收',
    summary: '',
    updatedAt: '',
    templateCount: 1,
    steps: [{ id: 'step', body: 'Mock 照片步驟', templateIds: ['photo'] }],
    baseSteps: [{ stepId: 'step', sortOrder: 0 }],
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/categories/:id', component: CategoryView }],
  })
  await confirmedNavigation(router, '/categories/mock')
  host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(RouterView) }).use(router)
  app.mount(host)
  return vi.waitFor(() => {
    const panel = host.querySelector('[aria-label="照片區塊 photo"]')
    expect(panel).not.toBeNull()
    return panel!
  })
}

function uploadPhoto(panel: Element, photo: BlockPhoto) {
  const extension = photo.mime === 'image/jpeg' ? 'jpg' : 'png'
  const file = new File([new Uint8Array(photo.bytes)], `${photo.id}.${extension}`, {
    type: photo.mime,
  })
  mocks.read.mockResolvedValueOnce({ ...photo, description: '' })
  const fileInput = panel.querySelector<HTMLInputElement>('input[type=file]')!
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] })
  fileInput.dispatchEvent(new Event('change', { bubbles: true }))
  expect(mocks.read).toHaveBeenLastCalledWith(file)
}

it('送達證書從步驟加入 PNG/JPEG，以每頁兩格產生文件並隱藏未使用的攝影欄位', async () => {
  const request = vi.spyOn(globalThis, 'fetch')
  const panel = await mountPublicPhotoTemplate('delivery-certificate-photos-template.docx')
  expect(panel.textContent).toContain('照片區塊（每頁 2 格）')
  const recipient = 'Mock 收件人'
  await input(
    host.querySelector<HTMLInputElement>('[data-field-key="應受送達人"] input')!,
    recipient,
  )
  const generate = button(host.querySelector('.fixed-step .step-documents')!, '產生')
  const photos = mockPhotoDraft(3).photos
  photos[1] = { ...photos[1]!, ...mockJpeg }

  for (const [index, pages] of [1, 1, 2].entries()) {
    const count = index + 1
    uploadPhoto(panel, photos[index]!)
    await vi.waitFor(() => expect(panel.textContent).toContain(`${count} 張 → ${pages} 頁`))
    expect(panel.textContent).not.toMatch(/攝影時間|攝影地點|攝影人|覆寫共用值/)
    expect(panel.querySelector('select, input:not([type="file"]), textarea')).toBeNull()
    await vi.waitFor(() => expect(generate.disabled).toBe(false))
    generate.click()
    await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(count))
    const [bytes, fileName] = mocks.download.mock.calls[index]!
    expect(fileName).toBe('產生-delivery-certificate-photos-template.docx')
    const parts = readSafeZip(bytes, docxZipLimits)
    expect([...parts.keys()].filter((name) => name.startsWith('word/media/'))).toHaveLength(count)
    const xml = xmlOf(bytes)
    expect(xml.match(/<w:drawing\b/g) ?? []).toHaveLength(count)
    expect(xml.match(/<w:pageBreakBefore\b/g) ?? []).toHaveLength(pages - 1)
    const plain = textOf(bytes)
    expect(plain.split(`說明：檢附應受送達人(${recipient})之送達證書。`)).toHaveLength(pages + 1)
    expect(plain.match(/備註：/g)).toHaveLength(1)
    expect(plain).not.toContain('{{')
    expect(xml).not.toContain('{{')
  }
  expect(request).not.toHaveBeenCalled()
})

it('刑案現場照片保留所有共用攝影欄位、單張覆寫與照片說明', async () => {
  const panel = await mountPublicPhotoTemplate('scene-photos-template.docx')
  expect(panel.textContent).toContain('共用攝影時間（民國年）')
  expect(panel.querySelectorAll('select')).toHaveLength(3)
  expect(labeled(panel, '共用攝影地點')).toBeInstanceOf(HTMLInputElement)
  expect(labeled(panel, '共用攝影人')).toBeInstanceOf(HTMLInputElement)
  uploadPhoto(panel, mockPhotoDraft(1).photos[0]!)
  await vi.waitFor(() => expect(panel.textContent).toContain('1 張 → 1 頁'))
  expect(labeled(panel, '照片1說明')).toBeInstanceOf(HTMLTextAreaElement)
  const row = panel.querySelector('[aria-label="照片清單"] > li')!
  const toggle = labeled(row, '覆寫共用值')
  toggle.click()
  await nextTick()
  expect(row.textContent).toContain('照片1攝影時間')
  expect(row.querySelectorAll('select')).toHaveLength(3)
  expect(labeled(row, '照片1攝影地點')).toBeInstanceOf(HTMLInputElement)
  expect(labeled(row, '照片1攝影人')).toBeInstanceOf(HTMLInputElement)
})

it('照片表單、同步區、單份與 ZIP 依範本隔離，排序、覆寫、離開清除，無寫入請求或草稿', async () => {
  const photo = buildPhotoTemplate()
  const ordinary = buildDocx({ document: wordDocument(paragraph(run('', '{{案由}}'))) })
  mocks.library = [
    ['a', photo],
    ['b', photo],
    ['ordinary', ordinary],
  ].map(([id, data]) => ({
    id: id as string,
    fileName: `${id}.docx`,
    sizeBytes: (data as Uint8Array).length,
    data: data as Uint8Array,
    placeholders: listPlaceholders(data as Uint8Array),
  }))
  mocks.category = reactive({
    id: 'mock',
    name: 'Mock 照片驗收',
    summary: '',
    updatedAt: '',
    templateCount: 3,
    fields: ['案由', '警局', '分局', '案次編號'].map((key) => ({
      id: key,
      key,
      name: key,
      type: 'text' as const,
      scope: 'base' as const,
    })),
    steps: [
      {
        id: 's',
        body: 'Mock 同步步驟',
        templateIds: ['a', 'b', 'ordinary'],
        canRunInParallel: true,
      },
    ],
    baseSteps: [{ stepId: 's', sortOrder: 0 }],
  })
  const request = vi.spyOn(globalThis, 'fetch')
  const storage = vi.spyOn(Storage.prototype, 'setItem')
  const urls = vi.spyOn(URL, 'createObjectURL')
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/categories/:id', component: CategoryView },
      { path: '/away', component: { template: '<p>離開 Mock</p>' } },
    ],
  })
  await confirmedNavigation(router, '/categories/mock')
  host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(RouterView) })
  app.use(router)
  app.mount(host)
  await vi.waitFor(() => expect(host.querySelectorAll('[aria-label="照片區塊 a"]')).toHaveLength(2))
  expect(host.querySelector('[aria-label="照片區塊 ordinary"]')).toBeNull()
  expect(host.querySelector('.shared-fields-panel [aria-label^="照片區塊"]')).toBeNull()
  for (const panel of host.querySelectorAll('[aria-label^="照片區塊"]')) {
    expect(panel.closest('[aria-label="本步驟欄位"]')).not.toBeNull()
  }
  expect(host.textContent).toContain('照片區塊（每頁 2 格）')
  expect(host.textContent).toContain('照片區塊會整段移除')
  const baseInput = (key: string) =>
    host.querySelector<HTMLInputElement>(`.shared-fields-panel [data-field-key="${key}"] input`)!
  expect(baseInput('警局').value).toBe(fieldDefaults['警局'])
  expect(baseInput('分局').value).toBe(fieldDefaults['分局'])
  expect(host.querySelector('[data-field-key="案次編號"]')).toBeNull()
  expect([...host.querySelectorAll('p button')].map((el) => el.textContent?.trim())).not.toContain(
    '案次編號',
  )
  await input(baseInput('案由'), 'Mock 案由')
  await input(baseInput('警局'), '')
  expect(baseInput('警局').value).toBe('')
  await input(baseInput('警局'), 'Mock 警局')
  await input(baseInput('分局'), '其他分局（Mock)')
  // A later-appearing alias gets initialized without changing the edited bureau/division.
  mocks.category!.fields!.push({
    id: 'alias',
    key: '警察局',
    name: '警察局',
    type: 'text',
    scope: 'base',
  })
  await nextTick()
  expect(baseInput('警察局').value).toBe(fieldDefaults['警察局'])
  expect(baseInput('警局').value).toBe('Mock 警局')
  expect(baseInput('分局').value).toBe('其他分局（Mock)')
  const panel = host.querySelector('[aria-label="照片區塊 a"]')!
  await input(labeled(panel, '共用攝影人'), '王小明(Mock)')
  await input(labeled(panel, '共用攝影地點'), 'Mock 市測試路 1 號')
  let n = 0
  mocks.read.mockImplementation(async () => ({
    ...mockPhotoDraft(5).photos[n++]!,
    description: '',
  }))
  const fileInput = panel.querySelector('input[type=file]') as HTMLInputElement
  Object.defineProperty(fileInput, 'files', {
    configurable: true,
    value: Array.from(
      { length: 5 },
      (_, i) => new File(['Mock'], `mock-${i}.png`, { type: 'image/png' }),
    ),
  })
  fileInput.dispatchEvent(new Event('change', { bubbles: true }))
  await vi.waitFor(() =>
    expect(panel.querySelectorAll('[aria-label="照片清單"] > li')).toHaveLength(5),
  )
  await flush()
  expect(panel.textContent).toContain('5 張 → 3 頁')
  const rows = panel.querySelectorAll('[aria-label="照片清單"] > li')
  const override = rows[2]!.querySelector('input[type=checkbox]') as HTMLInputElement
  override.checked = true
  override.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
  await input(labeled(rows[2]!, '照片3攝影人'), '李大華(Mock)')
  await input(labeled(rows[3]!, '照片4說明'), 'Mock 第4張 <script>&"\'')
  rows[3]!.querySelector('[draggable]')!.dispatchEvent(new Event('dragstart', { bubbles: true }))
  rows[0]!.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
  await nextTick()
  expect((panel.querySelector('textarea') as HTMLTextAreaElement).value).toContain('Mock 第4張')
  button(panel.querySelector('[aria-label="照片清單"] > li')!, '下移').click()
  await nextTick()
  button(panel.querySelectorAll('[aria-label="照片清單"] > li')[1]!, '上移').click()
  await nextTick()
  expect((panel.querySelector('textarea') as HTMLTextAreaElement).value).toContain('Mock 第4張')
  const parallelA = host.querySelector('#parallel-work [aria-label="照片區塊 a"]')!
  expect(parallelA.textContent).toContain('5 張 → 3 頁')
  const parallelB = host.querySelector('#parallel-work [aria-label="照片區塊 b"]')!
  expect(parallelB.textContent).toContain('0 張 → 0 頁')
  const parallel = host.querySelector('#parallel-work .step-documents')!
  button(parallel.querySelector('li')!, '產生').click()
  await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledOnce())
  const output = mocks.download.mock.calls[0]![0] as Uint8Array
  expect(textOf(output)).not.toContain('{{案次編號}}')
  expect(textOf(output)).toContain('其他分局（Mock)')
  expect(xmlOf(output).match(/<wp:inline/g)).toHaveLength(5)
  expect(textOf(output)).toMatch(/編號（1）[\s\S]*Mock 第4張 <script>&"'/)
  expect(textOf(output).match(/王小明\(Mock\)/g)).toHaveLength(4)
  expect(textOf(output).match(/李大華\(Mock\)/g)).toHaveLength(1)
  button(parallel, '產生本步驟全部').click()
  await vi.waitFor(() => expect(mocks.zip).toHaveBeenCalledOnce())
  const zip = await JSZip.loadAsync(await (mocks.zip.mock.calls[0]![0] as Blob).arrayBuffer())
  expect(
    xmlOf(await zip.file('產生-a.docx')!.async('uint8array')).match(/<wp:inline/g),
  ).toHaveLength(5)
  expect(xmlOf(await zip.file('產生-b.docx')!.async('uint8array'))).not.toContain('<w:tbl>')
  expect(textOf(await zip.file('產生-ordinary.docx')!.async('uint8array'))).toBe('Mock 案由')
  panel.querySelector<HTMLButtonElement>('[aria-label="刪除照片5"]')!.click()
  await nextTick()
  expect(panel.textContent).toContain('5 張 → 3 頁')
  button(host.querySelector('[role="dialog"]')!, '取消').click()
  await nextTick()
  expect(panel.textContent).toContain('5 張 → 3 頁')
  panel.querySelector<HTMLButtonElement>('[aria-label="刪除照片5"]')!.click()
  await nextTick()
  button(host.querySelector('[role="dialog"]')!, '確定').click()
  await nextTick()
  expect(panel.textContent).toContain('4 張 → 2 頁')
  await confirmedNavigation(router, '/away')
  await confirmedNavigation(router, '/categories/mock')
  await flush()
  await vi.waitFor(() =>
    expect(host.querySelector('[aria-label="照片區塊 a"]')?.textContent).toContain('0 張 → 0 頁'),
  )
  expect(host.querySelector('textarea')).toBeNull()
  expect(request).not.toHaveBeenCalled()
  expect(storage).not.toHaveBeenCalled()
  expect(urls).not.toHaveBeenCalled()
})

it('照片上傳與攝影欄位只在使用照片範本的第三步，基本資料與其他步驟沒有照片欄位（規格 5.2）', async () => {
  const photo = buildPhotoTemplate()
  const ordinary = buildDocx({ document: wordDocument(paragraph(run('', '{{被害人姓名}}'))) })
  mocks.library = [
    {
      id: 'photo',
      fileName: 'Mock 照片.docx',
      data: photo,
      sizeBytes: photo.length,
      placeholders: listPlaceholders(photo),
    },
    {
      id: 'text',
      fileName: 'Mock 文字.docx',
      data: ordinary,
      sizeBytes: ordinary.length,
      placeholders: listPlaceholders(ordinary),
    },
  ]
  mocks.category = reactive({
    id: 'mock',
    name: 'Mock 照片位置',
    summary: '',
    updatedAt: '',
    templateCount: 2,
    builtinFields: { 姓名: false },
    steps: [
      { id: 'one', body: 'Mock 第一步', templateIds: [] },
      { id: 'two', body: 'Mock 第二步', templateIds: ['text'] },
      { id: 'three', body: 'Mock 第三步', templateIds: ['photo'] },
    ],
    baseSteps: ['one', 'two', 'three'].map((stepId, sortOrder) => ({ stepId, sortOrder })),
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/categories/:id', component: CategoryView },
      { path: '/categories', component: { template: '<p>Mock</p>' } },
    ],
  })
  await confirmedNavigation(router, '/categories/mock')
  host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(RouterView) }).use(router)
  app.mount(host)
  await vi.waitFor(() => expect(host.querySelector('[aria-label="照片區塊 photo"]')).not.toBeNull())
  const steps = host.querySelectorAll('.fixed-step')
  expect(steps).toHaveLength(3)
  expect(steps[0]!.querySelector('input[type=file]')).toBeNull()
  expect(steps[1]!.querySelector('input[type=file]')).toBeNull()
  expect(steps[2]!.querySelector('input[type=file]')).not.toBeNull()
  expect(steps[2]!.querySelector('[aria-label="本步驟欄位"]')?.textContent).toContain('共用攝影人')
  expect(host.querySelector('.shared-fields-panel input[type=file]')).toBeNull()
  const fields = [...steps[2]!.querySelectorAll('[data-field-key]')].map((el) =>
    el.getAttribute('data-field-key'),
  )
  for (const special of ['攝影人', '攝影地點', '攝影時間', '照片說明', '照片', '日期']) {
    expect(fields).not.toContain(special)
  }
})
