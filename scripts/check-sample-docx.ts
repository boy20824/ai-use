import { readFileSync } from 'node:fs'
import PizZip from 'pizzip'
import { listPlaceholders, renderDocx, zipGeneratedFiles } from '../src/services/docxTemplates.ts'

const source = readFileSync(new URL('../public/samples/field-note.docx', import.meta.url))
const placeholders = listPlaceholders(source)
const expected = ['姓名', '日期']

if (placeholders.join('|') !== expected.join('|')) {
  throw new Error(`placeholders were ${placeholders.join(', ') || '(none)'}`)
}

const rendered = renderDocx(source, { 姓名: '測試者', 日期: '2026-10-29' })
const xml = new PizZip(rendered).file('word/document.xml')?.asText() ?? ''

if (!xml.includes('測試者') || !xml.includes('2026-10-29')) {
  throw new Error('rendered document is missing the filled fields')
}
if (xml.includes('{{姓名}}') || xml.includes('{{日期}}')) {
  throw new Error('rendered document still contains placeholders')
}

const zip = await zipGeneratedFiles([{ name: '產生-欄位示範範本.docx', data: rendered }])
const zipped = new PizZip(await zip.arrayBuffer())
const packed = zipped.file('產生-欄位示範範本.docx')
if (!packed) {
  throw new Error('zip is missing the generated document')
}

const packedXml = new PizZip(packed.asUint8Array()).file('word/document.xml')?.asText() ?? ''
if (!packedXml.includes('測試者')) {
  throw new Error('zipped document is missing the filled name')
}

console.log('sample template rendered')
