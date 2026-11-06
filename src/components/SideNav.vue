<script setup lang="ts">
import PoliceBadge from '@/components/PoliceBadge.vue'
import { appName, appTagline } from '@/config/app'
import { mainNav } from '@/navigation'
import { useSessionStore } from '@/stores/session'
import { computed } from 'vue'
import type { NavigationFailure } from 'vue-router'
import { RouterLink, useRoute } from 'vue-router'

defineProps<{
  id?: string
}>()

const emit = defineEmits<{
  navigate: []
}>()

const route = useRoute()
const session = useSessionStore()
const items = computed(() =>
  mainNav.filter((item) => !item.sysadminOnly || session.canManageMembers),
)

function isItemActive(to: string) {
  if (to === '/') return route.path === '/'
  return route.path === to || route.path.startsWith(`${to}/`)
}

function onNavigate(
  navigate: (event?: MouseEvent) => Promise<void | NavigationFailure>,
  event: MouseEvent,
) {
  void navigate(event)
  emit('navigate')
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col bg-nav text-stone-100">
    <div class="border-b border-white/10 px-5 py-5">
      <div class="flex items-center gap-3">
        <span
          class="flex h-10 w-10 items-center justify-center rounded-control bg-accent text-sm font-semibold text-white"
        >
          <PoliceBadge />
        </span>
        <span class="min-w-0">
          <span class="block truncate text-sm font-semibold">{{ appName }}</span>
          <span class="block truncate text-xs text-ink-subtle">{{ appTagline }}</span>
        </span>
      </div>
    </div>

    <nav :id="id" class="flex-1 space-y-1 px-3 py-4" aria-label="主要導覽">
      <RouterLink
        v-for="item in items"
        :key="item.to"
        v-slot="{ href, navigate }"
        :to="item.to"
        custom
      >
        <a
          :href="href"
          class="flex items-center gap-3 rounded-control px-3 py-2.5 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-glow"
          :class="
            isItemActive(item.to)
              ? 'bg-nav-active text-white'
              : 'text-stone-300 hover:bg-nav-hover hover:text-white'
          "
          :aria-current="isItemActive(item.to) ? 'page' : undefined"
          @click="onNavigate(navigate, $event)"
        >
          <span
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-medium"
            :class="
              isItemActive(item.to) ? 'bg-accent text-white' : 'bg-nav-active text-accent-soft'
            "
          >
            {{ item.mark }}
          </span>
          {{ item.label }}
        </a>
      </RouterLink>
    </nav>

    <p class="border-t border-white/10 px-5 py-4 text-xs leading-5 text-ink-subtle">
      範本集中在範本庫。產生文件的欄位不會被保存。
    </p>
  </div>
</template>
