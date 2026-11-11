import PizZip from 'pizzip'
import { buildDocx, wordDocument } from './docxFixture.ts'

function p(text: string, size = 28, extra = '') {
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/>${extra}</w:pPr><w:r><w:rPr><w:rFonts w:ascii="標楷體" w:eastAsia="標楷體" w:hAnsi="標楷體"/><w:sz w:val="${size}"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`
}
const grid = [677, 450, 450, 740, 740, 729, 670, 670, 671, 998, 998, 998]
function cell(text: string, start: number, span = 1, size = 28, merge = '', paragraph = '') {
  const width = grid.slice(start, start + span).reduce((a, b) => a + b, 0)
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:gridSpan w:val="${span}"/>${merge}<w:tcMar><w:left w:w="28" w:type="dxa"/><w:right w:w="28" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/></w:tcPr>${p(text, size, paragraph)}</w:tc>`
}
function row(content: string, height: number) {
  return `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${height}" w:hRule="atLeast"/></w:trPr>${content}</w:tr>`
}
function photoCell() {
  return (
    row(cell('{{#照片格}}編號{{照片編號}}', 0, 12), 400) +
    row(cell('{{照片}}', 0, 12, 20, '', '<w:jc w:val="center"/>'), 4300) +
    row(
      cell('攝影時間', 0, 2) +
        cell('{{攝影時間}}', 2, 2, 20) +
        cell('攝影地點', 4, 2) +
        cell('{{攝影地點}}', 6, 2, 20) +
        cell('攝影人', 8, 2) +
        cell('{{攝影人}}', 10, 2, 20),
      585,
    ) +
    row(cell('說明', 0, 2) + cell('{{照片說明}}{{/照片格}}', 2, 10, 20), 638)
  )
}
/** Reproducible mock only; no reference template or personal data is read. */
export function buildPhotoTemplate(): Uint8Array {
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:color="auto"/>`)
    .join('')
  const heading = p(
    'Mock 現場照片',
    40,
    '<w:jc w:val="distribute"/><w:ind w:left="1560" w:right="1560"/>',
  )
  const table =
    `<w:tbl><w:tblPr><w:tblW w:w="8791" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${borders}</w:tblBorders><w:tblCellMar><w:left w:w="28" w:type="dxa"/><w:right w:w="28" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
    row(
      cell('案號', 0, 1, 28, '<w:vMerge w:val="restart"/>') +
        ['年', '月', '警局', '分局', '案次編號'].map((v, i) => cell(v, i + 1)).join('') +
        cell('', 6, 6),
      420,
    ) +
    row(
      cell('', 0, 1, 20, '<w:vMerge/>') +
        ['年', '月', '警局', '分局', '案次編號']
          .map((v, i) => cell(`{{${v}}}`, i + 1, 1, 20))
          .join('') +
        cell('案由', 6, 3) +
        cell('{{案由}}', 9, 3, 20),
      572,
    ) +
    photoCell() +
    photoCell() +
    '</w:tbl>'
  const doc = wordDocument(p('{{#照片頁}}', 2) + heading + table + p('{{/照片頁}}', 2)).replace(
    '</w:sectPr>',
    '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="979" w:right="1797" w:bottom="709" w:left="1797"/></w:sectPr>',
  )
  const zip = new PizZip(buildDocx({ document: doc }))
  zip.file(
    'docProps/core.xml',
    '<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Mock</dc:creator><cp:lastModifiedBy>Mock</cp:lastModifiedBy><dc:title>Mock 現場照片範本</dc:title></cp:coreProperties>',
  )
  zip.file(
    '[Content_Types].xml',
    zip
      .file('[Content_Types].xml')!
      .asText()
      .replace(
        '</Types>',
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
      ),
  )
  zip.file(
    '_rels/.rels',
    zip
      .file('_rels/.rels')!
      .asText()
      .replace(
        '</Relationships>',
        '<Relationship Id="rIdMockCore" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
      ),
  )
  return zip.generate({ type: 'uint8array', compression: 'DEFLATE' })
}
