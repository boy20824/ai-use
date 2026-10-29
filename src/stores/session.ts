import { roleAllows, roleLabels } from '@/data/mock'
import { apiRequest } from '@/services/api'
import type { AppRole } from '@/types/domain'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export interface SessionUser {
  username: string
  displayName: string
  role: AppRole
}

export const useSessionStore = defineStore('session', () => {
  const user = ref<SessionUser | null>(null)
  const ready = ref(false)
  let pending: Promise<void> | null = null

  const authenticated = computed(() => user.value !== null)
  const displayName = computed(() => user.value?.displayName ?? '訪客')
  const role = computed<AppRole | null>(() => user.value?.role ?? null)
  const roleLabel = computed(() => (role.value ? roleLabels[role.value] : '未登入'))
  const canUpload = computed(() => (role.value ? roleAllows(role.value, 'upload') : false))
  const canDelete = computed(() => (role.value ? roleAllows(role.value, 'remove') : false))
  const canEditCategory = computed(() =>
    role.value ? roleAllows(role.value, 'editCategory') : false,
  )
  const canDeleteCategory = computed(() =>
    role.value ? roleAllows(role.value, 'deleteCategory') : false,
  )

  function applyUser(next: SessionUser | null) {
    user.value = next
    ready.value = true
  }

  function restore() {
    if (ready.value) return Promise.resolve()
    pending ??= (async () => {
      try {
        const response = await apiRequest('/api/auth/me')
        if (!response.ok) {
          applyUser(null)
          return
        }
        const body = (await response.json()) as { user?: SessionUser }
        applyUser(body.user ?? null)
      } catch {
        applyUser(null)
      }
    })()
    return pending
  }

  async function login(name: string, password: string): Promise<'ok' | 'invalid' | 'offline'> {
    try {
      const response = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: name.trim(), password }),
      })
      if (response.status === 401) return 'invalid'
      if (!response.ok) return 'offline'
      const body = (await response.json()) as { user?: SessionUser }
      if (!body.user) return 'offline'
      applyUser(body.user)
      pending = Promise.resolve()
      return 'ok'
    } catch {
      return 'offline'
    }
  }

  async function logout() {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' })
    } catch {
      // Clearing the local session still sends the user to the login page.
    }
    applyUser(null)
  }

  return {
    ready,
    authenticated,
    displayName,
    role,
    roleLabel,
    canUpload,
    canDelete,
    canEditCategory,
    canDeleteCategory,
    restore,
    login,
    logout,
  }
})
