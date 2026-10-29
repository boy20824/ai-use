<script setup lang="ts">
import PageIntro from '@/components/PageIntro.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { useCaseStore } from '@/stores/cases'
import { caseTone } from '@/utils/status'

const cases = useCaseStore()
</script>

<template>
  <PageIntro
    title="案件"
    description="案件清單是佔位頁面。以下列為前端示範資料，不能新增、送審或寫回伺服器。"
  />

  <div class="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
    <div v-if="cases.items.length === 0" class="px-4 py-10 text-sm text-stone-500">
      尚無案件示範資料。
    </div>
    <div v-else class="overflow-x-auto">
      <table class="min-w-full text-left text-sm">
        <caption class="sr-only">
          案件示範清單
        </caption>
        <thead class="bg-stone-50 text-xs text-stone-500">
          <tr>
            <th scope="col" class="px-4 py-3 font-medium">編號</th>
            <th scope="col" class="px-4 py-3 font-medium">標題</th>
            <th scope="col" class="px-4 py-3 font-medium">申請人</th>
            <th scope="col" class="px-4 py-3 font-medium">單位</th>
            <th scope="col" class="px-4 py-3 font-medium">狀態</th>
            <th scope="col" class="px-4 py-3 font-medium">更新日期</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-stone-200">
          <tr v-for="item in cases.items" :key="item.id">
            <td class="whitespace-nowrap px-4 py-3 font-mono text-xs text-stone-500">
              {{ item.id }}
            </td>
            <td class="min-w-56 px-4 py-3 font-medium">{{ item.title }}</td>
            <td class="whitespace-nowrap px-4 py-3">{{ item.applicant }}</td>
            <td class="whitespace-nowrap px-4 py-3">{{ item.department }}</td>
            <td class="whitespace-nowrap px-4 py-3">
              <StatusBadge :label="item.status" :tone="caseTone(item.status)" />
            </td>
            <td class="whitespace-nowrap px-4 py-3 text-stone-600">
              <time :datetime="item.updatedAt">{{ item.updatedAt }}</time>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
