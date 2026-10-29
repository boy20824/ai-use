<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue'
import PageIntro from '@/components/PageIntro.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { useCategoryStore } from '@/stores/categories'
import { useDraftStore } from '@/stores/drafts'
import { formatBytes, formatMime } from '@/utils/format'
import { draftTone } from '@/utils/status'
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const categories = useCategoryStore()
const drafts = useDraftStore()

const requestedCategory = computed(() => {
  const raw = route.query.category
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return ''
  return categories.byId(value) ? value : ''
})

const visible = computed(() => {
  const categoryId = requestedCategory.value
  if (!categoryId) return drafts.items
  return drafts.items.filter((item) => item.categoryId === categoryId)
})

function onFilter(event: Event) {
  const value = event.target instanceof HTMLSelectElement ? event.target.value : ''
  void router.replace({ query: value ? { category: value } : {} })
}

function showAll() {
  void router.replace({ query: {} })
}

function removeDraft(id: string) {
  drafts.remove(id)
}
</script>

<template>
  <PageIntro
    eyebrow="工作台"
    title="我的草稿"
    description="這裡列出這個分頁裡的草稿紀錄，包含一開始的示範項目。重新整理後，本機加入的紀錄會消失。移出只影響目前清單。"
  />

  <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div class="w-full max-w-xs">
      <label for="draft-category" class="block text-sm font-medium text-stone-800">類別</label>
      <select
        id="draft-category"
        class="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-700"
        :value="requestedCategory"
        @change="onFilter"
      >
        <option value="">全部類別</option>
        <option v-for="item in categories.items" :key="item.id" :value="item.id">
          {{ item.code }} {{ item.name }}
        </option>
      </select>
    </div>
    <p class="text-sm text-stone-500">顯示 {{ visible.length }} 筆</p>
  </div>

  <EmptyState
    v-if="visible.length === 0 && drafts.total === 0"
    title="還沒有草稿"
    description="到案件類別的工作台選擇檔案。畫面只會留下檔名、大小與類型。"
  >
    <RouterLink
      to="/categories"
      class="inline-flex rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
    >
      前往案件類別
    </RouterLink>
  </EmptyState>

  <EmptyState
    v-else-if="visible.length === 0"
    title="這個類別還沒有草稿"
    description="可以改看全部類別，或回到該類別的工作台加入紀錄。"
  >
    <button
      type="button"
      class="inline-flex rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-800 hover:bg-stone-50"
      @click="showAll"
    >
      看全部草稿
    </button>
  </EmptyState>

  <section v-else class="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
    <ul class="divide-y divide-stone-200">
      <li
        v-for="item in visible"
        :key="item.id"
        class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="min-w-0">
          <p class="break-all text-sm font-medium text-stone-900">{{ item.fileName }}</p>
          <p class="mt-1 text-xs leading-5 text-stone-500">
            <RouterLink
              :to="`/categories/${item.categoryId}`"
              class="text-orange-800 hover:underline"
            >
              {{ categories.nameOf(item.categoryId) }}
            </RouterLink>
            · {{ formatBytes(item.sizeBytes) }} · {{ formatMime(item.mimeType) }} ·
            {{ item.addedAt }}
          </p>
        </div>
        <div class="flex items-center gap-3">
          <StatusBadge :label="item.source" :tone="draftTone(item.source)" />
          <button
            type="button"
            class="text-sm text-stone-600 hover:text-rose-800"
            :aria-label="`移出 ${item.fileName}`"
            @click="removeDraft(item.id)"
          >
            移出
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>
