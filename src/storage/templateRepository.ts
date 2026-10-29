import type { TemplateOrigin } from '@/types/domain'

export interface TemplateUsage {
  categoryId: string
  categoryName: string
  stepId: string
  stepBody: string
  sortOrder: number
}

export interface TemplateSummary {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  addedAt: string
  placeholders: string[]
  origin: TemplateOrigin
  usages: TemplateUsage[]
}

export interface StoredTemplate extends TemplateSummary {
  data: ArrayBuffer
}

export interface TemplateRepository {
  list(): Promise<StoredTemplate[]>
  get(id: string): Promise<StoredTemplate | null>
  put(record: StoredTemplate, stepId?: string): Promise<string>
  delete(id: string): Promise<void>
  getMeta(key: string): Promise<string | null>
  setMeta(key: string, value: string): Promise<void>
}
