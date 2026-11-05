<script setup lang="ts">
import PoliceBadge from '@/components/PoliceBadge.vue'
import { appName, appTagline } from '@/config/app'
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

const points = [
  {
    mark: '1',
    title: '建立勤務流程',
    detail: '由系統管理員或被授權的使用者新增，例如竊盜案、毀損案，並寫下填寫步驟。',
  },
  {
    mark: '2',
    title: '從範本庫選取',
    detail: 'Word 範本只保存一份。多個流程可以連結同一份範本。',
  },
  {
    mark: '3',
    title: '產生文件',
    detail: '填入欄位後下載套好的文件。填寫內容不會被保存。',
  },
]

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
  <div class="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(22rem,34rem)]">
    <section class="hidden bg-stone-950 px-10 py-12 text-stone-100 lg:flex lg:flex-col lg:gap-16">
      <div class="flex items-center gap-3">
        <span
          class="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-700 text-sm font-semibold"
        >
          <PoliceBadge />
        </span>
        <span>
          <span class="block text-base font-semibold">{{ appName }}</span>
          <span class="block text-sm text-stone-400">{{ appTagline }}</span>
        </span>
      </div>
      <div class="login-hero" role="img" aria-label="警察背影坐於辦公桌受理報案的示意圖">
        <div class="login-hero-image" aria-hidden="true"></div>
        <div class="login-hero-light" aria-hidden="true"></div>
      </div>
      <div class="max-w-md">
        <p class="text-3xl font-semibold tracking-tight">先選流程，再套範本</p>
        <ol class="mt-8 space-y-5">
          <li v-for="point in points" :key="point.mark" class="flex gap-3">
            <span
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs"
            >
              {{ point.mark }}
            </span>
            <span>
              <span class="block text-sm font-medium">{{ point.title }}</span>
              <span class="mt-1 block text-sm leading-6 text-stone-400">{{ point.detail }}</span>
            </span>
          </li>
        </ol>
      </div>
    </section>

    <section class="flex items-center justify-center bg-[#f6f4f1] px-4 py-10">
      <div
        class="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <p class="text-xs font-medium tracking-wide text-orange-800 lg:hidden">{{ appName }}</p>
        <h1 class="mt-2 text-2xl font-semibold tracking-tight text-stone-950">登入</h1>
        <p class="mt-3 text-sm leading-6 text-stone-600">
          輸入帳號與密碼進入工作台。密碼只用於這次核對，不會留在瀏覽器裡。
        </p>

        <form class="mt-6 space-y-4" @submit.prevent="submit">
          <div>
            <label for="username" class="block text-sm font-medium text-stone-800">帳號</label>
            <input
              id="username"
              v-model="username"
              type="text"
              name="username"
              autocomplete="username"
              required
              class="mt-2 w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-orange-700"
            />
          </div>
          <div>
            <label for="password" class="block text-sm font-medium text-stone-800">密碼</label>
            <input
              id="password"
              v-model="password"
              type="password"
              name="password"
              autocomplete="current-password"
              required
              class="mt-2 w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-orange-700"
            />
          </div>
          <p v-if="failed" class="text-sm text-rose-800" role="alert">帳號或密碼不正確。</p>
          <p v-if="offline" class="text-sm text-rose-800" role="alert">
            無法連線。請確認服務已啟動。
          </p>
          <button
            type="submit"
            class="w-full rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
          >
            登入
          </button>
        </form>

        <aside
          class="mt-6 rounded-2xl border border-stone-200 bg-stone-50 p-4"
          aria-labelledby="updates-title"
        >
          <h2 id="updates-title" class="text-sm font-semibold text-stone-900">本次更新</h2>
          <p v-if="notesError" class="mt-2 text-xs text-stone-500">暫時無法讀取更新公告。</p>
          <ul v-else class="mt-2 list-disc space-y-2 pl-4 text-xs leading-5 text-stone-600">
            <li v-for="item in releaseNotes" :key="item">{{ item }}</li>
          </ul>
        </aside>
        <p class="mt-4 text-center text-sm text-stone-600">
          還沒有帳號？
          <RouterLink to="/register" class="font-medium text-orange-800 hover:underline">
            註冊帳號
          </RouterLink>
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.login-hero {
  position: relative;
  height: 220px;
  max-width: 520px;
  overflow: hidden;
  border-radius: 24px;
  background: #292524;
}
.login-hero-image {
  position: absolute;
  inset: 0;
  background: url('/login/login-hero.webp') center / cover no-repeat;
  animation: hero-drift 18s ease-in-out infinite alternate;
}
.login-hero-light {
  position: absolute;
  inset: -30%;
  background: linear-gradient(110deg, transparent 30%, #fdba7426 50%, transparent 70%);
  opacity: 0.3;
  animation: hero-light 14s ease-in-out infinite alternate;
}
@keyframes hero-drift {
  to {
    transform: scale(1.035) translateX(3px);
  }
}
@keyframes hero-light {
  from {
    transform: translateX(-20%);
  }
  to {
    transform: translateX(20%);
    opacity: 0.65;
  }
}
@media (prefers-reduced-motion: reduce) {
  .login-hero-image,
  .login-hero-light {
    animation: none;
    transform: none;
  }
}
</style>
