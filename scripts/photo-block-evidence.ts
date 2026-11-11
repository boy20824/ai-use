import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildPhotoTemplate } from '../shared/photoTemplateFixture.ts'
import { mockPhotoDraft, mockPhotoFields } from '../shared/photoMock.ts'
import { renderPhotoDocx } from '../shared/photoBlockRender.ts'
import {
  assertSafeZip,
  docxZipLimits,
  listPlaceholders,
  normalizeDocx,
} from '../server/src/docxXml.ts'

const destination = process.argv[2] ?? '/workspace/evidence/photo-block'
await mkdir(destination, { recursive: true })
const template = buildPhotoTemplate()
listPlaceholders(template)
for (const count of [2, 5, 7]) {
  const output = renderPhotoDocx(template, mockPhotoFields, mockPhotoDraft(count))
  assertSafeZip(output, docxZipLimits)
  normalizeDocx(output, docxZipLimits)
  const file = path.join(destination, `mock-${count}.docx`)
  await writeFile(file, output)
  console.log(`已產生並驗證 ${file}`)
}
