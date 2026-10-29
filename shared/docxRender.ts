// Browser rendering. The production image does not install docxtemplater,
// so server runtime code must not import this file.
import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'
import { docxZipLimits, normalizeDocx } from '../server/src/docxXml.ts'

export function renderDocx(
  data: ArrayBuffer | Uint8Array,
  values: Record<string, string>,
): Uint8Array {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const normalized = normalizeDocx(bytes, docxZipLimits)
  const zip = new PizZip(normalized.data)
  const doc = new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '',
  })
  doc.render({ ...values })
  const output = doc.getZip().generate({ type: 'uint8array' })
  return output instanceof Uint8Array ? output : new Uint8Array(output)
}
