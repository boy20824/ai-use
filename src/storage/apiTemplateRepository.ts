import { apiRequest } from '@/services/api'
import { templateMimeType } from '@/services/docxTemplates'
import type {
  StoredTemplate,
  TemplateRepository,
  TemplateSummary,
} from '@/storage/templateRepository'

async function errorMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { message?: string }
    if (body.message) return body.message
  } catch {
    // The response had no JSON body.
  }
  return fallback
}

export function createApiTemplateRepository(): TemplateRepository {
  return {
    async list() {
      const response = await apiRequest('/api/templates')
      if (!response.ok) throw new Error(await errorMessage(response, '無法讀取範本文件。'))
      const body = (await response.json()) as { templates: TemplateSummary[] }
      return body.templates.map((item) => ({ ...item, data: new ArrayBuffer(0) }))
    },
    async get(id) {
      const response = await apiRequest(`/api/templates/${encodeURIComponent(id)}/file`)
      if (response.status === 404) return null
      if (!response.ok) throw new Error(await errorMessage(response, '無法下載範本。'))
      const data = await response.arrayBuffer()
      return {
        id,
        categoryId: '',
        fileName: 'template.docx',
        mimeType: response.headers.get('content-type') ?? templateMimeType,
        sizeBytes: data.byteLength,
        addedAt: '',
        placeholders: [],
        origin: 'upload',
        data,
      } satisfies StoredTemplate
    },
    async put(record) {
      const body = new FormData()
      body.set('categoryId', record.categoryId)
      body.set('file', new File([record.data], record.fileName, { type: record.mimeType }))
      const response = await apiRequest('/api/templates', { method: 'POST', body })
      if (!response.ok) throw new Error(await errorMessage(response, '無法上傳範本。'))
    },
    async delete(id) {
      const response = await apiRequest(`/api/templates/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (response.status === 404) return
      if (!response.ok) throw new Error(await errorMessage(response, '無法移除範本。'))
    },
    async getMeta() {
      return '1'
    },
    async setMeta() {
      // Sample seeding stays on the server when templates are stored in the API.
    },
  }
}
