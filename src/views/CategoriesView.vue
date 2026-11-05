<script setup lang="ts">
import { categoryGroups } from '@/config/app'
import type { CategoryGroup } from '@/types/domain'
import EmptyState from '@/components/EmptyState.vue'
import PageIntro from '@/components/PageIntro.vue'
import { useCategoryStore } from '@/stores/categories'
import { useSessionStore } from '@/stores/session'
import { formatStoredDate } from '@/utils/rocDate'
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'

const categories = useCategoryStore()
const session = useSessionStore()
const keyword = ref('')
const group = ref<CategoryGroup>('criminal')

const visible = computed(() => {
  const query = keyword.value.trim().toLocaleLowerCase()
  return categories.items
    .filter((item) => (item.group ?? 'criminal') === group.value)
    .filter(
      (item) =>
        !query ||
        [item.name, item.summary, ...item.steps.map((step) => step.title ?? step.body)]
          .join('\n')
          .toLocaleLowerCase()
          .includes(query),
    )
})
</script>

<template>
  <PageIntro
    eyebrow="工作台"
    title="勤務流程"
    description="流程由系統管理員或被授權可維護流程的使用者建立，例如竊盜案、毀損案。進入工作台後可依步驟產生文件，或在全部文件總覽一次勾選。"
  >
    <RouterLink
      v-if="session.canEditCategory && categories.total > 0"
      to="/categories/new"
      class="inline-flex rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
    >
      新增勤務流程
    </RouterLink>
  </PageIntro>

  <div class="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="勤務分類">
    <button
      v-for="(label, key) in categoryGroups"
      :key="key"
      role="tab"
      :aria-selected="group === key"
      class="rounded-xl px-4 py-2"
      :class="group === key ? 'bg-stone-900 text-white' : 'bg-white text-stone-700'"
      @click="group = key"
    >
      {{ label }}
    </button>
  </div>
  <p v-if="categories.error" class="mb-4 text-sm text-rose-800" role="alert">
    {{ categories.error }}
  </p>
  <p v-if="!categories.ready" class="text-sm text-stone-500">正在讀取勤務流程。</p>

  <EmptyState
    v-else-if="categories.total === 0"
    title="還沒有勤務流程"
    description="建立第一個流程後，就可以寫下填寫步驟，並從範本庫選取 Word 範本。範本會集中保存，刪除流程不會刪除檔案。"
  >
    <RouterLink
      v-if="session.canEditCategory"
      to="/categories/new"
      class="inline-flex rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
    >
      新增勤務流程
    </RouterLink>
    <p v-else class="text-sm text-stone-600">請由系統管理員或被授權的使用者新增。</p>
  </EmptyState>

  <template v-else>
    <div class="mb-6 max-w-md">
      <label for="category-search" class="block text-sm font-medium text-stone-800">搜尋</label>
      <input
        id="category-search"
        v-model="keyword"
        type="search"
        name="category-search"
        placeholder="流程名稱或簡述"
        class="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-700"
      />
    </div>

    <EmptyState
      v-if="visible.length === 0"
      title="沒有符合的流程"
      description="請改用其他關鍵字，或清空搜尋後看全部流程。"
    />

    <section v-else class="grid gap-4 md:grid-cols-2" aria-label="勤務流程">
      <RouterLink
        v-for="item in visible"
        :key="item.id"
        :to="`/categories/${item.id}`"
        class="flex h-full flex-col rounded-2xl border border-stone-200 bg-white p-5 shadow-sm transition hover:border-stone-300 hover:-translate-y-1 hover:shadow-lg active:translate-y-0 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700"
      >
        <span class="flex items-center justify-between gap-3">
          <time class="text-xs text-stone-500" :datetime="item.updatedAt">{{
            formatStoredDate(item.updatedAt)
          }}</time>
        </span>
        <h2 class="mt-3 text-lg font-semibold tracking-tight text-stone-950">{{ item.name }}</h2>
        <p class="mt-2 flex-1 text-sm leading-6 text-stone-600">
          {{ item.summary || '尚未填寫簡述' }}
        </p>
        <span class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
          <span>{{ item.steps.length }} 個步驟</span>
          <span>{{ item.templateCount }} 份範本</span>
        </span>
        <span class="mt-4 text-sm font-medium text-stone-900">進入工作台</span>
      </RouterLink>
    </section>
  </template>
</template>
