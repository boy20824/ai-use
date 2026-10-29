import { docxZipLimits, normalizeDocx, splitFormatNotice } from '../../server/src/docxXml'
import {
  hasZipHeader,
  listPlaceholders,
  maxTemplateBytes,
  safeFileName,
  templateMimeType,
} from '@/services/docxTemplates'
import {
  createTemplateRepository,
  templateStorageMode,
  type StoredTemplate,
  type TemplateSummary,
} from '@/storage'
import { formatStamp } from '@/utils/format'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

const templateLimit = 30

export interface AddTemplatesResult {
  added: number
  skipped: number
  rejected: string[]
  ids: string[]
  formatNotices: string[]
  formatNotice: string
}

function toSummary(record: StoredTemplate): TemplateSummary {
  return {
    id: record.id,
    fileName: record.fileName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    addedAt: record.addedAt,
    placeholders: [...record.placeholders],
    origin: record.origin,
    usages: record.usages.map((usage) => ({ ...usage })),
  }
}

function sortNewest(records: StoredTemplate[]) {
  return [...records].sort(
    (left, right) => right.addedAt.localeCompare(left.addedAt) || right.id.localeCompare(left.id),
  )
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
    for (const record of records) {
      if (record.data.byteLength > 0) next.set(record.id, record.data)
    }
    bytes.value = next
    items.value = sortNewest(records).map(toSummary)
  }

  async function reload() {
    remember(await repository.list())
  }

  function load() {
    pending ??= (async () => {
      try {
        if (import.meta.env.DEV && templateStorageMode() === 'indexeddb') {
          const { ensureSampleTemplates } = await import('@/dev/sampleSeed')
          await ensureSampleTemplates(repository)
        }
        await reload()
        error.value = ''
      } catch {
        error.value = '無法讀取範本文件。'
      } finally {
        ready.value = true
      }
    })()
    return pending
  }

  function byId(id: string) {
    return items.value.find((item) => item.id === id)
  }

  async function addFiles(files: File[], stepId?: string): Promise<AddTemplatesResult> {
    await load()
    const rejected: string[] = []
    const ids: string[] = []
    const formatNotices: string[] = []
    const seenNotices = new Set<string>()
    const note = (tags: string[]) => {
      for (const tag of tags) {
        if (!tag || seenNotices.has(tag)) continue
        seenNotices.add(tag)
        formatNotices.push(tag)
      }
    }
    const room = templateLimit - items.value.length
    if (room <= 0) {
      return {
        added: 0,
        skipped: files.length,
        rejected,
        ids,
        formatNotices,
        formatNotice: '',
      }
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
      let payload = data
      let sizeBytes = data.byteLength
      let placeholders: string[]
      const localNotices: string[] = []
      try {
        if (templateStorageMode() === 'indexeddb') {
          const normalized = normalizeDocx(new Uint8Array(data), docxZipLimits)
          localNotices.push(...normalized.notices)
          const copy = new Uint8Array(normalized.data.byteLength)
          copy.set(normalized.data)
          payload = copy.buffer
          sizeBytes = copy.byteLength
          placeholders = listPlaceholders(copy)
        } else {
          placeholders = listPlaceholders(data)
        }
      } catch {
        rejected.push(`${fileName} 無法讀取`)
        continue
      }
      try {
        const created = await repository.put(
          {
            id: crypto.randomUUID(),
            fileName,
            mimeType: templateMimeType,
            sizeBytes,
            addedAt: formatStamp(new Date()),
            placeholders,
            origin: 'upload',
            usages: [],
            data: payload,
          },
          stepId,
        )
        ids.push(created.id)
        note([...localNotices, ...created.formatNotices])
        added += 1
      } catch (cause) {
        rejected.push(cause instanceof Error ? cause.message : `${fileName} 無法上傳`)
      }
    }

    if (added > 0) await reload()
    return {
      added,
      skipped,
      rejected,
      ids,
      formatNotices,
      formatNotice: splitFormatNotice(formatNotices),
    }
  }

  async function remove(id: string) {
    await load()
    await repository.delete(id)
    await reload()
  }

  async function bytesFor(id: string): Promise<ArrayBuffer | null> {
    const cached = bytes.value.get(id)
    if (cached && cached.byteLength > 0) return cached.slice(0)
    const record = await repository.get(id)
    if (!record || record.data.byteLength === 0) return null
    const next = new Map(bytes.value)
    next.set(id, record.data)
    bytes.value = next
    return record.data.slice(0)
  }

  void load()

  return {
    items,
    total,
    ready,
    error,
    limit: templateLimit,
    load,
    reload,
    byId,
    addFiles,
    remove,
    bytesFor,
  }
})
