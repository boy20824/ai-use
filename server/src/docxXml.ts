import PizZip from 'pizzip'
import { Inflate } from 'pako'
import { DOMParser } from '@xmldom/xmldom'

const placeholderPattern = /\{\{\s*([^{}]+?)\s*\}\}/g
const wordPartPattern = /^word\/(document|header\d+|footer\d+)\.xml$/
const paragraphTagPattern = /<w:p(?=[\s>])[^>]*\/?>|<\/w:p>/g
const runPattern = /<w:r(?=[\s>])[^>]*\/>|<w:r(?=[\s>])[^>]*>[\s\S]*?<\/w:r>/g
const textNodePattern = /<w:t\b[^>]*>([^<]*)<\/w:t>|<w:t\b[^>]*\/>/g
const rPrPattern = /<w:rPr\b[^>]*\/>|<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/

export interface ZipLimits {
  maxEntries: number
  maxCompressedBytes?: number
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
  safeXml(xml)
  const all: ParagraphRange[] = []
  const stack: { start: number; child: boolean }[] = []
  for (const match of xml.matchAll(paragraphTagPattern)) {
    const token = match[0]
    const index = match.index ?? 0
    if (token.startsWith('</')) {
      const item = stack.pop()
      if (item && !item.child) all.push({ innerStart: item.start, innerEnd: index })
      continue
    }
    if (!token.endsWith('/>')) {
      if (stack.length) stack[stack.length - 1]!.child = true
      stack.push({ start: index + token.length, child: false })
    }
  }
  return all
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

// Reject ambiguous containers before any consumer sees them. Inflation emits
// bounded chunks and stops immediately on budget overflow, even with forged sizes.
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function inflateBounded(packed: Uint8Array, budget: number): Uint8Array {
  const chunks: Uint8Array[] = []
  let emitted = 0
  const inflater = new Inflate({ raw: true, chunkSize: Math.max(1, Math.min(16384, budget + 1)) })
  inflater.onData = (chunk: Uint8Array) => {
    emitted += chunk.length
    if (emitted > budget) throw new Error('too-large')
    chunks.push(chunk)
  }
  if (
    !inflater.push(packed, true) ||
    inflater.err ||
    !inflater.ended ||
    inflater.strm.avail_in !== 0
  )
    throw new Error('bad-deflate')
  const output = new Uint8Array(emitted)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

export function readSafeZip(data: Uint8Array, limits: ZipLimits): Map<string, Uint8Array> {
  if (data.length < 22 || data.length > (limits.maxCompressedBytes ?? 8 * 1024 * 1024))
    throw new Error('bad-zip')
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const u16 = (n: number) => v.getUint16(n, true)
  const u32 = (n: number) => v.getUint32(n, true)
  let end = -1
  for (let n = data.length - 22; n >= Math.max(0, data.length - 65557); n--) {
    if (u32(n) === 0x06054b50 && n + 22 + u16(n + 20) === data.length) {
      end = n
      break
    }
  }
  if (end < 0 || u16(end + 4) || u16(end + 6)) throw new Error('multi-disk')
  const count = u16(end + 10),
    size = u32(end + 12),
    start = u32(end + 16)
  if (count === 65535 || size === 0xffffffff || start === 0xffffffff) throw new Error('zip64')
  if (u16(end + 8) !== count || start + size !== end) throw new Error('bad-directory')
  const result = new Map<string, Uint8Array>()
  const names = new Set<string>()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let n = start,
    localEnd = 0,
    total = 0,
    actualCount = 0
  const extras = (from: number, length: number) => {
    const until = from + length
    while (from < until) {
      if (from + 4 > until) throw new Error('bad-extra')
      const id = u16(from),
        len = u16(from + 2)
      if (id === 1) throw new Error('zip64')
      if (id === 0x7075) throw new Error('ambiguous-unicode-path')
      from += 4 + len
      if (from > until) throw new Error('bad-extra')
    }
  }
  while (n < end) {
    if (++actualCount > limits.maxEntries) throw new Error('too-many-entries')
    if (n + 46 > end || u32(n) !== 0x02014b50) throw new Error('bad-directory')
    const flags = u16(n + 8),
      method = u16(n + 10),
      compressed = u32(n + 20),
      declared = u32(n + 24)
    const nl = u16(n + 28),
      el = u16(n + 30),
      cl = u16(n + 32),
      local = u32(n + 42)
    if (u16(n + 34) || compressed === 0xffffffff || declared === 0xffffffff || local === 0xffffffff)
      throw new Error('unsupported-zip')
    if (method !== 0 && method !== 8) throw new Error('unsupported-zip')
    const allowedFlags = 0x808 | (method === 8 ? 0x6 : 0)
    if (flags & ~allowedFlags) throw new Error('unsupported-zip')
    if (n + 46 + nl + el + cl > end) throw new Error('bad-directory')
    const name = decoder.decode(data.subarray(n + 46, n + 46 + nl))
    if (
      !name ||
      /[\\:\x00-\x1f]/.test(name) ||
      name.startsWith('/') ||
      name.includes('..') ||
      name.includes('%')
    )
      throw new Error('zip-path')
    const key = name.toLowerCase()
    if (names.has(key)) throw new Error('duplicate-entry')
    names.add(key)
    extras(n + 46 + nl, el)
    if (local !== localEnd || local + 30 > start || u32(local) !== 0x04034b50)
      throw new Error('bad-local')
    const lnl = u16(local + 26),
      lel = u16(local + 28),
      payload = local + 30 + lnl + lel
    if (
      payload + compressed > start ||
      u16(local + 6) !== flags ||
      u16(local + 8) !== method ||
      decoder.decode(data.subarray(local + 30, local + 30 + lnl)) !== name
    )
      throw new Error('bad-local')
    extras(local + 30 + lnl, lel)
    if (
      !(flags & 8) &&
      (u32(local + 18) !== compressed ||
        u32(local + 22) !== declared ||
        u32(local + 14) !== u32(n + 16))
    )
      throw new Error('bad-local')
    const remaining = limits.maxUncompressedBytes - total
    if (declared > remaining || remaining < 0) throw new Error('too-large')
    if (declared > 1_000_000 && declared / Math.max(1, compressed) > 100)
      throw new Error('zip-bomb')
    const packed = data.subarray(payload, payload + compressed)
    const output = method === 0 ? packed : inflateBounded(packed, remaining)
    total += output.length
    if (total > limits.maxUncompressedBytes || output.length !== declared)
      throw new Error('too-large')
    if (crc32(output) !== u32(n + 16)) throw new Error('bad-crc')
    if (name.endsWith('/') && output.length) throw new Error('bad-directory-entry')
    if (output.length > 1_000_000 && output.length / Math.max(1, compressed) > 100)
      throw new Error('zip-bomb')
    localEnd = payload + compressed
    if (flags & 8) {
      if (localEnd + 12 > start) throw new Error('bad-descriptor')
      if (u32(localEnd) === 0x08074b50) localEnd += 4
      if (
        localEnd + 12 > start ||
        u32(localEnd) !== u32(n + 16) ||
        u32(localEnd + 4) !== compressed ||
        u32(localEnd + 8) !== declared
      )
        throw new Error('bad-descriptor')
      localEnd += 12
    }
    result.set(name, output)
    n += 46 + nl + el + cl
  }
  if (actualCount !== count || n !== end || localEnd !== start) throw new Error('bad-directory')
  return result
}

export function assertSafeZip(data: Uint8Array, limits: ZipLimits) {
  readSafeZip(data, limits)
}

function safeXml(xml: string) {
  // Bound lexical work before DOM construction; DTD/entities are unnecessary in OOXML.
  if (xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('unsafe-xml')
  let depth = 0,
    nodes = 0,
    offset = 0
  while (offset < xml.length) {
    const start = xml.indexOf('<', offset)
    if (start < 0) break
    if (++nodes > 20000) throw new Error('complex-xml')
    let end: number
    if (xml.startsWith('<!--', start) || xml.startsWith('<![CDATA[', start)) {
      const comment = xml.startsWith('<!--', start)
      const marker = comment ? '-->' : ']]>'
      end = xml.indexOf(marker, start + (comment ? 4 : 9))
      if (end < 0) throw new Error('bad-xml')
      offset = end + marker.length
      continue
    }
    if (xml.startsWith('<?', start)) {
      end = xml.indexOf('?>', start + 2)
      if (end < 0 || end + 2 - start > 16384) throw new Error('bad-xml')
      const instruction = xml.slice(start + 2, end)
      const target = /^\s*([^\s?]+)/.exec(instruction)?.[1] ?? ''
      const declaration = target === 'xml' && xml.startsWith('<?xml ', start) && start <= 1
      // Depth alone cannot distinguish the prolog from a closed root element.
      const prolog = !xml
        .slice(0, start)
        .replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g, '')
        .trim()
      if (!declaration && !(target.startsWith('mso-') && prolog)) throw new Error('unsafe-xml')
      // The DOM parser requires the target immediately after <?.
      const leading = instruction.length - instruction.trimStart().length
      if (leading) {
        xml = xml.slice(0, start + 2) + instruction.trimStart() + xml.slice(end)
        end -= leading
      }
      offset = end + 2
      continue
    }
    if (xml.startsWith('<!', start)) throw new Error('unsafe-xml')
    let quote = ''
    for (end = start + 1; end < xml.length; end++) {
      if (end - start > 16384) throw new Error('complex-xml')
      const char = xml[end]!
      if (quote) {
        if (char === quote) quote = ''
      } else if (char === '"' || char === "'") quote = char
      else if (char === '<') throw new Error('bad-xml')
      else if (char === '>') break
    }
    if (end === xml.length) throw new Error('bad-xml')
    if (xml[start + 1] === '/') depth--
    else if (xml[end - 1] !== '/') depth++
    if (depth < 0 || depth > 64) throw new Error('complex-xml')
    offset = end + 1
  }
  return new DOMParser({
    onError: () => {
      throw new Error('bad-xml')
    },
  }).parseFromString(xml, 'application/xml')
}

function safeDocx(bytes: Uint8Array, limits: ZipLimits): PizZip {
  const entries = readSafeZip(bytes, limits)
  const zip = new PizZip()
  let main = false
  for (const [name, data] of entries) {
    const lower = name.toLowerCase()
    if (/vbaproject|activex|embeddings|oleobject/.test(lower)) throw new Error('active-content')
    if (/\.(xml|rels)$/i.test(name)) {
      const xml = new TextDecoder('utf-8', { fatal: true }).decode(data)
      const doc = safeXml(xml)
      const elements = doc.getElementsByTagName('*')
      for (let i = 0; i < elements.length; i++) {
        const el = elements.item(i)!
        const local = (el.localName ?? el.nodeName).toLowerCase()
        const attrs = new Map<string, string>()
        const seenAttrs = new Set<string>()
        for (let j = 0; j < el.attributes.length; j++) {
          const attr = el.attributes.item(j)!
          const key = (attr.localName ?? attr.name).toLowerCase()
          const expandedKey = JSON.stringify([attr.namespaceURI ?? '', key])
          // Security lookups use local names, so those must be unique across namespaces too.
          if (
            seenAttrs.has(expandedKey) ||
            (attrs.has(key) &&
              ['contenttype', 'type', 'target', 'targetmode', 'partname'].includes(key))
          )
            throw new Error('ambiguous-xml-attribute')
          seenAttrs.add(expandedKey)
          if (!attrs.has(key)) attrs.set(key, attr.value)
        }
        if (
          [
            'vbaproject',
            'activex',
            'oleobject',
            'object',
            'control',
            'controls',
            'altchunk',
          ].includes(local)
        )
          throw new Error('active-content')
        const type = (attrs.get('contenttype') ?? '').toLowerCase()
        if (
          [type, (attrs.get('type') ?? '').toLowerCase()].some((value) =>
            /macroenabled|vbaproject|activex|oleobject|\/control$|\/package$/.test(value),
          )
        )
          throw new Error('active-content')
        if (local === 'relationship') {
          if (
            el.namespaceURI !== 'http://schemas.openxmlformats.org/package/2006/relationships' ||
            !['', 'internal'].includes((attrs.get('targetmode') ?? '').toLowerCase()) ||
            /^[a-z][a-z0-9+.-]*:|^\/\/|[\\%\x00-\x20]/i.test(attrs.get('target') ?? '')
          )
            throw new Error('external-relationship')
        }
        if (
          lower === '[content_types].xml' &&
          local === 'override' &&
          (attrs.get('partname') ?? '').toLowerCase() === '/word/document.xml'
        ) {
          if (
            el.namespaceURI !== 'http://schemas.openxmlformats.org/package/2006/content-types' ||
            type !==
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
          )
            throw new Error('bad-main-type')
          main = true
        }
      }
      if (
        lower.endsWith('.rels') &&
        doc.documentElement?.namespaceURI !==
          'http://schemas.openxmlformats.org/package/2006/relationships'
      )
        throw new Error('bad-relationships')
    }
    zip.file(name, data)
  }
  if (!main || !entries.has('word/document.xml') || !entries.has('[Content_Types].xml'))
    throw new Error('missing-document-type')
  return zip
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
  if (inner.length > 65536) throw new Error('complex-paragraph')
  const tokens = tokenizeParagraph(inner)
  const runs: ParsedRun[] = []
  for (const token of tokens) {
    if (token.kind === 'run') runs.push({ xml: token.xml, rPr: canonicalRPr(token.xml) })
  }
  if (runs.length > 2048) throw new Error('complex-paragraph')
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
  let placeholders = 0
  for (const match of joined.matchAll(/\{\{([^{}]*)\}\}/g)) {
    if (++placeholders > 1024) throw new Error('complex-paragraph')
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
  const chunks: string[] = []
  let previous = 0
  let changed = false
  for (const range of ranges) {
    const inner = xml.slice(range.innerStart, range.innerEnd)
    const result = normalizeParagraphInner(inner)
    notices.push(...result.notices)
    chunks.push(xml.slice(previous, range.innerStart), result.inner)
    previous = range.innerEnd
    if (result.inner !== inner) changed = true
  }
  chunks.push(xml.slice(previous))
  const unique: string[] = []
  const seen = new Set<string>()
  for (const notice of notices) {
    if (seen.has(notice)) continue
    seen.add(notice)
    unique.push(notice)
  }
  return { xml: changed ? chunks.join('') : xml, notices: unique }
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
  const zip = safeDocx(bytes, limits)
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
  const output = zip.generate({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  const normalized = output instanceof Uint8Array ? output : new Uint8Array(output)
  assertSafeZip(normalized, limits)
  return { data: normalized, notices: tags }
}

export function listPlaceholders(
  data: ArrayBuffer | Uint8Array,
  limits: ZipLimits = docxZipLimits,
): string[] {
  const zip = safeDocx(asBytes(data), limits)
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
