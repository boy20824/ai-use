import PizZip from 'pizzip'

const textNodePattern = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g
const placeholderPattern = /\{\{\s*([^{}]+?)\s*\}\}/g
const wordPartPattern = /^word\/(document|header\d+|footer\d+)\.xml$/

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

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export interface ZipLimits {
  maxEntries: number
  maxUncompressedBytes: number
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

export function assertSafeZip(data: Uint8Array, limits: ZipLimits) {
  if (!hasZipHeader(data) || data.byteLength < 22) throw new Error('bad-zip')
  const view = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  let eocd = -1
  const scanFrom = Math.max(0, view.length - 22 - 65535)
  for (let index = view.length - 22; index >= scanFrom; index -= 1) {
    if (view.readUInt32LE(index) === 0x06054b50) {
      eocd = index
      break
    }
  }
  if (eocd < 0) throw new Error('bad-zip')
  const entries = view.readUInt16LE(eocd + 10)
  const directoryOffset = view.readUInt32LE(eocd + 16)
  if (entries > limits.maxEntries) throw new Error('too-many-entries')
  let offset = directoryOffset
  let uncompressedTotal = 0
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > view.length || view.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('bad-zip')
    }
    const compressed = view.readUInt32LE(offset + 20)
    const uncompressed = view.readUInt32LE(offset + 24)
    const nameLength = view.readUInt16LE(offset + 28)
    const extraLength = view.readUInt16LE(offset + 30)
    const commentLength = view.readUInt16LE(offset + 32)
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) throw new Error('zip64')
    if (uncompressed > limits.maxUncompressedBytes) throw new Error('too-large')
    uncompressedTotal += uncompressed
    if (uncompressedTotal > limits.maxUncompressedBytes) throw new Error('too-large')
    if (compressed > 0 && uncompressed > 1_000_000 && uncompressed / compressed > 100) {
      throw new Error('zip-bomb')
    }
    const nameStart = offset + 46
    const name = view.subarray(nameStart, nameStart + nameLength).toString('utf8')
    if (
      name.includes('..') ||
      name.startsWith('/') ||
      name.startsWith('\\') ||
      name.includes('\\')
    ) {
      throw new Error('zip-path')
    }
    offset = nameStart + nameLength + extraLength + commentLength
  }
}

export function listPlaceholders(data: Uint8Array): string[] {
  const zip = new PizZip(data)
  if (!zip.file('word/document.xml')) {
    throw new Error('missing-document')
  }
  const names: string[] = []
  const seen = new Set<string>()
  for (const part of zip.file(wordPartPattern)) {
    const text = [...part.asText().matchAll(textNodePattern)]
      .map((match) => decodeXml(match[1] ?? ''))
      .join('')
    for (const match of text.matchAll(placeholderPattern)) {
      const name = (match[1] ?? '').trim()
      if (!name || /^[#/!@]/.test(name) || seen.has(name)) continue
      seen.add(name)
      names.push(name)
    }
  }
  return names
}
