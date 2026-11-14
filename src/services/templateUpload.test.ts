import { readFileSync } from 'node:fs'
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
    ['Mock.pdf', 'application/javascript', data],
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

it.each([
  '',
  '   ',
  'text/plain',
  'application/x-zip-compressed',
  'application/x-zip',
  ' Application/ZIP ',
])('accepts Mock Word with MIME %j and valid ZIP magic', async (type) => {
  const data = new Uint8Array(readFileSync('public/samples/field-note.docx'))
  await expect(
    validateTemplateFile(new File([data], 'Mock.docx', { type })),
  ).resolves.toMatchObject({ kind: 'docx' })
})
it('rejects wrong Word MIME', async () => {
  const data = new Uint8Array(readFileSync('public/samples/field-note.docx'))
  await expect(
    validateTemplateFile(new File([data], 'Mock.docx', { type: 'application/javascript' })),
  ).rejects.toThrow('MIME 不正確')
})
it.each(['', '   ', 'text/plain'])('requires Word magic with fallback MIME %j', async (type) => {
  await expect(
    validateTemplateFile(new File(['Mock invalid ZIP'], 'Mock.docx', { type })),
  ).rejects.toThrow('不是有效的 Word 檔')
})
it.each(['', '   ', 'text/plain'])('requires PDF magic with fallback MIME %j', async (type) => {
  await expect(
    validateTemplateFile(new File([new Uint8Array(buildMockPdf())], 'Mock.pdf', { type })),
  ).resolves.toMatchObject({ kind: 'pdf' })
  await expect(
    validateTemplateFile(new File(['Mock invalid PDF'], 'Mock.pdf', { type })),
  ).rejects.toThrow('缺少 %PDF-')
})
