<script setup lang="ts">
import { appName, appPhase } from '@/config/app'
import { loginNav, mainNav } from '@/navigation'
import type { NavigationFailure } from 'vue-router'
import { RouterLink } from 'vue-router'

defineProps<{
  id?: string
}>()

const emit = defineEmits<{
  navigate: []
}>()

function onNavigate(
  navigate: (event?: MouseEvent) => Promise<void | NavigationFailure>,
  event: MouseEvent,
) {
  void navigate(event)
  emit('navigate')
}
</script>

<template>
  <div class="flex h-full flex-col bg-stone-900 text-stone-100">
    <div class="border-b border-white/10 px-5 py-5">
      <div class="flex items-center gap-3">
        <span
          class="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-700 text-sm font-semibold text-white"
        >
          用
        </span>
        <span>
          <span class="block text-sm font-semibold">{{ appName }}</span>
          <span class="block text-xs text-stone-400">{{ appPhase }}</span>
        </span>
      </div>
    </div>

    <nav :id="id" class="flex-1 space-y-1 px-3 py-4" aria-label="主要">
      <RouterLink
        v-for="item in mainNav"
        :key="item.to"
        v-slot="{ href, isExactActive, navigate }"
        :to="item.to"
        custom
      >
        <a
          :href="href"
          class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
          :class="
            isExactActive
              ? 'bg-white/10 text-white'
              : 'text-stone-300 hover:bg-white/10 hover:text-white'
          "
          :aria-current="isExactActive ? 'page' : undefined"
          @click="onNavigate(navigate, $event)"
        >
          <span
            class="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-medium"
            :class="isExactActive ? 'bg-orange-700 text-white' : 'bg-white/10 text-orange-100'"
          >
            {{ item.mark }}
          </span>
          {{ item.label }}
        </a>
      </RouterLink>
    </nav>

    <div class="border-t border-white/10 px-3 py-4">
      <RouterLink v-slot="{ href, isExactActive, navigate }" :to="loginNav.to" custom>
        <a
          :href="href"
          class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
          :class="
            isExactActive
              ? 'bg-white/10 text-white'
              : 'text-stone-300 hover:bg-white/10 hover:text-white'
          "
          :aria-current="isExactActive ? 'page' : undefined"
          @click="onNavigate(navigate, $event)"
        >
          <span
            class="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-medium"
            :class="isExactActive ? 'bg-orange-700 text-white' : 'bg-white/10 text-orange-100'"
          >
            {{ loginNav.mark }}
          </span>
          {{ loginNav.label }}
        </a>
      </RouterLink>
    </div>
  </div>
</template>
