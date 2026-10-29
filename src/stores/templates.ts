import {
  sampleTemplateCategoryId,
  sampleTemplateFileName,
  sampleTemplateId,
} from '@/data/sampleTemplate'
import {
  hasZipHeader,
  listPlaceholders,
  maxTemplateBytes,
  safeFileName,
  templateMimeType,
} from '@/services/docxTemplates'
import { createTemplateRepository, type StoredTemplate, type TemplateRepository } from '@/storage'
import type { TemplateOrigin } from '@/types/domain'
import { formatStamp } from '@/utils/format'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

const templateLimit = 30
const sampleSeedKey = 'sample-field-note-seeded'

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

export interface AddTemplatesResult {
  added: number
  skipped: number
  rejected: string[]
}

function toSummary(record: StoredTemplate): TemplateSummary {
  return {
    id: record.id,
    categoryId: record.categoryId,
    fileName: record.fileName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    addedAt: record.addedAt,
    placeholders: [...record.placeholders],
    origin: record.origin,
  }
}

function sortNewest(records: StoredTemplate[]) {
  return [...records].sort(
    (left, right) => right.addedAt.localeCompare(left.addedAt) || right.id.localeCompare(left.id),
  )
}

async function ensureSample(repository: TemplateRepository) {
  if ((await repository.getMeta(sampleSeedKey)) === '1') return
  const response = await fetch(`${import.meta.env.BASE_URL}samples/field-note.docx`)
  if (!response.ok) return
  const data = await response.arrayBuffer()
  await repository.put({
    id: sampleTemplateId,
    categoryId: sampleTemplateCategoryId,
    fileName: sampleTemplateFileName,
    mimeType: templateMimeType,
    sizeBytes: data.byteLength,
    addedAt: '2026-10-29 09:00',
    placeholders: listPlaceholders(data),
    origin: 'sample',
    data,
  })
  await repository.setMeta(sampleSeedKey, '1')
}

export const useTemplateStore = defineStore('templates', () => {
  const repository = createTemplateRepository()
  const items = ref<TemplateSummary[]>([])
  const bytes = shallowRef(new Map<string, ArrayBuffer>())
  const ready = ref(false)
  const error = ref('')
  let pending: Promise<void> | null = null

  const total = computed(() => items.value.length)

  function remember(records: StoredTemplate[]) {
    const next = new Map<string, ArrayBuffer>()
    for (const record of records) next.set(record.id, record.data)
    bytes.value = next
    items.value = sortNewest(records).map(toSummary)
  }

  async function reload() {
    remember(await repository.list())
  }

  function load() {
    pending ??= (async () => {
      try {
        await ensureSample(repository)
        await reload()
        error.value = ''
      } catch {
        error.value = '無法讀取這個瀏覽器裡的範本文件。'
      } finally {
        ready.value = true
      }
    })()
    return pending
  }

  async function addFiles(categoryId: string, files: File[]): Promise<AddTemplatesResult> {
    await load()
    const rejected: string[] = []
    const room = templateLimit - items.value.length
    if (room <= 0) {
      return { added: 0, skipped: files.length, rejected }
    }

    const accepted = files.slice(0, room)
    const skipped = files.length - accepted.length
    let added = 0

    for (const file of accepted) {
      const fileName = safeFileName(file.name)
      if (!fileName.toLowerCase().endsWith('.docx')) {
        rejected.push(`${fileName || '未命名檔案'} 不是 .docx`)
        continue
      }
      if (file.size > maxTemplateBytes) {
        rejected.push(`${fileName} 超過 8 MB`)
        continue
      }
      const data = await file.arrayBuffer()
      if (!hasZipHeader(data)) {
        rejected.push(`${fileName} 不是有效的 Word 檔`)
        continue
      }
      let placeholders: string[]
      try {
        placeholders = listPlaceholders(data)
      } catch {
        rejected.push(`${fileName} 無法讀取`)
        continue
      }
      await repository.put({
        id: crypto.randomUUID(),
        categoryId,
        fileName,
        mimeType: templateMimeType,
        sizeBytes: data.byteLength,
        addedAt: formatStamp(new Date()),
        placeholders,
        origin: 'upload',
        data,
      })
      added += 1
    }

    if (added > 0) await reload()
    return { added, skipped, rejected }
  }

  async function remove(id: string) {
    await load()
    await repository.delete(id)
    await reload()
  }

  function bytesFor(id: string): ArrayBuffer | null {
    const data = bytes.value.get(id)
    if (!data) return null
    return data.slice(0)
  }

  void load()

  return { items, total, ready, error, limit: templateLimit, load, addFiles, remove, bytesFor }
})
