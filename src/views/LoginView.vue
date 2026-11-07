<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { appName } from '@/config/app'
import { useSessionStore } from '@/stores/session'
import { safeRedirect } from '@/utils/redirect'
import { onMounted, ref } from 'vue'
import { apiRequest } from '@/services/api'
import { RouterLink, useRoute, useRouter } from 'vue-router'

const session = useSessionStore()
const route = useRoute()
const router = useRouter()
const username = ref('')
const password = ref('')
const failed = ref(false)
const offline = ref(false)
const releaseNotes = ref<string[]>([])
const notesError = ref(false)
onMounted(async () => {
  try {
    const response = await apiRequest('/api/release-notes')
    if (!response.ok) throw new Error('unavailable')
    const body = (await response.json()) as { items: string[] }
    releaseNotes.value = body.items
  } catch {
    notesError.value = true
  }
})

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
  <div class="login-page">
    <section class="login-brand" aria-label="警務流程輔助平台">
      <div class="brand-lockup">
        <span class="brand-mark"><AppIcon name="documents" /></span><strong>{{ appName }}</strong>
      </div>
      <div class="login-composition">
        <div class="document-stack" aria-hidden="true">
          <div class="abstract-document sheet-back"><i v-for="n in 9" :key="n"></i></div>
          <div class="abstract-document sheet-middle"><i v-for="n in 9" :key="n"></i></div>
          <div class="abstract-document sheet-front">
            <span class="sheet-heading"></span><span class="sheet-extension">.docx</span
            ><i v-for="n in 9" :key="n"></i>
            <div class="sheet-fields"><span></span><span></span></div>
          </div>
        </div>
        <ol class="login-steps">
          <li><span>01</span>選擇案件類別</li>
          <li><span>02</span>依範本步驟挑選範本</li>
          <li><span>03</span>填寫欄位，產出 .docx</li>
        </ol>
      </div>
      <p class="mobile-brand-steps">
        01 選擇類別 <span>—</span> 02 挑選範本 <span>—</span> 03 產出文件
      </p>
      <aside v-if="releaseNotes.length" class="login-release" aria-label="本次更新">
        <span>本次更新</span>{{ releaseNotes.slice(0, 2).join(' · ') }}
      </aside>
    </section>
    <section class="login-form-area">
      <div class="login-card">
        <h1>登入</h1>
        <p class="login-description">輸入帳號與密碼，進入案件範本。</p>
        <form class="mt-6 space-y-4" @submit.prevent="submit">
          <div>
            <label for="username" class="block text-sm font-medium">帳號</label
            ><input
              id="username"
              v-model="username"
              type="text"
              name="username"
              autocomplete="username"
              required
              class="field mt-2 w-full"
            />
          </div>
          <div>
            <label for="password" class="block text-sm font-medium">密碼</label
            ><input
              id="password"
              v-model="password"
              type="password"
              name="password"
              autocomplete="current-password"
              required
              class="field mt-2 w-full"
            />
          </div>
          <p v-if="failed" class="text-sm text-tone-danger-ink" role="alert">帳號或密碼不正確。</p>
          <p v-if="offline" class="text-sm text-tone-danger-ink" role="alert">
            無法連線。請確認服務已啟動。
          </p>
          <button type="submit" class="btn-primary w-full">登入</button>
        </form>
        <p class="login-register">
          還沒有帳號？
          <RouterLink
            to="/register"
            class="focus-control font-medium text-accent-ink hover:underline"
            >註冊</RouterLink
          >
        </p>
      </div>
      <p v-if="notesError" class="login-release-mobile">暫時無法讀取更新公告。</p>
      <p v-else-if="releaseNotes.length" class="login-release-mobile">
        本次更新：{{ releaseNotes.slice(0, 2).join(' · ') }}
      </p>
    </section>
  </div>
</template>
