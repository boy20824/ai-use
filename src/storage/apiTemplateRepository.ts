import { apiErrorMessage, apiRequest, apiPagedList } from '@/services/api'
import { templateMimeType } from '@/services/docxTemplates'
import type {
  StoredTemplate,
  TemplateRepository,
  TemplateSummary,
} from '@/storage/templateRepository'

export function createApiTemplateRepository(): TemplateRepository {
  return {
    async list() {
      const templates = await apiPagedList<TemplateSummary>(
        '/api/templates',
        'templates',
        '無法讀取範本文件。',
      )
      return templates.map((item) => ({
        ...item,
        kind: item.kind ?? 'docx',
        placeholders:
          item.kind === 'pdf' || !Array.isArray(item.placeholders) ? [] : item.placeholders,
        usages: item.usages ?? [],
        data: new ArrayBuffer(0),
      }))
    },
    async get(id) {
      const response = await apiRequest(`/api/templates/${encodeURIComponent(id)}/file`)
      if (response.status === 404) return null
      if (!response.ok) throw new Error(await apiErrorMessage(response, '無法下載範本。'))
      const data = await response.arrayBuffer()
      const mimeType = response.headers.get('content-type') ?? templateMimeType
      const kind = mimeType === 'application/pdf' ? 'pdf' : 'docx'
      const disposition = response.headers.get('content-disposition') ?? ''
      const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1]
      return {
        id,
        kind,
        fileName: encodedName ? decodeURIComponent(encodedName) : `template.${kind}`,
        mimeType,
        sizeBytes: data.byteLength,
        addedAt: '',
        placeholders: [],
        origin: 'upload',
        usages: [],
        data,
      } satisfies StoredTemplate
    },
    async put(record, stepId) {
      const body = new FormData()
      if (stepId) body.set('stepId', stepId)
      body.set('file', new File([record.data], record.fileName, { type: record.mimeType }))
      const response = await apiRequest('/api/templates', { method: 'POST', body })
      if (!response.ok) throw new Error(await apiErrorMessage(response, '無法上傳範本。'))
      const payload = (await response.json()) as {
        template?: { id?: string }
        formatNotices?: unknown
      }
      if (!payload.template?.id) throw new Error('無法上傳範本。')
      const formatNotices = Array.isArray(payload.formatNotices)
        ? payload.formatNotices.filter(
            (item): item is string => typeof item === 'string' && item.trim().length > 0,
          )
        : []
      return { id: payload.template.id, formatNotices }
    },
    async delete(id) {
      const response = await apiRequest(`/api/templates/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (response.status === 404) return
      if (!response.ok) throw new Error(await apiErrorMessage(response, '無法移除範本。'))
    },
    async getMeta() {
      return '1'
    },
    async setMeta() {
      // Sample seeding stays on the server when templates are stored in the API.
    },
  }
}
