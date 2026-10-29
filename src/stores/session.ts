import { demoAccounts, roleAllows, roleLabels } from '@/data/mock'
import type { AppRole } from '@/types/domain'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export const useSessionStore = defineStore('session', () => {
  const accountId = ref<string | null>(null)

  const account = computed(() => demoAccounts.find((item) => item.id === accountId.value) ?? null)
  const authenticated = computed(() => account.value !== null)
  const displayName = computed(() => account.value?.displayName ?? '訪客')
  const role = computed<AppRole | null>(() => account.value?.role ?? null)
  const roleLabel = computed(() => (role.value ? roleLabels[role.value] : '未登入'))
  const canUpload = computed(() => (role.value ? roleAllows(role.value, 'upload') : false))

  function login(id: string) {
    const next = demoAccounts.find((item) => item.id === id)
    if (!next) return false
    accountId.value = next.id
    return true
  }

  function logout() {
    accountId.value = null
  }

  return {
    accountId,
    account,
    authenticated,
    displayName,
    role,
    roleLabel,
    canUpload,
    login,
    logout,
  }
})
