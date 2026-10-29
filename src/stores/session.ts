import { roleAllows, roleLabels } from '@/data/mock'
import { mockUsers } from '@/data/mockUsers'
import type { AppRole } from '@/types/domain'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export const useSessionStore = defineStore('session', () => {
  const username = ref<string | null>(null)

  const account = computed(() => mockUsers.find((item) => item.username === username.value) ?? null)
  const authenticated = computed(() => account.value !== null)
  const displayName = computed(() => account.value?.displayName ?? '訪客')
  const role = computed<AppRole | null>(() => account.value?.role ?? null)
  const roleLabel = computed(() => (role.value ? roleLabels[role.value] : '未登入'))
  const canUpload = computed(() => (role.value ? roleAllows(role.value, 'upload') : false))

  function login(name: string, password: string) {
    const usernameValue = name.trim()
    const match = mockUsers.find(
      (item) => item.username === usernameValue && item.password === password,
    )
    if (!match) return false
    username.value = match.username
    return true
  }

  function logout() {
    username.value = null
  }

  return {
    authenticated,
    displayName,
    role,
    roleLabel,
    canUpload,
    login,
    logout,
  }
})
