import PizZip from 'pizzip'
import { docxZipLimits, normalizeDocx, readSafeZip } from '../server/src/docxXml.ts'
import { parsePhotoBlock, photoFields } from '../server/src/photoBlocks.ts'
import { renderDocx } from './docxRender.ts'

export interface PhotoValues {
  time: string
  location: string
  photographer: string
}
export interface BlockPhoto {
  id: string
  bytes: Uint8Array
  mime: 'image/png' | 'image/jpeg'
  width: number
  height: number
  description: string
  overrides?: Partial<PhotoValues>
}
export interface PhotoDraft {
  common: PhotoValues
  photos: BlockPhoto[]
}
export type PhotoDrafts = Record<string, PhotoDraft>
export const maxPhotoCount = 30
export const maxPhotoBytes = 10 * 1024 * 1024

export function photoPageCount(count: number, cellsPerPage: number): number {
  if (!Number.isInteger(cellsPerPage) || cellsPerPage < 1 || !Number.isInteger(count) || count < 0)
    throw new Error('照片數量或每頁格數無效。')
  return Math.ceil(count / cellsPerPage)
}
export function photoNumber(index: number): string {
  return `（${index + 1}）`
}
export function effectivePhotoValues(common: PhotoValues, photo: BlockPhoto): PhotoValues {
  return { ...common, ...photo.overrides }
}
export function movePhoto<T>(photos: readonly T[], from: number, to: number): T[] {
  const next = [...photos]
  if (from < 0 || to < 0 || from >= next.length || to >= next.length) return next
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}
export function fitPhoto(width: number, height: number, maxWidth: number, maxHeight: number) {
  if (![width, height, maxWidth, maxHeight].every((n) => Number.isFinite(n) && n > 0))
    throw new Error('無法讀取照片尺寸。')
  const scale = Math.min(maxWidth / width, maxHeight / height)
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  }
}
export function checkPhotoBytes(
  bytes: Uint8Array,
  mime: string,
): asserts mime is BlockPhoto['mime'] {
  if (bytes.length > maxPhotoBytes) throw new Error('單張照片不可超過 10 MB。')
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((b, n) => bytes[n] === b)
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (!((mime === 'image/png' && png) || (mime === 'image/jpeg' && jpeg)))
    throw new Error('只接受內容與格式相符的 PNG / JPEG 照片。')
}

