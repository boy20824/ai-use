import { hasZipHeader, maxTemplateBytes, safeFileName } from './docxTemplates'
import { isAllowedDocxMime } from '../../server/src/docx'
import { hasPdfHeader, maxPdfUploadBytes, pdfMimeType } from '../../shared/templateUpload'

export async function validateTemplateFile(file: File) {
  const fileName = safeFileName(file.name)
  if (!/\.(docx|pdf)$/i.test(fileName)) throw new Error('請選擇 .docx 或 .pdf。')
  const kind = fileName.toLowerCase().endsWith('.pdf') ? ('pdf' as const) : ('docx' as const)
  const limit = kind === 'pdf' ? maxPdfUploadBytes : maxTemplateBytes
  if (file.size > limit) throw new Error(`${fileName} 超過 ${kind === 'pdf' ? 20 : 8} MiB`)
  if (kind === 'pdf' ? file.type.toLowerCase() !== pdfMimeType : !isAllowedDocxMime(file.type))
    throw new Error(
      `${fileName} MIME 不正確${kind === 'pdf' ? '，PDF 必須為 application/pdf' : ''}。`,
    )
  const data = await file.arrayBuffer()
  if (kind === 'pdf' ? !hasPdfHeader(new Uint8Array(data)) : !hasZipHeader(data))
    throw new Error(
      `${fileName} ${kind === 'pdf' ? '不是 PDF（缺少 %PDF- 檔頭）' : '不是有效的 Word 檔'}。`,
    )
  return { kind, fileName, data }
}
