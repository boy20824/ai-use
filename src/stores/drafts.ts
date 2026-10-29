import { seedDrafts } from '@/data/mock'
import type { DraftFile } from '@/types/domain'
import { formatStamp } from '@/utils/format'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

const draftLimit = 30

export const useDraftStore = defineStore('drafts', () => {
  const items = ref<DraftFile[]>(seedDrafts.map((item) => ({ ...item })))
  const total = computed(() => items.value.length)

  function addFromFiles(categoryId: string, files: File[]) {
    const named = files.flatMap((file) => {
      const fileName = file.name.trim().slice(0, 180)
      return fileName ? [{ file, fileName }] : []
    })
    const room = draftLimit - items.value.length
    if (room <= 0) {
      return { added: 0, skipped: named.length }
    }

    const accepted = named.slice(0, room)
    const skipped = named.length - accepted.length
    const stamped = formatStamp(new Date())
    const next: DraftFile[] = accepted.map(({ file, fileName }) => ({
      id: crypto.randomUUID(),
      categoryId,
      fileName,
      sizeBytes: file.size,
      mimeType: file.type,
      addedAt: stamped,
      source: '本機',
    }))

    if (next.length > 0) {
      items.value = [...next, ...items.value]
    }

    return { added: next.length, skipped }
  }

  function remove(id: string) {
    items.value = items.value.filter((item) => item.id !== id)
  }

  return { items, total, limit: draftLimit, addFromFiles, remove }
})