function drawing(rid: string, id: number, width: number, height: number): string {
  return `<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${id}" name="Photo ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="Photo ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
}

function pageBreakBefore(content: string): string {
  return content.replace(
    /<w:p\b[^>]*>(\s*<w:pPr\b[^>]*\/?>)?/,
    (start, ppr: string | undefined) => {
      if (ppr?.endsWith('/>'))
        return start.replace(/<w:pPr\b[^>]*\/>$/, '<w:pPr><w:pageBreakBefore/></w:pPr>')
      return ppr ? `${start}<w:pageBreakBefore/>` : `${start}<w:pPr><w:pageBreakBefore/></w:pPr>`
    },
  )
}

/** Photo text is bound by docxtemplater only once, together with regular values.
 * This also keeps user-entered double braces literal and prevents template injection. */
export function renderPhotoDocx(
  data: ArrayBuffer | Uint8Array,
  values: Record<string, string>,
  draft: PhotoDraft = { common: { time: '', location: '', photographer: '' }, photos: [] },
): Uint8Array {
  const normalized = normalizeDocx(data, docxZipLimits)
  const zip = new PizZip(normalized.data)
  const xml = zip.file('word/document.xml')!.asText()
  const block = parsePhotoBlock(xml)
  if (!block) return renderDocx(data, values)
  if (draft.photos.length > maxPhotoCount) throw new Error(`每份範本最多 ${maxPhotoCount} 張照片。`)
  let rels =
    zip.file('word/_rels/document.xml.rels')?.asText() ??
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
  let types = zip.file('[Content_Types].xml')!.asText()
  // Reserve IDs across every part, including drawings in headers and footers.
  let docPr = 0
  for (const part of zip.file(/\.xml$/)) {
    for (const m of part.asText().matchAll(/<(?:\w+:)?docPr\b[^>]*\bid=["'](\d+)["']/g))
      docPr = Math.max(docPr, Number(m[1]))
  }
  let serial = 0
  const bindings = { ...values }
  let prefix = '__photo'
  while (xml.includes(prefix) || Object.keys(values).some((key) => key.startsWith(prefix)))
    prefix += '_'
  const bind = (value: string) => {
    const name = `${prefix}${++serial}`
    bindings[name] = value
    return `{{${name}}}`
  }
  const pages: string[] = []
  for (let page = 0; page < photoPageCount(draft.photos.length, block.photoCellsPerPage); page++) {
    let content = xml.slice(block.contentStart, block.contentEnd)
    // Replace backwards so all source offsets remain valid.
    for (let slot = block.cells.length - 1; slot >= 0; slot--) {
      const cell = block.cells[slot]!
      const photoIndex = page * block.cells.length + slot
      const photo = draft.photos[photoIndex]
      let cellXml = xml.slice(cell.start, cell.end)
      let image = ''
      const resolved = photo ? effectivePhotoValues(draft.common, photo) : null
      if (photo) {
        checkPhotoBytes(photo.bytes, photo.mime)
        const size = fitPhoto(photo.width, photo.height, cell.width, cell.height)
        let ridIndex = 1
        while (new RegExp(`\\bId\\s*=\\s*["']rId${ridIndex}["']`).test(rels)) ridIndex++
        const rid = `rId${ridIndex}`
        const extension = photo.mime === 'image/png' ? 'png' : 'jpeg'
        let mediaIndex = photoIndex + 1
        while (zip.file(`word/media/photo-${mediaIndex}.${extension}`)) mediaIndex++
        const file = `photo-${mediaIndex}.${extension}`
        zip.file(`word/media/${file}`, photo.bytes)
        rels = rels.replace(/<Relationships([^>]*)\/>/, '<Relationships$1></Relationships>')
        rels = rels.replace(
          '</Relationships>',
          `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${file}"/></Relationships>`,
        )
        if (!new RegExp(`Extension=["']${extension}["']`).test(types))
          types = types.replace(
            '</Types>',
            `<Default Extension="${extension}" ContentType="${photo.mime}"/></Types>`,
          )
        image = drawing(rid, ++docPr, size.width, size.height)
      }
      // Keep the image paragraph's pPr; replace its marker run with inline drawing.
      const imageXml = xml
        .slice(cell.imageStart, cell.imageEnd)
        .replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, '')
        .replace('</w:p>', `${image}</w:p>`)
      cellXml =
        cellXml.slice(0, cell.imageStart - cell.start) +
        imageXml +
        cellXml.slice(cell.imageEnd - cell.start)
      const cellValues: Record<string, string> = {
        照片編號: photo ? photoNumber(photoIndex) : '',
        攝影時間: resolved?.time ?? '',
        攝影地點: resolved?.location ?? '',
        攝影人: resolved?.photographer ?? '',
        照片說明: photo?.description ?? '',
      }
      cellXml = cellXml.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (token, raw: string) => {
        const name = raw.trim()
        if (/^[#/](照片格)$/.test(name)) return ''
        return photoFields.has(name) ? bind(cellValues[name] ?? '') : token
      })
      content =
        content.slice(0, cell.start - block.contentStart) +
        cellXml +
        content.slice(cell.end - block.contentStart)
    }
    // Remove author-supplied title breaks; insert exactly one between generated pages.
    content = content.replace(/<w:pageBreakBefore\b[^>]*\/>/g, '')
    if (page > 0) content = pageBreakBefore(content)
    pages.push(content)
  }
  const documentXml = (xml.slice(0, block.start) + pages.join('') + xml.slice(block.end)).replace(
    /(<(?:\w+:)?docPr\b[^>]*\bid=)(["'])[^"']*\2/g,
    (_, before: string, quote: string) => `${before}${quote}${++docPr}${quote}`,
  )
  zip.file('word/document.xml', documentXml)
  zip.file('word/_rels/document.xml.rels', rels)
  zip.file('[Content_Types].xml', types)
  const expanded = zip.generate({ type: 'uint8array', compression: 'DEFLATE' })
  const output = renderDocx(expanded, bindings)
  // Keep exactly the same container limits as uploads. Do not return an oversized DOCX.
  try {
    readSafeZip(output, docxZipLimits)
  } catch {
    throw new Error('照片文件超過安全容量限制，請減少照片數量或尺寸。')
  }
  return output
}

export function renderTemplatePhotos(
  templateId: string,
  data: ArrayBuffer | Uint8Array,
  values: Record<string, string>,
  drafts: PhotoDrafts,
): Uint8Array {
  return renderPhotoDocx(data, values, drafts[templateId])
}
