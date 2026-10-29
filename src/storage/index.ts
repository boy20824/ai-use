import { createApiTemplateRepository } from '@/storage/apiTemplateRepository'
import { createIndexedDbTemplateRepository } from '@/storage/indexedDbTemplateRepository'
import type { TemplateRepository } from '@/storage/templateRepository'

export type {
  StoredTemplate,
  TemplateRepository,
  TemplateSummary,
  TemplateUsage,
} from '@/storage/templateRepository'

export function templateStorageMode(): 'api' | 'indexeddb' {
  return import.meta.env.VITE_TEMPLATE_STORAGE === 'indexeddb' ? 'indexeddb' : 'api'
}

export function createTemplateRepository(): TemplateRepository {
  return templateStorageMode() === 'indexeddb'
    ? createIndexedDbTemplateRepository()
    : createApiTemplateRepository()
}
