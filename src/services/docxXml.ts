import PizZip from 'pizzip'

const placeholderPattern = /\{\{\s*([^{}]+?)\s*\}\}/g
const wordPartPattern = /^word\/(document|header\d+|footer\d+)\.xml$/
const paragraphTagPattern = /<w:p(?=[\s>])[^>]*\/?>|<\/w:p>/g
const runPattern = /<w:r(?=[\s>])[^>]*\/>|<w:r(?=[\s>])[^>]*>[\s\S]*?<\/w:r>/g
const textNodePattern = /<w:t\b[^>]*>([^<]*)<\/w:t>|<w:t\b[^>]*\/>/g
const rPrPattern = /<w:rPr\b[^>]*\/>|<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/

export interface ZipLimits {
  maxEntries: number
  maxUncompressedBytes: number
}

export const docxZipLimits: ZipLimits = {
  maxEntries: 64,
  maxUncompressedBytes: 32 * 1024 * 1024,
}

export interface NormalizedDocx {
  data: Uint8Array
  notices: string[]
}

interface ParagraphRange {
  innerStart: number
  innerEnd: number
}

interface ParsedRun {
  xml: string
  rPr: string
}

type ParagraphToken = { kind: 'gap'; xml: string } | { kind: 'run'; xml: string }

function asBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data)
}

export function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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

function textsInXml(xml: string): string {
  return [...xml.matchAll(textNodePattern)].map((match) => decodeXml(match[1] ?? '')).join('')
}

function leafParagraphRanges(xml: string): ParagraphRange[] {
  const all: ParagraphRange[] = []
  const stack: number[] = []
  for (const match of xml.matchAll(paragraphTagPattern)) {
    const token = match[0]
    const index = match.index ?? 0
    if (token.startsWith('</')) {
      const innerStart = stack.pop()
      if (innerStart === undefined) continue
      all.push({ innerStart, innerEnd: index })
      continue
    }
    if (!token.endsWith('/>')) stack.push(index + token.length)
  }
  return all.filter(
    (outer) =>
      !all.some((inner) => inner.innerStart > outer.innerStart && inner.innerEnd < outer.innerEnd),
  )
}

export function placeholderNamesInXml(xml: string): string[] {
  const ranges = leafParagraphRanges(xml)
  const chunks =
    ranges.length > 0
      ? ranges.map((range) => textsInXml(xml.slice(range.innerStart, range.innerEnd)))
      : [textsInXml(xml)]
  const names: string[] = []
  const seen = new Set<string>()
  for (const chunk of chunks) {
    for (const name of placeholdersInText(chunk)) {
      if (seen.has(name)) continue
      seen.add(name)
      names.push(name)
    }
  }
  return names
}

export function assertSafeZip(data: Uint8Array, limits: ZipLimits) {
  if (data.byteLength < 22 || data[0] !== 0x50 || data[1] !== 0x4b) throw new Error('bad-zip')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let eocd = -1
  const scanFrom = Math.max(0, data.byteLength - 22 - 65535)
  for (let index = data.byteLength - 22; index >= scanFrom; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocd = index
      break
    }
  }
  if (eocd < 0) throw new Error('bad-zip')
  const entries = view.getUint16(eocd + 10, true)
  const directoryOffset = view.getUint32(eocd + 16, true)
  if (entries > limits.maxEntries) throw new Error('too-many-entries')
  let offset = directoryOffset
  let uncompressedTotal = 0
  const decoder = new TextDecoder('utf-8')
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > data.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('bad-zip')
    }
    const compressed = view.getUint32(offset + 20, true)
    const uncompressed = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) throw new Error('zip64')
    if (uncompressed > limits.maxUncompressedBytes) throw new Error('too-large')
    uncompressedTotal += uncompressed
    if (uncompressedTotal > limits.maxUncompressedBytes) throw new Error('too-large')
    if (compressed > 0 && uncompressed > 1_000_000 && uncompressed / compressed > 100) {
      throw new Error('zip-bomb')
    }
    const nameStart = offset + 46
    const name = decoder.decode(data.subarray(nameStart, nameStart + nameLength))
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

function canonicalRPr(runXml: string): string {
  const match = runXml.match(rPrPattern)
  if (!match) return ''
  return match[0]
    .replace(/>\s+</g, '><')
    .replace(/\s+\/>/g, '/>')
    .replace(/\s+/g, ' ')
    .trim()
}

function runTextNodes(runXml: string): string[] {
  return [...runXml.matchAll(textNodePattern)].map((match) => decodeXml(match[1] ?? ''))
}

function runHasOtherContent(runXml: string): boolean {
  const stripped = runXml
    .replace(rPrPattern, '')
    .replace(textNodePattern, '')
    .replace(/^<w:r\b[^>]*>/, '')
    .replace(/<\/w:r>$/, '')
    .trim()
  return stripped.length > 0
}

function setRunText(runXml: string, text: string): string {
  const needsSpace = /^\s|\s$|\s{2}/.test(text)
  const replacement = text
    ? `<w:t${needsSpace ? ' xml:space="preserve"' : ''}>${escapeXml(text)}</w:t>`
    : ''
  let used = false
  const next = runXml.replace(textNodePattern, () => {
    if (used) return ''
    used = true
    return replacement
  })
  if (!used && text) return next.replace(/<\/w:r>$/, `${replacement}</w:r>`)
  return next
}

