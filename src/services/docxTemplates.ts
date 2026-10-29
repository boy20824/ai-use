import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'
import JSZip from 'jszip'
import { docxZipLimits, normalizeDocx } from './docxXml.ts'

const docxMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export const templateMimeType = docxMimeType
export const maxTemplateBytes = 8 * 1024 * 1024

export { listPlaceholders, placeholdersInText } from './docxXml.ts'

export function safeFileName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? ''
  const cleaned = base
    .replace(/\0/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
  if (!cleaned || cleaned.includes('..')) return ''
  return cleaned.slice(0, 180)
}

export function hasZipHeader(data: ArrayBuffer): boolean {
  if (data.byteLength < 4) return false
  const bytes = new Uint8Array(data, 0, 4)
  return bytes[0] === 0x50 && bytes[1] === 0x4b
}

export function renderDocx(
  data: ArrayBuffer | Uint8Array,
  values: Record<string, string>,
): Uint8Array {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const normalized = normalizeDocx(bytes, docxZipLimits)
  const zip = new PizZip(normalized.data)
  const doc = new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '',
  })
  doc.render({ ...values })
  const output = doc.getZip().generate({ type: 'uint8array' })
  return output instanceof Uint8Array ? output : new Uint8Array(output)
}

export async function zipGeneratedFiles(
  files: { name: string; data: Uint8Array }[],
): Promise<Blob> {
  const zip = new JSZip()
  const used = new Set<string>()
  for (const file of files) {
    let name = safeFileName(file.name) || '範本.docx'
    if (used.has(name)) {
      const dot = name.lastIndexOf('.')
      const stem = dot > 0 ? name.slice(0, dot) : name
      const extension = dot > 0 ? name.slice(dot) : ''
      let index = 2
      while (used.has(`${stem}-${index}${extension}`)) index += 1
      name = `${stem}-${index}${extension}`
    }
    used.add(name)
    zip.file(name, file.data)
  }
  return zip.generateAsync({ type: 'blob' })
}
