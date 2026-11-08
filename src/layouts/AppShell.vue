<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import SideNav from '@/components/SideNav.vue'
import { mainNav } from '@/navigation'
import { useSessionStore } from '@/stores/session'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'

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
  <div class="app-shell flex min-h-dvh items-stretch bg-canvas text-ink">
    <aside class="desktop-sidebar hidden shrink-0 bg-nav md:block">
      <div class="sticky top-0 flex h-dvh flex-col">
        <SideNav id="desktop-nav" @logout="logout" />
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
      :inert="!menuOpen"
    >
      <SideNav id="mobile-nav" @navigate="menuOpen = false" @logout="logout" />
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header
        class="app-header sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-edge bg-surface px-4 md:px-page-x"
      >
        <div class="flex min-w-0 items-center gap-3">
          <button
            type="button"
            class="btn-secondary h-10 w-10 shrink-0 items-center justify-center md:hidden"
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
          <p class="truncate text-sm font-semibold">{{ route.meta.title }}</p>
        </div>

        <RouterLink to="/templates" class="header-library focus-control"
          ><AppIcon name="folder" /><span>範本庫</span></RouterLink
        >
      </header>

      <main class="app-main flex-1 px-4 py-6 md:px-page-x md:py-page-y">
        <div class="mx-auto max-w-[1280px]">
          <RouterView />
        </div>
      </main>
      <nav class="mobile-bottom-nav md:hidden" aria-label="行動導覽">
        <RouterLink
          v-for="item in mainNav.filter((item) => !item.sysadminOnly)"
          :key="item.to"
          :to="item.to"
          :class="{ active: item.to === '/' ? route.path === '/' : route.path.startsWith(item.to) }"
          ><AppIcon :name="item.mark" /><span>{{
            item.mobileLabel ?? item.label
          }}</span></RouterLink
        ><button type="button" @click="menuOpen = true">
          <AppIcon name="members" /><span>我的</span>
        </button>
      </nav>
    </div>
  </div>
</template>
