import { createIndexedDbTemplateRepository } from '@/storage/indexedDbTemplateRepository'
import type { TemplateRepository } from '@/storage/templateRepository'

export type { StoredTemplate, TemplateRepository } from '@/storage/templateRepository'

export function createTemplateRepository(): TemplateRepository {
  return createIndexedDbTemplateRepository()
}
