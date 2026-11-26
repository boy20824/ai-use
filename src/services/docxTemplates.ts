import JSZip from 'jszip'

export { docxMimeType as templateMimeType, hasZipHeader } from '../../shared/templateUpload'
export const maxTemplateBytes = 8 * 1024 * 1024

export { listPlaceholders } from '../../server/src/docxXml.ts'
export { renderDocx } from '../../shared/docxRender.ts'

export function safeFileName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? ''
  const cleaned = base
    .replace(/\0/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
  if (!cleaned || cleaned.includes('..')) return ''
  return cleaned.slice(0, 180)
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
