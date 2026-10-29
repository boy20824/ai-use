import { apiErrorMessage, apiRequest } from '@/services/api'
import type { CaseCategory, CategoryInput } from '@/types/domain'
import { defineStore } from 'pinia'
import { computed, shallowRef, ref } from 'vue'

export const useCategoryStore = defineStore('categories', () => {
  const items = shallowRef<CaseCategory[]>([])
  const ready = ref(false)
  const error = ref('')
  let pending: Promise<void> | null = null

  const total = computed(() => items.value.length)
  const stepCount = computed(() =>
    items.value.reduce((totalCount, item) => totalCount + item.steps.length, 0),
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

  async function reload() {
    try {
      const response = await apiRequest('/api/categories')
      if (!response.ok) throw new Error(await apiErrorMessage(response, '無法讀取案件類別。'))
      const body = (await response.json()) as { categories?: CaseCategory[] }
      items.value = body.categories ?? []
      error.value = ''
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '無法讀取案件類別。'
    } finally {
      ready.value = true
    }
  }

  function load() {
    pending ??= reload()
    return pending
  }

  async function create(input: CategoryInput) {
    const response = await apiRequest('/api/categories', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error(await apiErrorMessage(response, '無法建立案件類別。'))
    const body = (await response.json()) as { category?: CaseCategory }
    await reload()
    if (!body.category) throw new Error('無法建立案件類別。')
    return body.category
  }

  async function update(id: string, input: CategoryInput) {
    const response = await apiRequest(`/api/categories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error(await apiErrorMessage(response, '無法更新案件類別。'))
    await reload()
  }

  async function remove(id: string) {
    const response = await apiRequest(`/api/categories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    if (!response.ok) throw new Error(await apiErrorMessage(response, '無法刪除案件類別。'))
    await reload()
  }

  void load()

  return {
    items,
    total,
    stepCount,
    recent,
    ready,
    error,
    byId,
    nameOf,
    load,
    reload,
    create,
    update,
    remove,
  }
})
