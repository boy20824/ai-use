<script setup lang="ts">
import PageIntro from '@/components/PageIntro.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { apiConfigured } from '@/config/env'
import { useCategoryStore } from '@/stores/categories'
import { useSessionStore } from '@/stores/session'
import { useTemplateStore } from '@/stores/templates'
import { formatBytes } from '@/utils/format'
import { templateOriginLabel, templateTone } from '@/utils/status'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

const categories = useCategoryStore()
const templates = useTemplateStore()
const session = useSessionStore()

const stats = computed(() => [
  {
    label: '案件類別',
    value: String(categories.total),
    hint: '可進入的工作台',
    to: '/categories',
  },
  {
    label: '相關文件',
    value: String(categories.documentCount),
    hint: '說明、表單與檢核',
    to: '/categories',
  },
  {
    label: '範本文件',
    value: templates.ready ? String(templates.total) : '…',
    hint: '存在這個瀏覽器',
    to: '/templates',
  },
  {
    label: '目前角色',
    value: session.roleLabel,
    hint: session.displayName,
    to: '/access',
  },
])

const latestTemplates = computed(() => templates.items.slice(0, 4))
</script>

<template>
  <PageIntro
    eyebrow="工作台"
    title="總覽"
    description="先選擇案件類別，閱讀相關文件與步驟，再上傳範本、填入欄位並下載文件。登入比對的是前端示範帳號，正式驗證會在 Phase C/D 接上。"
  >
    <RouterLink
      to="/categories"
      class="inline-flex rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
    >
      瀏覽案件類別
    </RouterLink>
  </PageIntro>

  <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="摘要">
    <RouterLink
      v-for="stat in stats"
      :key="stat.label"
      :to="stat.to"
      class="rounded-2xl border border-stone-200 bg-white px-5 py-5 shadow-sm transition hover:border-stone-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700"
    >
      <p class="text-sm text-stone-500">{{ stat.label }}</p>
      <p class="mt-3 text-3xl font-semibold tracking-tight text-stone-950 tabular-nums">
        {{ stat.value }}
      </p>
      <p class="mt-2 text-xs text-stone-500">{{ stat.hint }}</p>
    </RouterLink>
  </section>

  <p v-if="templates.error" class="mt-4 text-sm text-rose-800" role="alert">
    {{ templates.error }}
  </p>

  <div class="mt-8 grid gap-6 lg:grid-cols-5">
    <section
      class="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm lg:col-span-3"
    >
      <div class="flex items-center justify-between gap-3 border-b border-stone-200 px-5 py-4">
        <h2 class="text-base font-semibold">案件類別</h2>
        <RouterLink to="/categories" class="text-sm text-orange-800 hover:underline"
          >查看全部</RouterLink
        >
      </div>
      <ul v-if="categories.recent.length > 0" class="divide-y divide-stone-200">
        <li v-for="item in categories.recent" :key="item.id">
          <RouterLink
            :to="`/categories/${item.id}`"
            class="flex items-center justify-between gap-4 px-5 py-4 hover:bg-stone-50"
          >
            <span class="min-w-0">
              <span class="block text-sm font-medium text-stone-900">{{ item.name }}</span>
              <span class="mt-1 block text-xs text-stone-500">
                {{ item.code }} · {{ item.audience }}
              </span>
            </span>
            <time class="shrink-0 text-xs text-stone-500" :datetime="item.updatedAt">{{
              item.updatedAt
            }}</time>
          </RouterLink>
        </li>
      </ul>
      <p v-else class="px-5 py-8 text-sm text-stone-500">尚無類別示範資料。</p>
    </section>

    <section
      class="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm lg:col-span-2"
    >
      <div class="flex items-center justify-between gap-3 border-b border-stone-200 px-5 py-4">
        <h2 class="text-base font-semibold">最近範本</h2>
        <RouterLink to="/templates" class="text-sm text-orange-800 hover:underline"
          >查看全部</RouterLink
        >
      </div>
      <ul v-if="latestTemplates.length > 0" class="divide-y divide-stone-200">
        <li v-for="item in latestTemplates" :key="item.id" class="px-5 py-4">
          <RouterLink
            :to="`/categories/${item.categoryId}`"
            class="break-all text-sm font-medium text-stone-900 hover:underline"
          >
            {{ item.fileName }}
          </RouterLink>
          <p class="mt-1 text-xs text-stone-500">
            {{ categories.nameOf(item.categoryId) }} · {{ formatBytes(item.sizeBytes) }}
          </p>
          <div class="mt-2 flex items-center justify-between gap-3">
            <StatusBadge
              :label="templateOriginLabel(item.origin)"
              :tone="templateTone(item.origin)"
            />
            <time class="text-xs text-stone-500">{{ item.addedAt }}</time>
          </div>
        </li>
      </ul>
      <p v-else class="px-5 py-8 text-sm text-stone-500">還沒有範本文件。</p>
    </section>
  </div>

  <p class="mt-8 text-xs leading-5 text-stone-500">
    {{
      apiConfigured
        ? '已讀取 API 位址。畫面仍使用內建示範資料，不會送出請求。'
        : '未設定 API 位址。畫面使用內建示範資料。'
    }}
  </p>
</template>
