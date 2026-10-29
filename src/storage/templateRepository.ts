import type { TemplateOrigin } from '@/types/domain'

export interface CategoryLink {
  id: string
  name: string
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
  categories: CategoryLink[]
}

export interface StoredTemplate extends TemplateSummary {
  data: ArrayBuffer
}

export interface TemplateRepository {
  list(): Promise<StoredTemplate[]>
  get(id: string): Promise<StoredTemplate | null>
  put(record: StoredTemplate, linkCategoryId?: string): Promise<void>
  delete(id: string): Promise<void>
  setCategoryTemplates(categoryId: string, templateIds: string[]): Promise<void>
  getMeta(key: string): Promise<string | null>
  setMeta(key: string, value: string): Promise<void>
}
