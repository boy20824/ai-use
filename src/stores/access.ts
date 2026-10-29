import { accessRoles } from '@/data/mock'
import type { AccessRole } from '@/types/records'
import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'

export const useAccessStore = defineStore('access', () => {
  const roles = shallowRef<AccessRole[]>(accessRoles)
  const total = computed(() => roles.value.length)

  return { roles, total }
})
