import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { StoredTemplate } from '@/storage/templateRepository'
import { buildMockPdf } from '../../shared/mockPdfFixture'
import { useTemplateStore } from './templates'

const mocks = vi.hoisted(() => ({
  mode: 'api' as 'api' | 'indexeddb',
  rows: [] as StoredTemplate[],
  put: vi.fn(),
  list: vi.fn(),
  listPlaceholders: vi.fn(() => {
    throw new Error('Mock parser failure')
  }),
  normalizeDocx: vi.fn(() => {
    throw new Error('Mock parser failure')
  }),
}))
vi.mock('@/storage', () => ({
  templateStorageMode: () => mocks.mode,
  createTemplateRepository: () => ({
    list: mocks.list,
    put: mocks.put,
  }),
}))
vi.mock('@/services/docxTemplates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/docxTemplates')>()),
  listPlaceholders: mocks.listPlaceholders,
}))
vi.mock('../../server/src/docxXml', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/src/docxXml')>()),
  normalizeDocx: mocks.normalizeDocx,
}))
vi.mock('@/dev/sampleSeed', () => ({ ensureSampleTemplates: async () => {} }))
beforeEach(() => {
  setActivePinia(createPinia())
  mocks.mode = 'api'
  mocks.list.mockReset().mockImplementation(async () => mocks.rows)
  mocks.rows = []
  mocks.put.mockImplementation(async (record: StoredTemplate) => {
    mocks.rows.push(record)
    return { id: record.id, formatNotices: [] }
  })
})
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
it.each(['api', 'indexeddb'] as const)(
  'uploads reference bytes unchanged with empty placeholders in %s storage',
  async (mode) => {
    mocks.mode = mode
    const store = useTemplateStore()
    await store.load()
    const data = buildMockPdf()
    const result = await store.addFiles(
      [new File([new Uint8Array(data)], '作業規定（Mock）.pdf', { type: 'application/pdf' })],
      'mock-step',
    )
    expect(result).toMatchObject({ added: 1, rejected: [], formatNotices: [] })
    const record = mocks.put.mock.calls[0]![0] as StoredTemplate
    expect(record).toMatchObject({ kind: 'pdf', mimeType: 'application/pdf', placeholders: [] })
    expect(new Uint8Array(record.data)).toEqual(data)
    expect(mocks.put.mock.calls[0]![1]).toBe('mock-step')
    expect(store.items[0]).toMatchObject({ kind: 'pdf', placeholders: [] })
    // A PDF with text that resembles a field must never enter the Word parser.
    expect(new TextDecoder().decode(data)).toContain('{{MockField}}')
    expect(await store.bytesFor(record.id)).toEqual(record.data)
  },
)

it.each(['api', 'indexeddb'] as const)(
  'handles a throwing Word parser in %s mode',
  async (mode) => {
    mocks.mode = mode
    const store = useTemplateStore()
    const data = new Uint8Array(readFileSync('public/samples/field-note.docx'))
    const result = await store.addFiles([new File([data], 'Mock.docx')])
    if (mode === 'api') {
      expect(result).toMatchObject({ added: 1, rejected: [] })
      expect(mocks.put).toHaveBeenCalledOnce()
      expect(new Uint8Array(mocks.put.mock.calls[0]![0].data)).toEqual(data)
      expect(mocks.normalizeDocx).not.toHaveBeenCalled()
      expect(mocks.listPlaceholders).not.toHaveBeenCalled()
    } else {
      expect(result).toMatchObject({ added: 0, rejected: ['Mock.docx 無法讀取'] })
      expect(mocks.put).not.toHaveBeenCalled()
      expect(mocks.normalizeDocx).toHaveBeenCalledOnce()
    }
  },
)

it('retries a failed list and shares concurrent load requests', async () => {
  mocks.list.mockRejectedValueOnce(new Error('Mock unavailable'))
  const store = useTemplateStore()
  await Promise.all([store.load(), store.load()])
  expect(mocks.list).toHaveBeenCalledTimes(1)
  expect(store.ready).toBe(false)
  expect(store.error).toBe('無法讀取範本文件。')
  await store.load()
  expect(mocks.list).toHaveBeenCalledTimes(2)
  expect(store.ready).toBe(true)
  expect(store.error).toBe('')
})

it.each([undefined, 'not-an-array', {}])(
  'loads a Word summary with malformed placeholders %j',
  async (placeholders) => {
    // Deliberately model malformed runtime data from a legacy repository.
    mocks.rows = [
      {
        id: 'mock-word',
        kind: 'docx',
        fileName: 'Mock.docx',
        addedAt: '',
        usages: [],
        data: new ArrayBuffer(0),
        placeholders,
      } as unknown as StoredTemplate,
    ]
    const store = useTemplateStore()
    await store.load()
    expect(store.ready).toBe(true)
    expect(store.items[0]).toMatchObject({ id: 'mock-word', placeholders: [] })
  },
)

it('replaces API Word files without invoking the browser parsers', async () => {
  const store = useTemplateStore()
  await store.load()
  const request = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ linkedCategoryCount: 0, formatNotices: [] })))
  vi.stubGlobal('fetch', request)
  const data = new Uint8Array(readFileSync('public/samples/field-note.docx'))
  await expect(store.replace('mock-word', new File([data], 'Mock.docx'))).resolves.toMatchObject({
    formatNotices: [],
  })
  expect(request).toHaveBeenCalledOnce()
  expect(mocks.listPlaceholders).not.toHaveBeenCalled()
  expect(mocks.normalizeDocx).not.toHaveBeenCalled()
})
