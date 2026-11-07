import type { FieldDef } from '@/types/domain'
import { inputFields, type OverviewTemplate } from './overview'

/** Labels are editable; saved keys are the explicit template mapping. Never infer aliases. */
export function fieldMappingIssues(fields: FieldDef[], templates: OverviewTemplate[]): string[] {
  const scanned = inputFields(templates)
  const outputHint = templates.length
    ? ''
    : '目前沒有關聯可用的輸出範本，請先將含此標記的 DOCX 關聯到步驟。'
  return fields
    .filter((field) => !scanned.includes(field.key))
    .map(
      (field) =>
        `欄位「${field.name ?? field.key}」的鍵「${field.key}」未出現在關聯範本。${outputHint}請在 Word 使用 {{${field.key}}} 並重新上傳，或移除此未使用的欄位定義。偵測到的欄位：${scanned.join('、') || '無'}。`,
    )
}
