import JSZip from 'jszip'
import { checkDimensions, dimensions } from './core'

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const DOCX_LAYOUT = {
  columnWidth: (16838 - 2 * 1440) / 3,
  // Reserve 720 twips for header/footer clearance and trailing paragraphs.
  imageHeight: 11906 - 1134 - 993 - 720,
}
const EMU_PER_TWIP = 635
const placeholder = '{{被害人姓名}}'

export function victimNameError(value: string): string {
  if (/[\p{Cc}\p{Cs}\uFFFE\uFFFF]/u.test(value)) return '姓名僅可使用純文字，不可包含控制字元。'
  const name = value.trim()
  if (!name) return '請填寫被害人姓名（必填）。'
  if (Array.from(name).length > 50) return '被害人姓名上限為 50 字。'
  return ''
}
function validName(value: string) {
  const error = victimNameError(value)
  if (error) throw new Error(error)
  return value.trim()
}
export function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!
  })
}
export function docxFilename(value: string, date = new Date()) {
  const name = validName(value).replace(/[\\/:*?"<>|\p{Cc}]/gu, '_')
  const year = String(date.getFullYear() - 1911).padStart(3, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `詐騙對話截圖_${name}_${year}${month}${day}.docx`
}

// Edit only text contents; preserve all original run properties, even across split runs.
export function replaceHeaderName(xml: string, name: string) {
  const replacement = escapeXml(validName(name))
  let found = false
  const output = xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraph) => {
    const text = [...paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((node) => node[1])
      .join('')
    const starts = [...text.matchAll(/\{\{被害人姓名\}\}/g)].map((match) => match.index)
    let offset = 0
    return paragraph.replace(
      /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g,
      (_, open, content: string, close) => {
        const start = offset
        offset += content.length
        let edited = ''
        for (let i = 0; i < content.length; i++) {
          const position = start + i
          if (starts.includes(position)) {
            edited += replacement
            found = true
          }
          if (!starts.some((at) => position >= at && position < at + placeholder.length))
            edited += content[i]
        }
        return open + edited + close
      },
    )
  })
  if (!found) throw new Error('Word 範本頁首缺少姓名欄位，請聯絡管理員。')
  return output
}
function drawing(id: number, width: number, height: number) {
  const scale = Math.min(
    Math.floor(DOCX_LAYOUT.columnWidth) / width,
    DOCX_LAYOUT.imageHeight / height,
  )
  const cx = Math.max(1, Math.floor(width * scale * EMU_PER_TWIP))
  const cy = Math.max(1, Math.floor(height * scale * EMU_PER_TWIP))
  return `<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Screenshot ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="screenshot-${id}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="splitterImage${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
}
const paragraphProperties =
  '<w:pPr><w:snapToGrid w:val="0"/><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>'
function table(cells: string[]) {
  // OOXML table widths are integral twips; round down to keep every cell inside the page.
  const width = Math.floor(DOCX_LAYOUT.columnWidth)
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="nil"/>`)
    .join('')
  return `<w:tbl><w:tblPr><w:tblW w:w="${width * 3}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar>${['top', 'left', 'bottom', 'right'].map((side) => `<w:${side} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar></w:tblPr><w:tblGrid>${`<w:gridCol w:w="${width}"/>`.repeat(3)}</w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr>${Array.from({ length: 3 }, (_, i) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p>${paragraphProperties}${cells[i] ?? ''}</w:p></w:tc>`).join('')}</w:tr></w:tbl>`
}
export interface DocxOptions {
  name: string
  total: number
  images: (append: (png: Uint8Array) => Promise<void>) => Promise<void>
  template?: ArrayBuffer
  onProgress?: (processed: number, total: number) => void
  active?: () => boolean
}

// The only request is for the same-origin static template. Image bytes are supplied locally.
export async function createDocx(options: DocxOptions): Promise<Uint8Array<ArrayBuffer>> {
  const name = validName(options.name)
  if (!Number.isInteger(options.total) || options.total < 1)
    throw new Error('請先加入圖片並完成切割。')
  const active = () => {
    if (options.active && !options.active()) throw new Error('已取消 Word 產出。')
  }
  active()
  let template = options.template
  if (!template) {
    try {
      const response = await fetch('/templates/scam-screenshots-template.docx', {
        mode: 'same-origin',
      })
      if (!response.ok) throw new Error('template unavailable')
      template = await response.arrayBuffer()
    } catch {
      throw new Error('無法讀取 Word 範本，請稍後重試或聯絡管理員。')
    }
  }
  active()
  const zip = await JSZip.loadAsync(template)
  const read = async (path: string) => {
    const file = zip.file(path)
    if (!file) throw new Error('Word 範本不完整，請聯絡管理員。')
    return file.async('string')
  }
  const document = await read('word/document.xml')
  const section = document.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)?.[0]
  if (!section) throw new Error('Word 範本缺少頁面設定，請聯絡管理員。')
  zip.file('word/header1.xml', replaceHeaderName(await read('word/header1.xml'), name))
  let rels = await read('word/_rels/document.xml.rels')
  const pages: string[] = []
  let cells: string[] = []
  let count = 0
  await options.images(async (png) => {
    active()
    if (++count > options.total) throw new Error('切片數量不符，請重新產出。')
    const { width, height } = dimensions(png)
    checkDimensions(width, height)
    if (png[0] !== 137) throw new Error('Word 圖片必須為 PNG。')
    zip.file(`word/media/screenshot-${count}.png`, png, { createFolders: false })
    rels = rels.replace(
      '</Relationships>',
      `<Relationship Id="splitterImage${count}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/screenshot-${count}.png"/></Relationships>`,
    )
    cells.push(drawing(count, width, height))
    if (cells.length === 3) {
      pages.push(table(cells))
      cells = []
    }
    options.onProgress?.(count, options.total)
  })
  active()
  if (count !== options.total) throw new Error('切片數量不符，請重新產出。')
  if (cells.length) pages.push(table(cells))
  const pageBreak =
    '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>'
  const tail =
    '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>'
  zip.file(
    'word/document.xml',
    document.replace(
      /<w:body\b[^>]*>[\s\S]*?<\/w:body>/,
      `<w:body>${pages.join(pageBreak)}${tail}${section}</w:body>`,
    ),
  )
  zip.file('word/_rels/document.xml.rels', rels)
  let types = await read('[Content_Types].xml')
  if (!/<Default\b[^>]*Extension="png"/i.test(types))
    types = types.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>')
  zip.file('[Content_Types].xml', types)
  return new Uint8Array(
    await zip.generateAsync(
      { type: 'arraybuffer', compression: 'STORE', streamFiles: false },
      active,
    ),
  )
}
