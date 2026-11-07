<script setup lang="ts">
import PoliceBadge from '@/components/PoliceBadge.vue'
import { appName } from '@/config/app'
import { useSessionStore } from '@/stores/session'
import { safeRedirect } from '@/utils/redirect'
import { onMounted, onUnmounted, ref } from 'vue'
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

const paused = ref(false)
const reducedMotion = ref(false)
let motionQuery: MediaQueryList | undefined
function syncMotion() {
  reducedMotion.value = motionQuery?.matches ?? false
}
onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  syncMotion()
  motionQuery.addEventListener('change', syncMotion)
})
onUnmounted(() => motionQuery?.removeEventListener('change', syncMotion))

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
  <div class="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]">
    <section
      class="police-visual hidden lg:grid"
      :class="{ 'is-paused': paused }"
      aria-label="雨夜停駐警車"
    >
      <div class="pv-stage" aria-hidden="true">
        <div class="pv-layer pv-scene"></div>
        <div class="pv-layer pv-patch pv-patch-red"></div>
        <div class="pv-layer pv-patch pv-patch-blue"></div>
        <div class="pv-layer pv-spot pv-light-red"></div>
        <div class="pv-layer pv-spot pv-light-blue"></div>
        <div class="pv-layer pv-rain"></div>
      </div>
      <button
        type="button"
        class="motion-control focus-control"
        :disabled="reducedMotion"
        :aria-pressed="paused || reducedMotion"
        @click="paused = !paused"
      >
        {{ reducedMotion ? '動效已停止' : paused ? '恢復動效' : '暫停動效' }}
      </button>
      <aside class="update-card" aria-labelledby="updates-title">
        <h2 id="updates-title" class="text-xs font-semibold tracking-wide text-accent-glow">
          本次更新
        </h2>
        <p v-if="notesError" class="mt-2 text-xs text-stone-300">暫時無法讀取更新公告。</p>
        <ul v-else class="mt-3 space-y-2 text-xs leading-5 text-stone-200">
          <li v-for="item in releaseNotes.slice(0, 3)" :key="item">{{ item }}</li>
        </ul>
      </aside>
    </section>

    <section class="flex items-center justify-center bg-canvas px-4 py-10">
      <div
        class="w-full max-w-md rounded-panel border border-edge bg-surface p-6 shadow-card sm:p-8"
      >
        <div class="mb-6 flex items-center gap-3 text-accent-ink">
          <PoliceBadge />
          <p class="text-sm font-semibold">{{ appName }}</p>
        </div>
        <h1 class="mt-2 text-2xl font-semibold tracking-tight text-ink-strong">登入</h1>
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
              class="field mt-2 w-full"
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
              class="field mt-2 w-full"
            />
          </div>
          <p v-if="failed" class="text-sm text-tone-danger-ink" role="alert">帳號或密碼不正確。</p>
          <p v-if="offline" class="text-sm text-tone-danger-ink" role="alert">
            無法連線。請確認服務已啟動。
          </p>
          <button type="submit" class="btn-primary w-full">登入</button>
        </form>

        <aside
          class="mt-6 rounded-card border border-edge bg-surface-muted p-4 lg:hidden"
          aria-labelledby="mobile-updates-title"
        >
          <h2 id="mobile-updates-title" class="text-sm font-semibold">本次更新</h2>
          <p v-if="notesError" class="mt-2 text-xs text-ink-muted">暫時無法讀取更新公告。</p>
          <ul v-else class="mt-2 list-disc space-y-2 pl-4 text-xs leading-5 text-ink-muted">
            <li v-for="item in releaseNotes" :key="item">{{ item }}</li>
          </ul>
        </aside>
        <p class="mt-4 text-center text-sm text-stone-600">
          還沒有帳號？
          <RouterLink
            to="/register"
            class="focus-control font-medium text-accent-ink hover:underline"
          >
            註冊帳號
          </RouterLink>
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.police-visual {
  --src-w: 1280;
  --src-h: 720;
  --red-x: 611;
  --red-y: 66;
  --blue-x: 728;
  --blue-y: 63;
  --patch-red-w: 52;
  --patch-red-h: 24;
  --patch-blue-w: 72;
  --patch-blue-h: 24;
  --spot-w: 56;
  --spot-h: 22;
  position: relative;
  min-width: 0;
  min-height: 0;
  height: 100dvh;
  overflow: hidden;
  background: var(--color-police-night);
  isolation: isolate;
  container-type: size;
  place-items: center;
}
.pv-stage {
  position: relative;
  aspect-ratio: 1280 / 720;
  width: min(100cqw, calc(100cqh * 1280 / 720));
  height: min(100cqh, calc(100cqw * 720 / 1280));
  max-width: 100%;
  max-height: 100%;
  overflow: hidden;
  background: var(--color-police-night);
}
.pv-stage .pv-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.pv-stage .pv-scene {
  background-image: url('/login/police-car.png');
  background-repeat: no-repeat;
  background-position: center center;
  background-size: 100% 100%;
}

