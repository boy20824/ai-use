<script setup lang="ts">
import { appName } from '@/config/app'
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
  if (!password.value.trim()) {
    message.value = '請填寫密碼。'
    return
  }
  if (new TextEncoder().encode(password.value).length > 72) {
    message.value = '密碼不可超過 72 個 UTF-8 位元組。'
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
  <main class="dog-register">
    <section class="dog-stage" aria-label="註冊帳號">
      <div class="dog-portrait" aria-hidden="true">
        <img src="/images/taiwan-black-dog-registration.webp" alt="" width="1152" height="864" />
      </div>
      <section class="dog-card" aria-labelledby="register-title">
        <p class="dog-brand">{{ appName }}</p>
        <h1 id="register-title" class="mt-2 text-2xl font-semibold tracking-tight text-ink-strong">
          註冊帳號
        </h1>
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
              minlength="1"
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
              minlength="1"
              class="field mt-2 w-full"
            />
          </div>
          <p v-if="message" class="text-sm text-tone-danger-ink" role="alert">{{ message }}</p>
          <button type="submit" class="btn-primary w-full">註冊帳號</button>
        </form>

        <p class="mt-4 text-center text-sm text-stone-600">
          已經有帳號？
          <RouterLink to="/login" class="dog-back"> 返回登入 </RouterLink>
        </p>
        <div class="dog-description">
          <p>註冊後即可產生文件</p>
          <p>
            新帳號是一般使用者，可以登入並在工作台產生文件。維護案件範本與會員管理要由系統管理員另外授權。
          </p>
        </div>
      </section>
    </section>
  </main>
</template>

<style scoped>
.dog-register {
  min-height: 100dvh;
  padding: clamp(16px, 4vw, 56px);
  background: #edf0f2;
  color: #252b30;
}

.dog-stage {
  display: flex;
  min-height: calc(100dvh - clamp(32px, 8vw, 112px));
  align-items: center;
  justify-content: space-between;
  gap: 48px;
  padding: 48px clamp(48px, 4.45vw, 64px);
  background: #fff;
  box-shadow:
    0 20px 70px #2336420c,
    0 2px 10px #23364205;
}

.dog-portrait {
  flex: 1;
  min-width: 0;
}

.dog-portrait img {
  display: block;
  width: 100%;
  height: auto;
  object-fit: contain;
}

.dog-card {
  flex: 0 0 402px;
  min-width: 0;
  padding: 32px 20px;
  border: 1px solid #f3f4f4;
  border-radius: 3px;
  background: #fff;
  box-shadow:
    0 14px 52px #1c303914,
    0 2px 10px #1c303905;
}

.dog-brand {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.75;
  letter-spacing: 0.06em;
}

.dog-card .field {
  min-height: 44px;
  padding: 0;
  border: 0;
  border-bottom: 1px solid #778188;
  border-radius: 0;
  background: transparent;
  color: #252b30;
  font-size: 16px;
  line-height: 1.5;
  box-shadow: none;
}

.dog-card button[type='submit'] {
  min-height: 44px;
  padding: 10px 28px;
  border: 1px solid #252c31;
  border-radius: 999px;
  background: #252c31;
  color: #fff;
}

.dog-card button[type='submit']:hover {
  background: #10171b;
}

.dog-back {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  padding-inline: 8px;
  color: #3d454b;
  font-weight: 500;
}

.dog-back:hover {
  text-decoration: underline;
  text-underline-offset: 5px;
}

.dog-card :is(input, button, a):focus-visible {
  outline: 2px solid #216ac1;
  outline-offset: 4px;
}

.dog-description {
  margin-top: 24px;
  color: #657079;
  font-size: 12px;
  line-height: 1.8;
}

@media (min-width: 768px) and (max-width: 1000px) {
  .dog-card {
    flex-basis: 360px;
    padding-inline: 0;
  }
}

@media (max-width: 767px) {
  .dog-register {
    padding: 16px 0;
  }

  .dog-stage {
    flex-direction: column;
    align-items: stretch;
    gap: 24px;
    padding: 24px;
  }

  .dog-portrait {
    flex: none;
    height: 220px;
  }

  .dog-portrait img {
    height: 100%;
    object-position: left center;
  }

  .dog-card {
    flex: none;
    width: 100%;
    padding: 24px 0;
  }
}
</style>
