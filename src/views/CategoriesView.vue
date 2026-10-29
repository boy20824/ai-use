<script setup lang="ts">
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

const visible = computed(() => {
  const query = keyword.value.trim().toLocaleLowerCase()
  if (!query) return categories.items
  return categories.items.filter((item) =>
    [item.name, item.summary, item.code, ...item.steps]
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
    description="類別由單位自行建立，例如竊盜案、毀損案。進入工作台後可寫下填寫步驟，並從範本庫選取要套用的文件。"
  >
    <RouterLink
      v-if="session.canEditCategory && categories.total > 0"
      to="/categories/new"
      class="inline-flex rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
    >
      新增案件類別
    </RouterLink>
  </PageIntro>

  <p v-if="categories.error" class="mb-4 text-sm text-rose-800" role="alert">
    {{ categories.error }}
  </p>
  <p v-if="!categories.ready" class="text-sm text-stone-500">正在讀取案件類別。</p>

  <EmptyState
    v-else-if="categories.total === 0"
    title="還沒有案件類別"
    description="建立第一個類別後，就可以寫下填寫步驟，並從範本庫選取或上傳 Word 範本。範本會集中保存，刪除類別不會刪除檔案。"
  >
    <RouterLink
      v-if="session.canEditCategory"
      to="/categories/new"
      class="inline-flex rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
    >
      新增案件類別
    </RouterLink>
    <p v-else class="text-sm text-stone-600">請由類別承辦或系統管理員新增。</p>
  </EmptyState>

  <template v-else>
    <div class="mb-6 max-w-md">
      <label for="category-search" class="block text-sm font-medium text-stone-800">搜尋</label>
      <input
        id="category-search"
        v-model="keyword"
        type="search"
        name="category-search"
        placeholder="類別名稱、代號或簡述"
        class="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-700"
      />
    </div>

    <EmptyState
      v-if="visible.length === 0"
      title="沒有符合的類別"
      description="請改用其他關鍵字，或清空搜尋後看全部類別。"
    />

    <section v-else class="grid gap-4 md:grid-cols-2" aria-label="案件類別">
      <RouterLink
        v-for="item in visible"
        :key="item.id"
        :to="`/categories/${item.id}`"
        class="flex h-full flex-col rounded-2xl border border-stone-200 bg-white p-5 shadow-sm transition hover:border-stone-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700"
      >
        <span class="flex items-center justify-between gap-3">
          <span class="font-mono text-xs text-stone-500">{{ item.code || '未設代號' }}</span>
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
