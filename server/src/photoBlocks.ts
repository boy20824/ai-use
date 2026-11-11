/** Structural photo syntax shared by upload validation and the local renderer. */
export const photoFields = new Set([
  '照片',
  '照片編號',
  '攝影時間',
  '攝影地點',
  '攝影人',
  '照片說明',
])

export class PhotoBlockError extends Error {
  constructor(detail: string, index: number, paragraph: number, snippet: string) {
    super(
      `照片區塊：${detail}（第 ${index} 個標記，第 ${paragraph} 段：「${snippet.slice(0, 70)}」）。`,
    )
    this.name = 'PhotoBlockError'
  }
}

interface Range {
  tag: string
  start: number
  end: number
  openEnd: number
  parent?: Range
}
interface Marker {
  name: string
  index: number
  paragraph: number
  text: string
  range: Range
}
export interface PhotoCellRange {
  start: number
  end: number
  imageStart: number
  imageEnd: number
  width: number
  height: number
}
export interface PhotoBlock {
  start: number
  end: number
  contentStart: number
  contentEnd: number
  cells: PhotoCellRange[]
  photoCellsPerPage: number
}

function textOf(xml: string): string {
  return [...xml.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)]
    .map((m) =>
      (m[1] ?? '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&'),
    )
    .join('')
}
function ancestor(range: Range, tag: string): Range | undefined {
  let node: Range | undefined = range
  while (node && node.tag !== tag) node = node.parent
  return node
}
function fail(marker: Marker, detail: string): never {
  throw new PhotoBlockError(detail, marker.index, marker.paragraph, marker.text)
}

