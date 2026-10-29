<script setup lang="ts">
import PageIntro from '@/components/PageIntro.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { apiConfigured } from '@/config/env'
import { useAccessStore } from '@/stores/access'
import { useCaseStore } from '@/stores/cases'
import { usePersonnelStore } from '@/stores/personnel'
import { caseTone } from '@/utils/status'
import { RouterLink } from 'vue-router'

const cases = useCaseStore()
const personnel = usePersonnelStore()
const access = useAccessStore()

const stats = [
  { label: '案件', value: () => cases.total, hint: '示範清單' },
  { label: '審核中', value: () => cases.pendingCount, hint: '尚未結案' },
  { label: '在職人員', value: () => personnel.activeCount, hint: `名冊 ${personnel.total} 人` },
  { label: '權限角色', value: () => access.total, hint: '存取分類' },
]
</script>

<template>
  <PageIntro
    title="總覽"
    description="這裡彙整案件、人員與存取權限的示範數字。資料寫在前端，重新整理頁面後不會保留登入顯示名稱。"
  />

  <p class="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
    {{
      apiConfigured
        ? '已讀取 API 位址，但 Phase A 不會送出請求，畫面仍使用內建示範資料。'
        : '尚未設定 API 位址。畫面使用內建示範資料。'
    }}
  </p>

  <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="摘要">
    <article
      v-for="stat in stats"
      :key="stat.label"
      class="rounded-2xl border border-stone-200 bg-white px-4 py-4 shadow-sm"
    >
      <p class="text-sm text-stone-500">{{ stat.label }}</p>
      <p class="mt-2 text-3xl font-semibold tracking-tight">{{ stat.value() }}</p>
      <p class="mt-1 text-xs text-stone-500">{{ stat.hint }}</p>
    </article>
  </section>

  <section class="mt-8 rounded-2xl border border-stone-200 bg-white shadow-sm">
    <div class="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-4">
      <h2 class="text-base font-semibold">最近更新的案件</h2>
      <RouterLink to="/cases" class="text-sm text-orange-800 hover:underline">查看全部</RouterLink>
    </div>
    <ul v-if="cases.recent.length > 0" class="divide-y divide-stone-200">
      <li
        v-for="item in cases.recent"
        :key="item.id"
        class="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <p class="text-sm font-medium">{{ item.title }}</p>
          <p class="mt-1 text-xs text-stone-500">
            {{ item.id }} · {{ item.applicant }} · {{ item.department }}
          </p>
        </div>
        <div class="flex items-center gap-3">
          <StatusBadge :label="item.status" :tone="caseTone(item.status)" />
          <time class="text-xs text-stone-500" :datetime="item.updatedAt">{{
            item.updatedAt
          }}</time>
        </div>
      </li>
    </ul>
    <p v-else class="px-4 py-8 text-sm text-stone-500">尚無案件示範資料。</p>
  </section>
</template>
