import PizZip from 'pizzip'
import { buildDocx, run, wordDocument } from './docxFixture.ts'

const title = 'Mock 送達證書黏貼單'
const tableWidth = 9490
const centered = '<w:jc w:val="center"/>'
const tinyParagraphProperties =
  '<w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr>'

function paragraph(text: string, size: number, properties = '', lineSpacing = '') {
  const runProperties = `<w:rPr><w:rFonts w:ascii="標楷體" w:eastAsia="標楷體" w:hAnsi="標楷體"/><w:sz w:val="${size}"/></w:rPr>`
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0"${lineSpacing}/>${properties}</w:pPr>${run(runProperties, text)}</w:p>`
}

function marker(text: string) {
  return `<w:p>${tinyParagraphProperties}${run('<w:rPr><w:sz w:val="2"/></w:rPr>', text)}</w:p>`
}

function row(content: string, height: number, heightRule: 'exact' | 'atLeast', header = '') {
  return `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${height}" w:hRule="${heightRule}"/>${header}</w:trPr><w:tc><w:tcPr><w:tcW w:w="${tableWidth}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${content}</w:tc></w:tr>`
}

function photoRow(height: number) {
  return row(
    paragraph('{{#照片格}}編號{{照片編號}}', 20) +
      // The image shares a cell with two text paragraphs, so reserve room for both.
      paragraph('{{照片}}', 20, centered, ' w:line="800" w:lineRule="atLeast"') +
      paragraph('{{照片說明}}{{/照片格}}', 20),
    height,
    'atLeast',
  )
}

export function buildDeliveryPhotoTemplate(): Uint8Array {
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:color="auto"/>`)
    .join('')
  const table =
    `<w:tbl><w:tblPr><w:tblW w:w="${tableWidth}" w:type="dxa"/>${centered}<w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="28" w:type="dxa"/><w:right w:w="28" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${tableWidth}"/></w:tblGrid>` +
    row(paragraph(title, 32, centered), 770, 'exact', '<w:tblHeader/>') +
    row(paragraph('應受送達人：{{應受送達人}}', 24), 513, 'atLeast', '<w:tblHeader/>') +
    photoRow(6627) +
    photoRow(6175) +
    '</w:tbl>'
  const document = wordDocument(
    marker('{{#照片頁}}') +
      paragraph(title, 28, `${centered}<w:outlineLvl w:val="0"/>`) +
      table +
      `<w:p>${tinyParagraphProperties}</w:p>` +
      marker('{{/照片頁}}'),
  ).replace(
    '</w:sectPr>',
    '<w:pgSz w:w="11906" w:h="16838" w:orient="portrait"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1418" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>',
  )
  const zip = new PizZip(buildDocx({ document }))
  // ZIP stores local date fields. Keep them fixed across rebuilds and time zones.
  for (const part of Object.values(zip.files)) part.date = new Date(2000, 0, 1)
  return zip.generate({ type: 'uint8array', compression: 'DEFLATE' })
}
