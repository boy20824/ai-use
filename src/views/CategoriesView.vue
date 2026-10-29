<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue'
import PageIntro from '@/components/PageIntro.vue'
import { useCategoryStore } from '@/stores/categories'
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'

const categories = useCategoryStore()
const keyword = ref('')

const visible = computed(() => {
  const query = keyword.value.trim().toLocaleLowerCase()
  if (!query) return categories.items
  return categories.items.filter((item) =>
    [item.name, item.summary, item.code, item.audience]
      .join('\n')
      .toLocaleLowerCase()
      .includes(query),
  )
})
</script>

<template>
  <PageIntro
    eyebrow="工作台"
    title="案件類別"
    description="選擇一種虛構類別，查看相關文件與填寫步驟，上傳範本後即可產生文件。這裡沒有真實案件。"
  />

  <div class="mb-6 max-w-md">
    <label for="category-search" class="block text-sm font-medium text-stone-800">搜尋</label>
    <input
      id="category-search"
      v-model="keyword"
      type="search"
      name="category-search"
      placeholder="類別名稱、代號或說明"
      class="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-700"
    />
  </div>

  <EmptyState
    v-if="visible.length === 0"
    title="沒有符合的類別"
    description="請改用其他關鍵字，或清空搜尋後看全部示範類別。"
  />

  <section v-else class="grid gap-4 md:grid-cols-2" aria-label="案件類別">
    <RouterLink
      v-for="item in visible"
      :key="item.id"
      :to="`/categories/${item.id}`"
      class="flex h-full flex-col rounded-2xl border border-stone-200 bg-white p-5 shadow-sm transition hover:border-stone-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700"
    >
      <span class="flex items-center justify-between gap-3">
        <span class="font-mono text-xs text-stone-500">{{ item.code }}</span>
        <time class="text-xs text-stone-500" :datetime="item.updatedAt">{{ item.updatedAt }}</time>
      </span>
      <h2 class="mt-3 text-lg font-semibold tracking-tight text-stone-950">{{ item.name }}</h2>
      <p class="mt-2 flex-1 text-sm leading-6 text-stone-600">{{ item.summary }}</p>
      <span class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
        <span>{{ item.audience }}</span>
        <span>{{ item.documents.length }} 份文件</span>
        <span>{{ item.steps.length }} 個步驟</span>
      </span>
      <span class="mt-4 text-sm font-medium text-stone-900">進入工作台</span>
    </RouterLink>
  </section>
</template>