/** Input must already have passed normalizeWordXml / safe DOCX validation. */
export function parsePhotoBlock(xml: string, part = 'word/document.xml'): PhotoBlock | null {
  const ranges: Range[] = []
  const stack: Range[] = []
  for (const m of xml.matchAll(/<\/?w:(body|tbl|tr|tc|p)\b[^>]*>/g)) {
    if (m[0].startsWith('</')) {
      const node = stack.pop()
      if (node) node.end = m.index + m[0].length
    } else {
      const node: Range = {
        tag: m[1]!,
        start: m.index,
        end: m.index + m[0].length,
        openEnd: m.index + m[0].length,
        parent: stack[stack.length - 1],
      }
      ranges.push(node)
      if (!m[0].endsWith('/>')) stack.push(node)
    }
  }
  const paragraphs = ranges.filter((r) => r.tag === 'p')
  const markers: Marker[] = []
  let index = 0
  paragraphs.forEach((range, p) => {
    const text = textOf(xml.slice(range.start, range.end))
    for (const m of text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      index++
      const name = m[1]!.trim()
      if (photoFields.has(name) || /^[#/](照片頁|照片格)$/.test(name))
        markers.push({ name, index, paragraph: p + 1, text, range })
    }
  })
  // Existing text-only templates may use these field names too. They become
  // reserved only when a structural photo marker is present.
  if (!markers.some((marker) => /^[#/]/.test(marker.name))) return null
  if (part !== 'word/document.xml') fail(markers[0]!, '只能放在文件本文，不能放在頁首或頁尾')
  let opening: Marker | undefined
  let closing: Marker | undefined
  let cellOpening: Marker | undefined
  const pairs: [Marker, Marker][] = []
  let imageCount = 0
  for (const marker of markers) {
    switch (marker.name) {
      case '#照片頁':
        if (opening) fail(marker, '每份範本只能有一個照片頁區塊，不能巢狀')
        if (marker.range.parent?.tag !== 'body' || marker.text.trim() !== '{{#照片頁}}')
          fail(marker, '照片頁起始標記必須獨占本文的一個段落')
        opening = marker
        break
      case '/照片頁':
        if (!opening || closing) fail(marker, '照片頁結尾沒有對應的起始標記')
        if (cellOpening) fail(marker, '照片格缺少結尾標記 {{/照片格}}')
        if (marker.range.parent?.tag !== 'body' || marker.text.trim() !== '{{/照片頁}}')
          fail(marker, '照片頁結尾標記必須獨占本文的一個段落')
        if (!pairs.length) fail(marker, '照片頁內至少需要一個照片格')
        closing = marker
        break
      case '#照片格':
        if (!opening || closing) fail(marker, '照片格必須放在照片頁內')
        if (cellOpening) fail(marker, '照片格不能巢狀，前一格缺少結尾')
        if (!ancestor(marker.range, 'tr') || !marker.text.startsWith('{{#照片格}}'))
          fail(marker, '照片格起始標記須放在表格列第一段的開頭')
        cellOpening = marker
        imageCount = 0
        break
      case '/照片格':
        if (!cellOpening) fail(marker, '照片格結尾沒有對應的起始標記，且須位於照片頁內')
        if (!marker.text.endsWith('{{/照片格}}')) fail(marker, '照片格結尾須放在最後一段的結尾')
        if (imageCount !== 1) fail(marker, '每個照片格必須恰有一個獨占段落的 {{照片}}')
        pairs.push([cellOpening, marker])
        cellOpening = undefined
        break
      default:
        if (!cellOpening || closing) fail(marker, `{{${marker.name}}} 必須放在照片格內`)
        if (marker.name === '照片') {
          imageCount++
          if (marker.text.trim() !== '{{照片}}')
            fail(marker, '{{照片}} 必須獨占照片儲存格的一個段落')
        }
    }
  }
  const last = cellOpening ?? opening ?? markers[0]!
  if (cellOpening) fail(last, '照片格缺少結尾標記 {{/照片格}}')
  if (!opening || !closing) fail(last, '照片頁缺少結尾標記 {{/照片頁}}')
  let table: Range | undefined
  const cells = pairs.map(([a, b]) => {
    const first = ancestor(a.range, 'tr')!
    const end = ancestor(b.range, 'tr')
    const owner = ancestor(first, 'tbl')
    if (!end || !owner || ancestor(end, 'tbl') !== owner || (table && owner !== table))
      fail(a, '所有照片格須在同一張表格，且每格包住完整連續的列')
    if (ancestor(owner.parent ?? owner, 'tc')) fail(a, '照片格不支援巢狀表格')
    table = owner
    const ps = paragraphs.filter((p) => p.start >= first.start && p.end <= end.end)
    if (ps[0] !== a.range || ps[ps.length - 1] !== b.range)
      fail(a, '照片格標記須位於第一列第一段開頭、最後一列最後一段結尾')
    const image = markers.find(
      (m) => m.name === '照片' && m.range.start >= first.start && m.range.end <= end.end,
    )!
    const tc = ancestor(image.range, 'tc')!
    const tr = ancestor(tc, 'tr')!
    const cellXml = xml.slice(tc.start, tc.end)
    const rowXml = xml.slice(tr.start, tr.end)
    const width = Number(/<w:tcW\b[^>]*w:w="(\d+)"/.exec(cellXml)?.[1])
    const height = Number(/<w:trHeight\b[^>]*w:val="(\d+)"/.exec(rowXml)?.[1])
    if (!width || !height || /<w:tcW\b[^>]*w:type="(?!dxa)/.test(cellXml))
      fail(image, '照片儲存格須設定 dxa 寬度及列高，才能限制圖片大小')
    // Inline drawings share a text line. Reserve a full line plus paragraph
    // spacing so font substitution cannot make the drawing stretch the row.
    const imageXml = xml.slice(image.range.start, image.range.end)
    const spacing = /<w:spacing\b[^>]*>/.exec(imageXml)?.[0] ?? ''
    const spacingValue = (name: string, fallback: number) =>
      Number(new RegExp(`\\bw:${name}="(\\d+)"`).exec(spacing)?.[1] ?? fallback)
    const fontSize = Math.max(
      24,
      ...[...imageXml.matchAll(/<w:sz(?:Cs)?\b[^>]*w:val="(\d+)"/g)].map((m) => Number(m[1])),
    )
    const line = spacingValue('line', 240)
    const lineHeight = Math.max(
      300,
      Math.ceil(fontSize * 10 * 1.2),
      /w:lineRule="(?:exact|atLeast)"/.test(spacing)
        ? line
        : Math.ceil((fontSize * 10 * line) / 240),
    )
    const paragraphSpace = spacingValue('before', 120) + spacingValue('after', 120)
    const tableMargins =
      /<w:tblCellMar\b[^>]*>([\s\S]*?)<\/w:tblCellMar>/.exec(
        xml.slice(owner.start, owner.end),
      )?.[1] ?? ''
    const localMargins = /<w:tcMar\b[^>]*>([\s\S]*?)<\/w:tcMar>/.exec(cellXml)?.[1] ?? ''
    const margin = (side: string) => {
      const pattern = new RegExp(`<w:${side}\\b[^>]*w:w="(\\d+)"`)
      return Number(
        pattern.exec(localMargins)?.[1] ??
          pattern.exec(tableMargins)?.[1] ??
          (side === 'left' || side === 'right' ? 108 : 0),
      )
    }
    return {
      start: first.start,
      end: end.end,
      imageStart: image.range.start,
      imageEnd: image.range.end,
      width: Math.max(1, width - margin('left') - margin('right')) * 635,
      height:
        Math.max(1, height - margin('top') - margin('bottom') - lineHeight - paragraphSpace) * 635,
    }
  })
  for (let n = 1; n < cells.length; n++) {
    if (cells[n]!.start < cells[n - 1]!.end) fail(pairs[n]![0], '照片格不能共用同一列或重疊')
  }
  const content = xml.slice(opening.range.end, closing.range.start).trim()
  if (!content.startsWith('<w:p')) fail(opening, '照片頁內容須以標題段落開始，再放表格')
  if (/<w:br\b[^>]*w:type="page"|<w:sectPr\b/.test(content))
    fail(opening, '照片頁內請勿插入分頁或分節；系統會在重複頁之間自動分頁')
  return {
    start: opening.range.start,
    end: closing.range.end,
    contentStart: opening.range.end,
    contentEnd: closing.range.start,
    cells,
    photoCellsPerPage: cells.length,
  }
}
