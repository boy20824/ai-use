import { afterEach, expect, it, vi } from 'vitest'
import { createApiTemplateRepository } from './apiTemplateRepository'
import { buildMockPdf } from '../../shared/mockPdfFixture'

afterEach(() => vi.unstubAllGlobals())
it('defaults legacy summaries to Word and reads the original PDF filename and MIME', async () => {
  const fileName = '作業規定（Mock）.pdf'
  const data = buildMockPdf()
  const request = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          templates: [
            { id: 'mock-word', fileName: 'Mock.docx', placeholders: [] },
            { id: 'mock-pdf', kind: 'pdf', fileName, placeholders: ['MockIgnored'] },
          ],
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(new Uint8Array(data), {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="Mock.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        },
      }),
    )
  vi.stubGlobal('fetch', request)
  const repository = createApiTemplateRepository()
  const list = await repository.list()
  expect(list[0]?.kind).toBe('docx')
  expect(list[1]).toMatchObject({ kind: 'pdf', placeholders: [] })
  const pdf = await repository.get('mock-pdf')
  expect(pdf).toMatchObject({ kind: 'pdf', fileName, mimeType: 'application/pdf' })
  expect(new Uint8Array(pdf!.data)).toEqual(data)
  expect(request).toHaveBeenLastCalledWith(
    expect.stringMatching(/\/api\/templates\/mock-pdf\/file$/),
    expect.objectContaining({ credentials: 'include' }),
  )
})

it.each([undefined, 'not-an-array', {}])(
  'defaults malformed API Word placeholders %j to an empty array',
  async (placeholders) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ templates: [{ id: 'mock-word', kind: 'docx', placeholders }] }),
          ),
        ),
    )
    expect(await createApiTemplateRepository().list()).toEqual([
      expect.objectContaining({ id: 'mock-word', placeholders: [] }),
    ])
  },
)
