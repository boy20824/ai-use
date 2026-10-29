import type { TemplateOrigin } from '@/types/domain'

export interface TemplateSummary {
  id: string
  categoryId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  addedAt: string
  placeholders: string[]
  origin: TemplateOrigin
}

export interface StoredTemplate extends TemplateSummary {
  data: ArrayBuffer
}

export interface TemplateRepository {
  list(): Promise<StoredTemplate[]>
  get(id: string): Promise<StoredTemplate | null>
  put(record: StoredTemplate): Promise<void>
  delete(id: string): Promise<void>
  getMeta(key: string): Promise<string | null>
  setMeta(key: string, value: string): Promise<void>
}