function tokenizeParagraph(inner: string): ParagraphToken[] {
  const tokens: ParagraphToken[] = []
  let last = 0
  for (const match of inner.matchAll(runPattern)) {
    const index = match.index ?? 0
    if (index > last) tokens.push({ kind: 'gap', xml: inner.slice(last, index) })
    tokens.push({ kind: 'run', xml: match[0] })
    last = index + match[0].length
  }
  if (last < inner.length) tokens.push({ kind: 'gap', xml: inner.slice(last) })
  return tokens
}

function normalizeParagraphInner(inner: string): { inner: string; notices: string[] } {
  const tokens = tokenizeParagraph(inner)
  const runs: ParsedRun[] = []
  for (const token of tokens) {
    if (token.kind === 'run') runs.push({ xml: token.xml, rPr: canonicalRPr(token.xml) })
  }
  if (runs.length === 0) return { inner, notices: [] }

  const chars: { runIndex: number; ch: string }[] = []
  const pieces: { start: number; end: number; runIndex: number }[] = []
  runs.forEach((run, runIndex) => {
    for (const text of runTextNodes(run.xml)) {
      const start = chars.length
      for (let index = 0; index < text.length; index += 1) {
        chars.push({ runIndex, ch: text[index] ?? '' })
      }
      pieces.push({ start, end: chars.length, runIndex })
    }
  })

  const notices: string[] = []
  const dirty = runs.map(() => false)
  const joined = chars.map((item) => item.ch).join('')
  for (const match of joined.matchAll(/\{\{([^{}]*)\}\}/g)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    const covered = pieces.filter((piece) => piece.end > start && piece.start < end)
    if (covered.length <= 1) continue
    const runSet = new Set(covered.map((piece) => piece.runIndex))
    const firstRun = chars[start]?.runIndex ?? 0
    const firstRPr = runs[firstRun]?.rPr ?? ''
    if ([...runSet].some((index) => (runs[index]?.rPr ?? '') !== firstRPr)) {
      const name = (match[1] ?? '').trim().slice(0, 80)
      if (name) notices.push(name)
    }
    if (runSet.size > 1) {
      for (let index = start; index < end; index += 1) {
        const item = chars[index]
        if (item) item.runIndex = firstRun
      }
    }
    for (const index of runSet) dirty[index] = true
    dirty[firstRun] = true
  }
  if (!dirty.some(Boolean)) return { inner, notices }

  const rebuilt = runs.map(() => '')
  for (const item of chars) {
    const current = rebuilt[item.runIndex]
    if (current !== undefined) rebuilt[item.runIndex] = current + item.ch
  }

  let runIndex = 0
  const next = tokens
    .map((token) => {
      if (token.kind === 'gap') return token.xml
      const index = runIndex
      runIndex += 1
      if (!dirty[index]) return token.xml
      const text = rebuilt[index] ?? ''
      if (!text && !runHasOtherContent(token.xml)) return ''
      return setRunText(token.xml, text)
    })
    .join('')
  return { inner: next, notices }
}

export function normalizeWordXml(xml: string): { xml: string; notices: string[] } {
  const ranges = [...leafParagraphRanges(xml)].sort(
    (left, right) => left.innerStart - right.innerStart,
  )
  if (ranges.length === 0) return { xml, notices: [] }
  const notices: string[] = []
  let next = xml
  let delta = 0
  let changed = false
  for (const range of ranges) {
    const start = range.innerStart + delta
    const end = range.innerEnd + delta
    const inner = next.slice(start, end)
    const result = normalizeParagraphInner(inner)
    notices.push(...result.notices)
    if (result.inner === inner) continue
    next = next.slice(0, start) + result.inner + next.slice(end)
    delta += result.inner.length - inner.length
    changed = true
  }
  const unique: string[] = []
  const seen = new Set<string>()
  for (const notice of notices) {
    if (seen.has(notice)) continue
    seen.add(notice)
    unique.push(notice)
  }
  return { xml: changed ? next : xml, notices: unique }
}

function uniqueTags(tags: string[]): string[] {
  const unique: string[] = []
  const seen = new Set<string>()
  for (const tag of tags) {
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    unique.push(tag)
  }
  return unique
}

export function normalizeDocx(data: ArrayBuffer | Uint8Array, limits: ZipLimits): NormalizedDocx {
  const bytes = asBytes(data)
  assertSafeZip(bytes, limits)
  const zip = new PizZip(bytes)
  const notices: string[] = []
  let changed = false
  for (const part of zip.file(wordPartPattern)) {
    const xml = part.asText()
    if (xml.length > limits.maxUncompressedBytes) throw new Error('too-large')
    const result = normalizeWordXml(xml)
    notices.push(...result.notices)
    if (result.xml === xml) continue
    zip.file(part.name, result.xml)
    changed = true
  }
  const tags = uniqueTags(notices)
  if (!changed) return { data: bytes, notices: tags }
  const output = zip.generate({ type: 'uint8array' })
  const normalized = output instanceof Uint8Array ? output : new Uint8Array(output)
  assertSafeZip(normalized, limits)
  return { data: normalized, notices: tags }
}

export function listPlaceholders(data: ArrayBuffer | Uint8Array): string[] {
  const zip = new PizZip(asBytes(data))
  if (!zip.file('word/document.xml')) throw new Error('missing-document')
  const names: string[] = []
  const seen = new Set<string>()
  for (const part of zip.file(wordPartPattern)) {
    for (const name of placeholderNamesInXml(part.asText())) {
      if (seen.has(name)) continue
      seen.add(name)
      names.push(name)
    }
  }
  return names
}

export function splitFormatNotice(tags: string[]): string {
  if (tags.length === 0) return ''
  return `這些欄位在 Word 裡被拆成不同格式，已沿用第一個字的格式：${tags.join('、')}。`
}
