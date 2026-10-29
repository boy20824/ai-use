import { sampleTemplateFileName, sampleTemplateId } from '@/data/sampleTemplate'
import { listPlaceholders, templateMimeType } from '@/services/docxTemplates'
import type { TemplateRepository } from '@/storage'

const sampleSeedKey = 'sample-field-note-seeded'

function sampleSeedEnabled() {
  return (
    import.meta.env.VITE_SEED_SAMPLE_DATA === 'true' ||
    import.meta.env.VITE_SEED_DEMO_USERS === 'true'
  )
}

export async function ensureSampleTemplates(repository: TemplateRepository) {
  if (!sampleSeedEnabled()) return
  if ((await repository.getMeta(sampleSeedKey)) === '1') return
  const response = await fetch(`${import.meta.env.BASE_URL}samples/field-note.docx`)
  if (!response.ok) return
  const data = await response.arrayBuffer()
  await repository.put({
    id: sampleTemplateId,
    fileName: sampleTemplateFileName,
    mimeType: templateMimeType,
    sizeBytes: data.byteLength,
    addedAt: '2026-10-29 09:00',
    placeholders: listPlaceholders(data),
    origin: 'sample',
    usages: [],
    data,
  })
  await repository.setMeta(sampleSeedKey, '1')
}
