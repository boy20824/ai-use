<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { appName } from '@/config/app'
import { useSessionStore } from '@/stores/session'
import { safeRedirect } from '@/utils/redirect'
import { ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

const session = useSessionStore()
const route = useRoute()
const router = useRouter()
const username = ref('')
const password = ref('')
const failed = ref(false)
const offline = ref(false)

async function submit() {
  failed.value = false
  offline.value = false
  const result = await session.login(username.value, password.value)
  password.value = ''
  if (result === 'invalid') {
    failed.value = true
    return
  }
  if (result !== 'ok') {
    offline.value = true
    return
  }
  void router.push(safeRedirect(route.query.redirect))
}
</script>

<template>
  <main class="corgi-login">
    <section class="corgi-stage" aria-label="平台登入">
      <div class="corgi-portrait" aria-hidden="true">
        <img src="/images/corgi-login-hero.webp" alt="" width="1152" height="864" />
      </div>
      <section class="corgi-card" aria-labelledby="login-title">
        <h1 id="login-title" class="corgi-brand">
          <AppIcon name="documents" hidden />{{ appName }}
        </h1>
        <form class="corgi-form" aria-label="登入" @submit.prevent="submit">
          <div class="corgi-field">
            <label for="username">帳號</label>
            <input
              id="username"
              v-model="username"
              type="text"
              name="username"
              autocomplete="username"
              required
              placeholder="請輸入帳號"
              :class="{ 'corgi-field-error': failed }"
            />
          </div>
          <div class="corgi-field">
            <label for="password">密碼</label>
            <input
              id="password"
              v-model="password"
              type="password"
              name="password"
              autocomplete="current-password"
              required
              placeholder="請輸入密碼"
              :class="{ 'corgi-field-error': failed }"
            />
          </div>
          <p v-if="failed" class="corgi-error" role="alert">帳號或密碼不正確。</p>
          <p v-if="offline" class="corgi-error" role="alert">無法連線。請確認服務已啟動。</p>
          <div class="corgi-actions">
            <button type="submit" class="corgi-submit">登入</button>
            <p class="corgi-register">
              <span>還沒有帳號？</span>
              <RouterLink to="/register">註冊</RouterLink>
            </p>
          </div>
        </form>
        <p class="corgi-description">輸入帳號與密碼，進入案件範本。</p>
      </section>
    </section>
  </main>
</template>

<style scoped>
.corgi-login {
  min-height: 100dvh;
  padding: clamp(32px, 5vw, 72px);
  background: #edf0f2;
  color: #252b30;
}

.corgi-stage {
  position: relative;
  isolation: isolate;
  display: grid;
  grid-template-rows: 1fr auto 1fr;
  min-height: max(640px, calc(100dvh - clamp(64px, 10vw, 144px)));
  padding: 28px 7.1%;
  overflow: hidden;
  border-radius: 2px;
  background: #fff;
  box-shadow:
    0 20px 70px #2336420c,
    0 2px 10px #23364205;
}

.corgi-portrait {
  position: absolute;
  z-index: -1;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.corgi-portrait img {
  position: absolute;
  right: -6%;
  bottom: -8%;
  display: block;
  width: auto;
  max-width: none;
  height: 110%;
  max-height: 78vw;
  mix-blend-mode: multiply;
}

.corgi-card {
  grid-row: 2;
  width: 340px;
  max-width: 100%;
  padding: 40px;
  border: 1px solid #f3f4f4;
  border-radius: 3px;
  background: #fff;
  box-shadow:
    0 14px 52px #1c303914,
    0 2px 10px #1c303905;
}

.corgi-brand {
  margin: 0 0 36px;
  color: #24292d;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.75;
  letter-spacing: 0.095em;
}

.corgi-form {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.corgi-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.corgi-field label {
  color: #3d454b;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.6;
}

.corgi-field input {
  width: 100%;
  min-height: 44px;
  padding: 0;
  border: 0;
  border-bottom: 1px solid #778188;
  border-radius: 0;
  background: transparent;
  color: #252b30;
  font-size: 16px;
  line-height: 1.5;
}

.corgi-field input::placeholder {
  color: #687279;
  opacity: 1;
  font-size: 12px;
}

.corgi-field input.corgi-field-error {
  border-bottom-color: #a23f39;
}

.corgi-error {
  margin: 0;
  color: #a23f39;
  font-size: 12px;
  line-height: 1.65;
}

.corgi-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.corgi-submit {
  display: inline-flex;
  min-width: 104px;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  padding: 0 28px;
  border: 1px solid #252c31;
  border-radius: 999px;
  background: #252c31;
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.12em;
  cursor: pointer;
}

.corgi-submit:hover {
  border-color: #10171b;
  background: #10171b;
}

.corgi-register {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  margin: 0;
  color: #657079;
  font-size: 10px;
}

.corgi-register a {
  display: inline-flex;
  min-width: 52px;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  color: #3d454b;
  font-size: 12px;
  font-weight: 500;
}

.corgi-register a:hover {
  text-decoration: underline;
  text-underline-offset: 5px;
}

.corgi-field input:focus-visible,
.corgi-submit:focus-visible,
.corgi-register a:focus-visible {
  outline: 2px solid #216ac1;
  outline-offset: 4px;
}

.corgi-description {
  margin: 32px 0 0;
  color: #657079;
  font-size: 11px;
  line-height: 1.8;
}

.corgi-release {
  grid-row: 3;
  align-self: end;
  position: relative;
  width: 340px;
  max-width: 100%;
  margin-top: 32px;
  overflow-wrap: anywhere;
  color: #657079;
  font-size: 11px;
  line-height: 1.8;
}

@media (min-width: 761px) and (max-width: 1100px) {
  .corgi-stage {
    padding-inline: 5%;
  }

  .corgi-card {
    width: 320px;
    padding: 36px;
  }

  .corgi-portrait img {
    right: -18%;
    bottom: -5%;
    height: 105%;
  }
}

@media (max-width: 760px) {
  .corgi-login {
    padding: 16px;
  }

  .corgi-stage {
    display: flex;
    flex-direction: column;
    min-height: calc(100dvh - 32px);
    justify-content: flex-start;
    padding: 266px 20px 22px;
  }

  .corgi-portrait {
    inset: 0 0 auto;
    height: 268px;
    mask-image: linear-gradient(to bottom, #000 0%, #000 82%, transparent 100%);
  }

  .corgi-portrait img {
    top: 0;
    right: -24px;
    bottom: auto;
    width: 440px;
    height: 330px;
    max-height: none;
  }

  .corgi-card {
    width: 100%;
    padding: 28px;
    box-shadow:
      0 10px 36px #1c303910,
      0 1px 6px #1c303904;
  }

  .corgi-brand {
    margin-bottom: 32px;
    font-size: 13px;
    letter-spacing: 0.06em;
  }

  .corgi-form {
    gap: 20px;
  }

  .corgi-release {
    width: 100%;
    margin-top: auto;
    padding-top: 48px;
  }
}
</style>
