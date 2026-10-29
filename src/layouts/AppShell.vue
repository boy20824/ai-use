<script setup lang="ts">
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

function logout() {
  session.logout()
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
  <div class="min-h-screen text-stone-900">
    <aside class="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-white/10 md:block">
      <SideNav id="desktop-nav" />
    </aside>

    <div
      v-if="menuOpen"
      class="fixed inset-0 z-40 bg-stone-950/50 md:hidden"
      @click="menuOpen = false"
    ></div>

    <aside
      class="fixed inset-y-0 left-0 z-50 w-64 transition-transform duration-200 md:hidden"
      :class="menuOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <SideNav id="mobile-nav" @navigate="menuOpen = false" />
    </aside>

    <div class="md:pl-64">
      <header
        class="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-stone-200/80 bg-[#f6f4f1]/90 px-4 backdrop-blur md:px-8"
      >
        <div class="flex min-w-0 items-center gap-3">
          <button
            type="button"
            class="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-stone-300 bg-white text-stone-800 md:hidden"
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
          <p class="truncate text-sm font-semibold md:hidden">{{ appName }}</p>
          <p class="hidden truncate text-sm text-stone-500 md:block">{{ appTagline }}</p>
        </div>

        <div class="flex items-center gap-3">
          <div class="min-w-0 text-right">
            <p class="truncate text-sm font-medium text-stone-900">{{ session.displayName }}</p>
            <p class="truncate text-xs text-stone-500">{{ session.roleLabel }}</p>
          </div>
          <button
            type="button"
            class="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 hover:bg-stone-50"
            @click="logout"
          >
            登出
          </button>
        </div>
      </header>

      <main class="px-4 py-8 md:px-8 md:py-10">
        <div class="mx-auto max-w-6xl">
          <RouterView />
        </div>
      </main>
    </div>
  </div>
</template>
