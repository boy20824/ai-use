import { expect, it } from 'vitest'
import { validateTemplateFile } from './templateUpload'
import { buildMockPdf } from '../../shared/mockPdfFixture'
import { maxPdfUploadBytes } from '../../shared/templateUpload'
import { templateMimeType } from './docxTemplates'

it('validates Mock PDF extension, MIME, magic and independent 20 MiB cap', async () => {
  const data = buildMockPdf()
  const valid = await validateTemplateFile(
    new File([new Uint8Array(data)], '作業規定（Mock）.pdf', { type: 'application/pdf' }),
  )
  expect(valid.kind).toBe('pdf')
  expect(new Uint8Array(valid.data)).toEqual(data)
  for (const [name, type, content] of [
    ['Mock.pdf', 'text/plain', data],
    ['Mock.docx', 'application/pdf', data],
    ['Mock.txt', 'application/pdf', data],
    ['Mock.pdf', 'application/pdf', new TextEncoder().encode('Mock non-PDF')],
    ['Mock.pdf', 'application/pdf', new TextEncoder().encode(' %PDF-1.4')],
  ] as const) {
    await expect(
      validateTemplateFile(new File([new Uint8Array(content)], name, { type })),
    ).rejects.toThrow()
  }
  const large = new Uint8Array(9 * 1024 * 1024)
  large.set(data)
  await expect(
    validateTemplateFile(new File([large], 'Mock.pdf', { type: 'application/pdf' })),
  ).resolves.toMatchObject({ kind: 'pdf' })
  const tooLarge = new File([], 'Mock.pdf', { type: 'application/pdf' })
  Object.defineProperty(tooLarge, 'size', { value: maxPdfUploadBytes + 1 })
  await expect(validateTemplateFile(tooLarge)).rejects.toThrow('20 MiB')
  const word = new File([large], 'Mock.docx', { type: templateMimeType })
  await expect(validateTemplateFile(word)).rejects.toThrow('8 MiB')
})
