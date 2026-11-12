// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { previewPdf } from './pdfPreview'
import { buildMockPdf } from '../../shared/mockPdfFixture'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
it('fetches authenticated bytes into an in-memory PDF blob and navigates a reserved tab without embedding', async () => {
  vi.useFakeTimers()
  const replace = vi.fn()
  const close = vi.fn()
  const tab = { opener: window, location: { replace }, close }
  const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-pdf')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const data = buildMockPdf()
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(new Uint8Array(data), { headers: { 'content-type': 'application/pdf' } }),
    )
  vi.stubGlobal('fetch', fetchMock)
  const localWrite = vi.spyOn(Storage.prototype, 'setItem')
  await previewPdf('mock-pdf')
  expect(open).toHaveBeenCalledWith('', '_blank')
  expect(tab.opener).toBeNull()
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringMatching(/\/api\/templates\/mock-pdf\/file\?inline=1$/),
    expect.objectContaining({ credentials: 'include' }),
  )
  const blob = create.mock.calls[0]![0] as Blob
  expect(blob.type).toBe('application/pdf')
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(data)
  expect(replace).toHaveBeenCalledWith('blob:mock-pdf')
  expect(document.querySelector('iframe, embed, object')).toBeNull()
  expect(localWrite).not.toHaveBeenCalled()
  expect(revoke).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(revoke).toHaveBeenCalledWith('blob:mock-pdf')
  expect(close).not.toHaveBeenCalled()
})
it('closes the reserved tab when authentication fails and reports blocked popups', async () => {
  const close = vi.fn()
  const open = vi
    .spyOn(window, 'open')
    .mockReturnValue({ opener: null, close } as unknown as Window)
  const create = vi.spyOn(URL, 'createObjectURL')
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: 'Mock login required' }), { status: 401 }),
      ),
  )
  await expect(previewPdf('mock-pdf')).rejects.toThrow('Mock login required')
  expect(close).toHaveBeenCalledOnce()
  expect(create).not.toHaveBeenCalled()
  open.mockReturnValue(null)
  await expect(previewPdf('mock-pdf')).rejects.toThrow('新分頁')
})
