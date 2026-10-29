import { displayFileName } from '@/utils/fileName'
import { parseRocDate } from '@/utils/rocDate'

export interface OverviewTemplate {
  id: string
  fileName: string
  placeholders: string[]
}

export function dedupedIds(steps: { templateIds: string[] }[]): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const step of steps) {
    for (const id of step.templateIds) {
      if (seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

export function overviewCatalog(
  categoryIds: string[],
  temporaryIds: string[],
  lookup: (id: string) => OverviewTemplate | undefined,
): OverviewTemplate[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const id of [...categoryIds, ...temporaryIds]) {
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  const templates: OverviewTemplate[] = []
  for (const id of ids) {
    const item = lookup(id)
    if (item) templates.push(item)
  }
  return templates
}

export function checkedTemplates<T extends { id: string }>(
  templates: T[],
  unchecked: Readonly<Record<string, boolean>>,
): T[] {
  return templates.filter((item) => unchecked[item.id] !== true)
}

export function inputFields(templates: { placeholders: string[] }[]): string[] {
  const ordered: string[] = []
  const seen = new Set<string>()
  let needsDate = false
  for (const template of templates) {
    for (const placeholder of template.placeholders) {
      const name = placeholder.trim()
      if (!name) continue
      if (name === '日期' || name === '日期_民國') {
        needsDate = true
        continue
      }
      if (seen.has(name)) continue
      seen.add(name)
      ordered.push(name)
    }
  }
  if (!needsDate) return ordered
  const fields = [...ordered]
  const nameIndex = fields.indexOf('姓名')
  fields.splice(nameIndex >= 0 ? nameIndex + 1 : 0, 0, '日期')
  return fields
}

export function valuesForFields(
  values: Record<string, string>,
  fields: string[],
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const field of fields) next[field] = values[field] ?? ''
  return next
}

export function missingOverviewFields(fields: string[], values: Record<string, string>): string[] {
  const missing: string[] = []
  for (const name of fields) {
    const raw = (values[name] ?? '').trim()
    if (!raw) {
      missing.push(name)
      continue
    }
    if (name === '日期' && !parseRocDate(raw)) missing.push('日期格式')
  }
  return missing
}

export function overviewDownloadName(fileName: string): string {
  return `產生-${displayFileName(fileName)}`
}
