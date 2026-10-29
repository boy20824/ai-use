<script setup lang="ts">
import PageIntro from '@/components/PageIntro.vue'
import { useAccessStore } from '@/stores/access'
import { useSessionStore } from '@/stores/session'

const access = useAccessStore()
const session = useSessionStore()
</script>

<template>
  <PageIntro
    eyebrow="管理"
    title="存取權限"
    description="三種示範角色可以做的事列在下面。人數與勾選只供閱讀，不會寫入伺服器，也不能變更真實授權。"
  />

  <p
    class="mb-6 rounded-2xl border border-stone-200 bg-white px-5 py-4 text-sm leading-6 text-stone-700 shadow-sm"
  >
    目前身分是{{ session.roleLabel }}（{{
      session.displayName
    }}）。標示「可」的功能，這個角色可以使用。要換角色，請登出後在登入頁改選身分。
  </p>

  <section class="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
    <div class="overflow-x-auto">
      <table class="min-w-full text-left text-sm">
        <caption class="sr-only">
          示範角色權限對照
        </caption>
        <thead class="bg-stone-50 text-xs text-stone-500">
          <tr>
            <th scope="col" class="px-4 py-3 font-medium">功能</th>
            <th
              v-for="roleId in access.roleOrder"
              :key="roleId"
              scope="col"
              class="px-4 py-3 font-medium"
              :class="session.role === roleId ? 'bg-orange-50 text-stone-800' : ''"
            >
              {{ access.roleLabels[roleId] }}
              <span v-if="session.role === roleId" class="mt-1 block font-normal text-orange-800">
                目前身分
              </span>
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-stone-200">
          <tr v-for="row in access.rows" :key="row.key">
            <th scope="row" class="px-4 py-3 font-medium text-stone-900">{{ row.label }}</th>
            <td
              v-for="roleId in access.roleOrder"
              :key="roleId"
              class="px-4 py-3"
              :class="session.role === roleId ? 'bg-orange-50/70' : ''"
            >
              {{ row.roles.includes(roleId) ? '可' : '不可' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section class="mt-6 grid gap-4 md:grid-cols-3" aria-label="角色說明">
    <article
      v-for="role in access.roles"
      :key="role.id"
      class="rounded-2xl border bg-white p-5 shadow-sm"
      :class="session.role === role.id ? 'border-stone-900' : 'border-stone-200'"
    >
      <div class="flex items-start justify-between gap-3">
        <h2 class="text-base font-semibold text-stone-950">{{ role.name }}</h2>
        <p v-if="session.role === role.id" class="text-xs font-medium text-orange-800">目前身分</p>
      </div>
      <p class="mt-3 text-sm leading-6 text-stone-600">{{ role.summary }}</p>
      <p class="mt-4 text-sm text-stone-800">示範人數 {{ role.members }}</p>
      <ul class="mt-3 space-y-1">
        <li v-for="permission in role.permissions" :key="permission" class="text-sm text-stone-600">
          {{ permission }}
        </li>
      </ul>
    </article>
  </section>
</template>
