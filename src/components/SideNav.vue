<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { appName } from '@/config/app'
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
  logout: []
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
  <div class="side-nav">
    <div class="side-brand">
      <span class="brand-mark"><AppIcon name="documents" /></span>
      <div class="side-brand-copy">
        <strong :aria-label="appName"><span>警務流程</span><span>輔助平台</span></strong>
        <small>Workflow Assistant</small>
      </div>
    </div>
    <nav :id="id" aria-label="主要導覽">
      <p class="nav-caption">主選單</p>
      <RouterLink
        v-for="item in items"
        :key="item.to"
        v-slot="{ href, navigate }"
        :to="item.to"
        custom
      >
        <a
          :href="href"
          class="nav-link focus-control"
          :class="{ active: isItemActive(item.to) }"
          :aria-current="isItemActive(item.to) ? 'page' : undefined"
          @click="onNavigate(navigate, $event)"
          ><AppIcon :name="item.mark" />{{ item.label }}</a
        >
      </RouterLink>
    </nav>
    <div class="side-account">
      <div class="account-identity">
        <span class="account-avatar">{{ session.displayName.slice(0, 1) }}</span>
        <div>
          <p>{{ session.displayName }}</p>
          <small>{{ session.roleLabel }}</small>
        </div>
      </div>
      <RouterLink
        to="/change-password"
        class="nav-link focus-control"
        :aria-current="route.path === '/change-password' ? 'page' : undefined"
        @click="emit('navigate')"
        ><AppIcon name="key" />變更密碼</RouterLink
      >
      <button type="button" class="nav-link focus-control" @click="emit('logout')">
        <AppIcon name="logout" />登出
      </button>
    </div>
  </div>
</template>
