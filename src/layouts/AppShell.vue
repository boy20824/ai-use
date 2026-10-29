<script setup lang="ts">
import SideNav from '@/components/SideNav.vue'
import { apiConfigured } from '@/config/env'
import { useSessionStore } from '@/stores/session'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'

const route = useRoute()
const session = useSessionStore()
const menuOpen = ref(false)

const pageTitle = computed(() =>
  typeof route.meta.title === 'string' ? route.meta.title : 'AI 使用管理',
)

const apiLabel = computed(() => (apiConfigured ? 'API 位址已設定，此階段不連線' : 'API 位址未設定'))

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

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="min-h-screen bg-stone-100 text-stone-900">
    <aside class="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-stone-800 md:block">
      <SideNav id="desktop-nav" />
    </aside>

    <div
      v-if="menuOpen"
      class="fixed inset-0 z-40 bg-stone-950/40 md:hidden"
      @click="menuOpen = false"
    ></div>

    <aside
      class="fixed inset-y-0 left-0 z-50 w-64 transition md:hidden"
      :class="menuOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <SideNav id="mobile-nav" @navigate="menuOpen = false" />
    </aside>

    <div class="md:pl-64">
      <header
        class="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-stone-200 bg-stone-100/90 px-4 backdrop-blur md:px-8"
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
          <div class="min-w-0">
            <p class="truncate text-xs text-stone-500">工作區</p>
            <p class="truncate text-sm font-semibold">{{ pageTitle }}</p>
          </div>
        </div>

        <div class="flex items-center gap-2 sm:gap-3">
          <p
            class="hidden rounded-full border border-stone-300 bg-white px-3 py-1 text-xs text-stone-600 sm:block"
          >
            {{ apiLabel }}
          </p>
          <p class="max-w-28 truncate text-sm text-stone-700 sm:max-w-none">
            {{ session.displayName }}
          </p>
          <button
            v-if="session.entered"
            type="button"
            class="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 hover:bg-stone-50"
            @click="session.leave()"
          >
            離開示範
          </button>
        </div>
      </header>

      <main class="px-4 py-6 md:px-8">
        <div class="mx-auto max-w-6xl">
          <RouterView />
        </div>
      </main>
    </div>
  </div>
</template>
