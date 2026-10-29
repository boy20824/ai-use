// Loaded at runtime from this package. The production image does not contain frontend src/.
export { assertSafeZip, listPlaceholders, normalizeDocx, type ZipLimits } from './docxXml.ts'

const allowedMimeTypes = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream',
  'application/zip',
])

export function hasZipHeader(data: Uint8Array): boolean {
  return data.byteLength >= 4 && data[0] === 0x50 && data[1] === 0x4b
}

export function isAllowedDocxMime(mimeType: string): boolean {
  return allowedMimeTypes.has(mimeType.toLowerCase())
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
    !/^[^\s/\\][^/\\]*\.docx$/i.test(cleaned) &&
    !/^[\u4e00-\u9fff\w .()\-]+\.docx$/i.test(cleaned)
  ) {
    return null
  }
  if (!cleaned.toLowerCase().endsWith('.docx')) return null
  return cleaned
}
