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
