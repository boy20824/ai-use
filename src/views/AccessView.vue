<script setup lang="ts">
import PageIntro from '@/components/PageIntro.vue'
import { useAccessStore } from '@/stores/access'

const access = useAccessStore()
</script>

<template>
  <PageIntro
    title="存取權限"
    description="權限頁是佔位頁面。角色與人數僅供版面預覽，不會授予、變更或核對任何真實權限。"
  />

  <div
    v-if="access.roles.length === 0"
    class="rounded-2xl border border-stone-200 bg-white px-4 py-10 text-sm text-stone-500 shadow-sm"
  >
    尚無存取示範資料。
  </div>
  <section v-else class="grid gap-4 md:grid-cols-2" aria-label="權限角色">
    <article
      v-for="role in access.roles"
      :key="role.id"
      class="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
    >
      <div class="flex items-start justify-between gap-3">
        <h2 class="text-base font-semibold">{{ role.name }}</h2>
        <p class="font-mono text-xs text-stone-500">{{ role.id }}</p>
      </div>
      <p class="mt-3 text-sm leading-6 text-stone-600">{{ role.scope }}</p>
      <p class="mt-4 text-sm text-stone-800">{{ role.members }} 人</p>
    </article>
  </section>
</template>
