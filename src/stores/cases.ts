import { caseRecords } from '@/data/mock'
import type { CaseRecord } from '@/types/records'
import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'

export const useCaseStore = defineStore('cases', () => {
  const items = shallowRef<CaseRecord[]>(caseRecords)
  const total = computed(() => items.value.length)
  const pendingCount = computed(() => items.value.filter((item) => item.status === '審核中').length)
  const recent = computed(() =>
    [...items.value]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 4),
  )

  return { items, total, pendingCount, recent }
})
