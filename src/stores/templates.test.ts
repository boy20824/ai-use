import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { StoredTemplate } from '@/storage/templateRepository'
import { buildMockPdf } from '../../shared/mockPdfFixture'
import { useTemplateStore } from './templates'

const mocks = vi.hoisted(() => ({
  mode: 'api' as 'api' | 'indexeddb',
  rows: [] as StoredTemplate[],
  put: vi.fn(),
}))
vi.mock('@/storage', () => ({
  templateStorageMode: () => mocks.mode,
  createTemplateRepository: () => ({
    list: async () => mocks.rows,
    put: mocks.put,
  }),
}))
vi.mock('@/dev/sampleSeed', () => ({ ensureSampleTemplates: async () => {} }))
beforeEach(() => {
  setActivePinia(createPinia())
  mocks.rows = []
  mocks.put.mockImplementation(async (record: StoredTemplate) => {
    mocks.rows.push(record)
    return { id: record.id, formatNotices: [] }
  })
})
afterEach(() => {
  vi.clearAllMocks()
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
