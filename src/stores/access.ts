import { accessRoles, permissionRows, roleLabels, roleOrder } from '@/data/mock'
import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

export const useAccessStore = defineStore('access', () => {
  const roles = shallowRef(accessRoles)
  const rows = shallowRef(permissionRows)

  return { roles, rows, roleLabels, roleOrder }
})
