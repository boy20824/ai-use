import { roleLabels } from '@/data/roles'
import { apiErrorMessage, apiRequest } from '@/services/api'
import type { AppRole } from '@/types/domain'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export interface SessionUser {
  id: string
  username: string
  displayName: string
  nickname: string
  role: AppRole
  canManageCategories: boolean
}

export interface RegisterInput {
  name: string
  nickname: string
  username: string
  password: string
  confirmPassword: string
}

export type RegisterResult =
  { ok: true } | { ok: false; reason: 'invalid' | 'limited' | 'offline'; message: string }

export const useSessionStore = defineStore('session', () => {
  const user = ref<SessionUser | null>(null)
  const ready = ref(false)
  let pending: Promise<void> | null = null

  const authenticated = computed(() => user.value !== null)
  const displayName = computed(() => user.value?.displayName ?? '訪客')
  const role = computed<AppRole | null>(() => user.value?.role ?? null)
  const roleLabel = computed(() => (role.value ? roleLabels[role.value] : '未登入'))
  const isSysadmin = computed(() => role.value === 'sysadmin')
  const canEditCategory = computed(
    () => isSysadmin.value || user.value?.canManageCategories === true,
  )
  const canUpload = computed(() => canEditCategory.value)
  const canDelete = computed(() => isSysadmin.value)
  const canDeleteCategory = computed(() => isSysadmin.value)
  const canManageMembers = computed(() => isSysadmin.value)

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

  async function register(input: RegisterInput): Promise<RegisterResult> {
    try {
      const response = await apiRequest('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: input.name.trim(),
          nickname: input.nickname.trim(),
          username: input.username.trim(),
          password: input.password,
          confirmPassword: input.confirmPassword,
        }),
      })
      if (response.status === 429) {
        return {
          ok: false,
          reason: 'limited',
          message: await apiErrorMessage(response, '註冊嘗試過多，請稍後再試。'),
        }
      }
      if (!response.ok) {
        return {
          ok: false,
          reason: 'invalid',
          message: await apiErrorMessage(response, '無法完成註冊，請確認資料後再試。'),
        }
      }
      const body = (await response.json()) as { user?: SessionUser }
      if (!body.user) {
        return { ok: false, reason: 'offline', message: '無法完成註冊，請稍後再試。' }
      }
      applyUser(body.user)
      pending = Promise.resolve()
      return { ok: true }
    } catch {
      return { ok: false, reason: 'offline', message: '無法連線。請確認服務已啟動。' }
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
    user,
    ready,
    authenticated,
    displayName,
    role,
    roleLabel,
    isSysadmin,
    canUpload,
    canDelete,
    canEditCategory,
    canDeleteCategory,
    canManageMembers,
    restore,
    login,
    register,
    logout,
  }
})
