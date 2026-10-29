import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'
import JSZip from 'jszip'

const docxMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const placeholderPattern = /\{\{\s*([^{}]+?)\s*\}\}/g
const textNodePattern = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g
const wordPartPattern = /^word\/(document|header\d+|footer\d+)\.xml$/

export const templateMimeType = docxMimeType
export const maxTemplateBytes = 8 * 1024 * 1024

export function safeFileName(name: string): string {
  const base = name.replace(/[/\\]/g, '_').replace(/\0/g, '').trim()
  return base.slice(0, 180)
}

export function hasZipHeader(data: ArrayBuffer): boolean {
  if (data.byteLength < 4) return false
  const bytes = new Uint8Array(data, 0, 4)
  return bytes[0] === 0x50 && bytes[1] === 0x4b
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export function placeholdersInText(text: string): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(placeholderPattern)) {
    const name = (match[1] ?? '').trim()
    if (!name || /^[#/!@]/.test(name) || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

function textFromWordXml(xml: string): string {
  return [...xml.matchAll(textNodePattern)].map((match) => decodeXml(match[1] ?? '')).join('')
}

export function listPlaceholders(data: ArrayBuffer | Uint8Array): string[] {
  const zip = new PizZip(data)
  const document = zip.file('word/document.xml')
  if (!document) {
    throw new Error('missing-document')
  }
  const parts = zip.file(wordPartPattern)
  const text = parts.map((part) => textFromWordXml(part.asText())).join('\n')
  return placeholdersInText(text)
}

export function renderDocx(
  data: ArrayBuffer | Uint8Array,
  values: Record<string, string>,
): Uint8Array {
  const zip = new PizZip(data)
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
