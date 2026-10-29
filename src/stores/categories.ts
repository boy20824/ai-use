import { caseCategories } from '@/data/mock'
import type { CaseCategory } from '@/types/domain'
import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'

export const useCategoryStore = defineStore('categories', () => {
  const items = shallowRef<CaseCategory[]>(caseCategories)
  const total = computed(() => items.value.length)
  const documentCount = computed(() =>
    items.value.reduce((totalCount, item) => totalCount + item.documents.length, 0),
  )
  const recent = computed(() =>
    [...items.value].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
  )

  function byId(id: string) {
    return items.value.find((item) => item.id === id)
  }

  function nameOf(id: string) {
    return byId(id)?.name ?? '未分類'
  }

  return { items, total, documentCount, recent, byId, nameOf }
})