.pv-stage .pv-patch {
  inset: auto;
  transform: translate(-50%, -50%);
  border-radius: 9px;
  background: var(--color-police-night);
  opacity: 1;
}
.pv-stage .pv-patch-red {
  left: calc(var(--red-x) / var(--src-w) * 100%);
  top: calc(var(--red-y) / var(--src-h) * 100%);
  width: calc(var(--patch-red-w) / var(--src-w) * 100%);
  height: calc(var(--patch-red-h) / var(--src-h) * 100%);
}
.pv-stage .pv-patch-blue {
  left: calc(var(--blue-x) / var(--src-w) * 100%);
  top: calc(var(--blue-y) / var(--src-h) * 100%);
  width: calc(var(--patch-blue-w) / var(--src-w) * 100%);
  height: calc(var(--patch-blue-h) / var(--src-h) * 100%);
}

.pv-stage .pv-spot {
  inset: auto;
  width: calc(var(--spot-w) / var(--src-w) * 100%);
  height: calc(var(--spot-h) / var(--src-h) * 100%);
  transform: translate(-50%, -50%);
  border-radius: 50%;
  mix-blend-mode: normal;
  filter: none;
  box-shadow:
    0 0 12px 3px var(--light-color),
    0 0 36px 10px var(--light-color);
  will-change: opacity;
}
.pv-stage .pv-light-red {
  --light-color: var(--color-police-red);
  left: calc(var(--red-x) / var(--src-w) * 100%);
  top: calc(var(--red-y) / var(--src-h) * 100%);
  background: radial-gradient(
    ellipse at 50% 50%,
    var(--color-police-red-core) 0%,
    var(--color-police-red) 28%,
    var(--color-police-red-edge) 55%,
    transparent 72%
  );
  animation: pv-flash-red 2.4s ease-in-out infinite;
}
.pv-stage .pv-light-blue {
  --light-color: var(--color-police-blue);
  left: calc(var(--blue-x) / var(--src-w) * 100%);
  top: calc(var(--blue-y) / var(--src-h) * 100%);
  background: radial-gradient(
    ellipse at 50% 50%,
    var(--color-police-blue-core) 0%,
    var(--color-police-blue) 28%,
    var(--color-police-blue-edge) 55%,
    transparent 72%
  );
  animation: pv-flash-blue 2.4s ease-in-out infinite;
}
.pv-stage .pv-rain {
  opacity: 0.18;
  background: repeating-linear-gradient(
    110deg,
    transparent 0 78px,
    var(--color-police-rain) 79px,
    transparent 80px 150px
  );
  background-size: 190px 240px;
  animation: pv-rain 0.8s linear infinite;
}

@keyframes pv-flash-red {
  0%,
  42% {
    opacity: 1;
  }
  50%,
  92% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
}
@keyframes pv-flash-blue {
  0%,
  42% {
    opacity: 0;
  }
  50%,
  92% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
@keyframes pv-rain {
  to {
    background-position: -190px 480px;
  }
}
.police-visual.is-paused .pv-light-red,
.police-visual.is-paused .pv-light-blue,
.police-visual.is-paused .pv-rain {
  animation-play-state: paused;
}
@media (prefers-reduced-motion: reduce) {
  .police-visual .pv-light-red,
  .police-visual .pv-light-blue,
  .police-visual .pv-rain {
    animation: none !important;
  }

  .police-visual .pv-light-red,
  .police-visual .pv-light-blue {
    opacity: 0.55 !important;
  }
  .police-visual .pv-rain {
    opacity: 0.1 !important;
    background-position: 0 0 !important;
  }
}

.motion-control {
  position: absolute;
  top: 18px;
  right: 18px;
  padding: 10px 14px;
  border: 1px solid rgb(255 255 255 / 0.22);
  border-radius: var(--radius-control);
  background: rgb(0 0 0 / 0.5);
  color: var(--color-surface);
  font-size: var(--text-caption);
  backdrop-filter: blur(6px);
  cursor: pointer;
}
.motion-control:disabled {
  cursor: default;
}
.update-card {
  position: absolute;
  left: 18px;
  bottom: 18px;
  max-width: min(280px, calc(100% - 36px));
  border: 1px solid rgb(255 255 255 / 0.14);
  border-radius: var(--radius-control);
  padding: 14px 16px;
  background: rgb(10 9 8 / 0.65);
  backdrop-filter: blur(14px);
}
</style>
