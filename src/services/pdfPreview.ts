import { apiErrorMessage, apiRequest } from './api'
import { pdfMimeType } from '../../shared/templateUpload'

export async function previewPdf(id: string) {
  // Reserve the tab during the click, before the authenticated fetch yields.
  const tab = window.open('', '_blank')
  if (!tab) throw new Error('請允許開啟新分頁以預覽 PDF。')
  tab.opener = null
  let url: string | undefined
  try {
    const response = await apiRequest(`/api/templates/${encodeURIComponent(id)}/file?inline=1`)
    if (!response.ok) throw new Error(await apiErrorMessage(response, '無法預覽 PDF。'))
    const blob = new Blob([await response.arrayBuffer()], { type: pdfMimeType })
    url = URL.createObjectURL(blob)
    tab.location.replace(url)
  } catch (cause) {
    tab.close()
    throw cause
  } finally {
    // Keep it alive long enough for the browser's PDF viewer to consume it.
    if (url) {
      const openedUrl = url
      setTimeout(() => URL.revokeObjectURL(openedUrl), 60_000)
    }
  }
}
