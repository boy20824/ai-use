import { personnelRecords } from '@/data/mock'
import type { PersonnelRecord } from '@/types/records'
import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'

export const usePersonnelStore = defineStore('personnel', () => {
  const items = shallowRef<PersonnelRecord[]>(personnelRecords)
  const total = computed(() => items.value.length)
  const activeCount = computed(() => items.value.filter((item) => item.status === '在職').length)

  return { items, total, activeCount }
})
