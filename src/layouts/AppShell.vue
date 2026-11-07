<script setup lang="ts">
import PoliceBadge from '@/components/PoliceBadge.vue'
import SideNav from '@/components/SideNav.vue'
import { appName, appTagline } from '@/config/app'
import { useSessionStore } from '@/stores/session'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const menuOpen = ref(false)

watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false
  },
)

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    menuOpen.value = false
  }
}

async function logout() {
  await session.logout()
  menuOpen.value = false
  void router.push({ name: 'login' })
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="flex min-h-dvh items-stretch bg-canvas text-ink">
    <aside class="hidden w-[248px] shrink-0 bg-nav md:block">
      <div class="sticky top-0 flex h-dvh flex-col">
        <SideNav id="desktop-nav" />
      </div>
    </aside>

    <div
      v-if="menuOpen"
      class="fixed inset-0 z-40 bg-nav/50 md:hidden"
      @click="menuOpen = false"
    ></div>

    <aside
      class="fixed inset-y-0 left-0 z-50 flex h-dvh w-64 flex-col bg-nav transition-transform duration-200 md:hidden"
      :class="menuOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <SideNav id="mobile-nav" @navigate="menuOpen = false" />
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header
        class="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-edge/80 bg-canvas/90 px-4 backdrop-blur md:px-page-x"
      >
        <div class="flex min-w-0 items-center gap-3">
          <button
            type="button"
            class="btn-secondary h-10 w-10 items-center justify-center md:hidden"
            :aria-expanded="menuOpen"
            aria-controls="mobile-nav"
            @click="menuOpen = !menuOpen"
          >
            <svg viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true">
              <path
                d="M4 7h16M4 12h16M4 17h16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              />
            </svg>
            <span class="sr-only">{{ menuOpen ? '關閉選單' : '開啟選單' }}</span>
          </button>
          <PoliceBadge class="md:hidden" />
          <p class="truncate text-sm font-semibold md:hidden">{{ appName }}</p>
          <p class="hidden truncate text-sm text-ink-muted md:block">{{ appTagline }}</p>
        </div>

        <div class="flex items-center gap-3">
          <div class="min-w-0 text-right">
            <p class="truncate text-sm font-medium text-ink">{{ session.displayName }}</p>
            <p class="truncate text-xs text-ink-muted">{{ session.roleLabel }}</p>
          </div>
          <button type="button" class="btn-secondary px-3 py-2" @click="logout">登出</button>
        </div>
      </header>

      <main class="flex-1 px-4 py-8 md:px-page-x md:py-page-y">
        <div class="mx-auto max-w-[1120px]">
          <RouterView />
        </div>
      </main>
    </div>
  </div>
</template>
