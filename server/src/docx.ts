import { docxMimeType } from '../../shared/templateUpload.ts'

// Loaded at runtime from this package. The production image does not contain frontend src/.
export { hasZipHeader } from '../../shared/templateUpload.ts'
export { listPlaceholders, normalizeDocx } from './docxXml.ts'

const allowedMimeTypes = new Set([
  '',
  'text/plain', // Busboy's fallback for a missing or empty multipart Content-Type.
  'application/x-zip-compressed',
  'application/x-zip',
  docxMimeType,
  'application/octet-stream',
  'application/zip',
])

export function isAllowedDocxMime(mimeType: string): boolean {
  return allowedMimeTypes.has(mimeType.trim().toLowerCase())
}

export function sanitizeTemplateFileName(input: string): string | null {
  const base = input.replace(/\\/g, '/').split('/').pop() ?? ''
  const cleaned = base
    .replace(/\0/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '')
    .trim()
  if (!cleaned || cleaned === '.' || cleaned === '..' || cleaned.includes('..')) return null
  if (cleaned.length > 180) return null
  if (
    !/^[^\s/\\][^/\\]*\.(docx|pdf)$/i.test(cleaned) &&
    !/^[\u4e00-\u9fff\w .()\-]+\.(docx|pdf)$/i.test(cleaned)
  ) {
    return null
  }
  if (!/\.(docx|pdf)$/i.test(cleaned)) return null
  return cleaned
}
