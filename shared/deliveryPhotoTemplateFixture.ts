import PizZip from 'pizzip'
import { buildDocx, run, wordDocument } from './docxFixture.ts'

const title = '臺南市政府警察局白河分局白河所相片黏貼用紙'
const tableWidth = 9490
const centered = '<w:jc w:val="center"/>'
const emptyTinyParagraph =
  '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>'

function paragraph(text: string, size: number, properties = '', line?: number) {
  const lineSpacing = line === undefined ? '' : ` w:line="${line}" w:lineRule="exact"`
  const runProperties = `<w:rPr><w:rFonts w:ascii="標楷體" w:eastAsia="標楷體" w:hAnsi="標楷體"/><w:sz w:val="${size}"/></w:rPr>`
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0"${lineSpacing}/>${properties}</w:pPr>${run(runProperties, text)}</w:p>`
}

function marker(text: string) {
  return paragraph(text, 2, '', 20)
}

function row(content: string, height: number, heightRule: 'exact' | 'atLeast', header = '') {
  return `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${height}" w:hRule="${heightRule}"/>${header}</w:trPr><w:tc><w:tcPr><w:tcW w:w="${tableWidth}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${content}</w:tc></w:tr>`
}

function photoRow(height: number) {
  return row(
    marker('{{#照片格}}') + paragraph('{{照片}}', 20, centered) + marker('{{/照片格}}'),
    height,
    'exact',
  )
}

export function buildDeliveryPhotoTemplate(): Uint8Array {
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:color="auto"/>`)
    .join('')
  const table =
    `<w:tbl><w:tblPr><w:tblW w:w="${tableWidth}" w:type="dxa"/>${centered}<w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="28" w:type="dxa"/><w:right w:w="28" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${tableWidth}"/></w:tblGrid>` +
    row(paragraph(title, 40, '<w:jc w:val="distribute"/>', 600), 770, 'exact', '<w:tblHeader/>') +
    row(
      paragraph(
        '說明：檢附應受送達人({{應受送達人}})之送達證書。',
        28,
        '<w:jc w:val="both"/>',
        280,
      ),
      513,
      'atLeast',
      '<w:tblHeader/>',
    ) +
    photoRow(6627) +
    photoRow(6175) +
    '</w:tbl>'
  const document = wordDocument(
    marker('{{#照片頁}}') +
      emptyTinyParagraph +
      table +
      emptyTinyParagraph +
      marker('{{/照片頁}}') +
      paragraph('備註：', 24, '', 240),
  ).replace(
    '</w:sectPr>',
    '<w:pgSz w:w="11906" w:h="16838" w:orient="portrait"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1418" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>',
  )
  const zip = new PizZip(buildDocx({ document }))
  // ZIP stores local date fields. Keep them fixed across rebuilds and time zones.
  for (const part of Object.values(zip.files)) part.date = new Date(2000, 0, 1)
  return zip.generate({ type: 'uint8array', compression: 'DEFLATE' })
}
