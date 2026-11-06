<script setup lang="ts">
import PoliceBadge from '@/components/PoliceBadge.vue'
import { appName, appTagline } from '@/config/app'
import { useSessionStore } from '@/stores/session'
import { ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

const session = useSessionStore()
const router = useRouter()
const name = ref('')
const nickname = ref('')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const message = ref('')

async function submit() {
  message.value = ''
  if (password.value.length < 8) {
    message.value = '密碼至少需要 8 個字元。'
    return
  }
  if (password.value !== confirmPassword.value) {
    message.value = '兩次密碼不一致。'
    return
  }
  const result = await session.register({
    name: name.value,
    nickname: nickname.value,
    username: username.value,
    password: password.value,
    confirmPassword: confirmPassword.value,
  })
  password.value = ''
  confirmPassword.value = ''
  if (!result.ok) {
    message.value = result.message
    return
  }
  void router.push('/')
}
</script>

<template>
  <div class="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(22rem,34rem)]">
    <section class="hidden bg-nav px-10 py-12 text-stone-100 lg:flex lg:flex-col lg:gap-16">
      <div class="flex items-center gap-3">
        <span
          class="flex h-11 w-11 items-center justify-center rounded-control bg-accent text-sm font-semibold"
        >
          <PoliceBadge />
        </span>
        <span>
          <span class="block text-base font-semibold">{{ appName }}</span>
          <span class="block text-sm text-ink-subtle">{{ appTagline }}</span>
        </span>
      </div>
      <div class="max-w-md">
        <p class="text-3xl font-semibold tracking-tight">註冊後即可產生文件</p>
        <p class="mt-6 text-sm leading-7 text-ink-subtle">
          新帳號是一般使用者，可以登入並在工作台產生文件。維護勤務流程與會員管理要由系統管理員另外授權。
        </p>
      </div>
    </section>

    <section class="flex items-center justify-center bg-canvas px-4 py-10">
      <div class="w-full max-w-md rounded-3xl border border-edge bg-surface p-6 shadow-card sm:p-8">
        <p class="text-xs font-medium tracking-wide text-accent-ink lg:hidden">{{ appName }}</p>
        <h1 class="mt-2 text-2xl font-semibold tracking-tight text-ink-strong">註冊帳號</h1>
        <p class="mt-3 text-sm leading-6 text-stone-600">
          填寫名稱、暱稱、帳號與密碼。註冊完成後會直接進入工作台。
        </p>

        <form class="mt-6 space-y-4" @submit.prevent="submit">
          <div>
            <label for="register-name" class="block text-sm font-medium text-stone-800">名稱</label>
            <input
              id="register-name"
              v-model="name"
              type="text"
              name="name"
              autocomplete="name"
              required
              maxlength="40"
              class="field mt-2 w-full"
            />
          </div>
          <div>
            <label for="register-nickname" class="block text-sm font-medium text-stone-800"
              >暱稱</label
            >
            <input
              id="register-nickname"
              v-model="nickname"
              type="text"
              name="nickname"
              autocomplete="nickname"
              required
              maxlength="40"
              class="field mt-2 w-full"
            />
          </div>
          <div>
            <label for="register-username" class="block text-sm font-medium text-stone-800"
              >帳號</label
            >
            <input
              id="register-username"
              v-model="username"
              type="text"
              name="username"
              autocomplete="username"
              required
              minlength="3"
              maxlength="32"
              pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}"
              class="field mt-2 w-full"
            />
            <p class="mt-2 text-xs leading-5 text-ink-muted">
              3 到 32 個字，使用英數、底線、點或連字號，且不分大小寫。
            </p>
          </div>
          <div>
            <label for="register-password" class="block text-sm font-medium text-stone-800"
              >密碼</label
            >
            <input
              id="register-password"
              v-model="password"
              type="password"
              name="password"
              autocomplete="new-password"
              required
              minlength="8"
              class="field mt-2 w-full"
            />
          </div>
          <div>
            <label for="register-confirm" class="block text-sm font-medium text-stone-800"
              >確認密碼</label
            >
            <input
              id="register-confirm"
              v-model="confirmPassword"
              type="password"
              name="confirmPassword"
              autocomplete="new-password"
              required
              minlength="8"
              class="field mt-2 w-full"
            />
          </div>
          <p v-if="message" class="text-sm text-tone-danger-ink" role="alert">{{ message }}</p>
          <button type="submit" class="btn-primary w-full">註冊帳號</button>
        </form>

        <p class="mt-4 text-center text-sm text-stone-600">
          已經有帳號？
          <RouterLink to="/login" class="focus-control font-medium text-accent-ink hover:underline">
            返回登入
          </RouterLink>
        </p>
      </div>
    </section>
  </div>
</template>
