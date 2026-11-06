<script setup lang="ts">
import PageIntro from '@/components/PageIntro.vue'
import { apiErrorMessage, apiRequest } from '@/services/api'
import { ref } from 'vue'

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const busy = ref(false)
const error = ref('')
const success = ref(false)

async function submit() {
  if (busy.value) return
  error.value = ''
  success.value = false
  if (newPassword.value.length < 12 || new TextEncoder().encode(newPassword.value).length > 72) {
    error.value = '新密碼至少 12 碼，且不得超過 72 個 UTF-8 位元組。'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = '兩次輸入的新密碼不一致。'
    return
  }
  busy.value = true
  try {
    const response = await apiRequest('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value,
      }),
    })
    if (!response.ok) {
      error.value = await apiErrorMessage(response, '無法變更密碼，請稍後再試。')
      return
    }
    success.value = true
  } catch {
    error.value = '無法連線，請稍後再試。'
  } finally {
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    busy.value = false
  }
}
</script>

<template>
  <PageIntro
    eyebrow="帳號設定"
    title="變更密碼"
    description="更新密碼後，其他裝置的登入將失效，目前的登入會保留。"
  />
  <form
    class="max-w-lg space-y-5 rounded-panel border border-edge bg-surface p-6 shadow-card sm:p-8"
    @submit.prevent="submit"
  >
    <div>
      <label for="current-password" class="block text-sm font-medium">目前密碼</label>
      <input
        id="current-password"
        v-model="currentPassword"
        class="field mt-2 w-full"
        type="password"
        autocomplete="current-password"
        maxlength="200"
        required
        :disabled="busy"
      />
    </div>
    <div>
      <label for="new-password" class="block text-sm font-medium">新密碼</label>
      <input
        id="new-password"
        v-model="newPassword"
        class="field mt-2 w-full"
        type="password"
        autocomplete="new-password"
        minlength="12"
        maxlength="200"
        aria-describedby="password-hint"
        required
        :disabled="busy"
      />
      <p id="password-hint" class="mt-2 text-xs leading-5 text-ink-muted">
        至少 12 碼，最多 72 個 UTF-8 位元組（中文字通常佔 3 個位元組）。
      </p>
    </div>
    <div>
      <label for="confirm-password" class="block text-sm font-medium">確認新密碼</label>
      <input
        id="confirm-password"
        v-model="confirmPassword"
        class="field mt-2 w-full"
        type="password"
        autocomplete="new-password"
        minlength="12"
        maxlength="200"
        required
        :disabled="busy"
      />
    </div>
    <p v-if="error" role="alert" class="text-sm text-tone-danger-ink">{{ error }}</p>
    <p v-if="success" role="status" class="rounded-control bg-tone-ok p-3 text-sm text-tone-ok-ink">
      密碼已更新，其他裝置需重新登入。
    </p>
    <button class="btn-primary" type="submit" :disabled="busy">
      {{ busy ? '更新中…' : '更新密碼' }}
    </button>
  </form>
</template>
