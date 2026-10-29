<script setup lang="ts">
import PageIntro from '@/components/PageIntro.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { usePersonnelStore } from '@/stores/personnel'
import { personnelTone } from '@/utils/status'

const personnel = usePersonnelStore()
</script>

<template>
  <PageIntro
    title="人員"
    description="人員名冊是佔位頁面。姓名與單位都是虛構示範，沒有個資、帳號或聯絡方式。"
  />

  <div class="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
    <div v-if="personnel.items.length === 0" class="px-4 py-10 text-sm text-stone-500">
      尚無人員示範資料。
    </div>
    <div v-else class="overflow-x-auto">
      <table class="min-w-full text-left text-sm">
        <caption class="sr-only">
          人員示範名冊
        </caption>
        <thead class="bg-stone-50 text-xs text-stone-500">
          <tr>
            <th scope="col" class="px-4 py-3 font-medium">編號</th>
            <th scope="col" class="px-4 py-3 font-medium">姓名</th>
            <th scope="col" class="px-4 py-3 font-medium">單位</th>
            <th scope="col" class="px-4 py-3 font-medium">職稱</th>
            <th scope="col" class="px-4 py-3 font-medium">狀態</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-stone-200">
          <tr v-for="item in personnel.items" :key="item.id">
            <td class="whitespace-nowrap px-4 py-3 font-mono text-xs text-stone-500">
              {{ item.id }}
            </td>
            <td class="whitespace-nowrap px-4 py-3 font-medium">{{ item.name }}</td>
            <td class="whitespace-nowrap px-4 py-3">{{ item.department }}</td>
            <td class="whitespace-nowrap px-4 py-3">{{ item.title }}</td>
            <td class="whitespace-nowrap px-4 py-3">
              <StatusBadge :label="item.status" :tone="personnelTone(item.status)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
