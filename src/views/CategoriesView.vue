<script setup lang="ts">
import { categoryGroups } from '@/config/app'
import type { CategoryGroup } from '@/types/domain'
import EmptyState from '@/components/EmptyState.vue'
import PageIntro from '@/components/PageIntro.vue'
import { useCategoryStore } from '@/stores/categories'
import { useSessionStore } from '@/stores/session'
import CategoryView from './CategoryView.vue'
import AppIcon from '@/components/AppIcon.vue'
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'

const categories = useCategoryStore()
const session = useSessionStore()
const keyword = ref('')
const group = ref<CategoryGroup>('criminal')
const selection = ref('')
const selected = computed(
  () => visible.value.find((item) => item.id === selection.value) ?? visible.value[0],
)

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
    title="案件範本"
    description="依分類選擇案件類別，查看固定範本步驟與各步驟使用的範本。"
  >
    <RouterLink
      v-if="session.canEditCategory && categories.total > 0"
      to="/categories/new"
      class="btn-primary"
    >
      新增案件範本
    </RouterLink>
  </PageIntro>

  <div
    class="group-tabs mb-5 inline-flex flex-wrap gap-1 rounded-control bg-tone-neutral/60 p-1"
    role="tablist"
    aria-label="案件分類"
  >
    <button
      v-for="(label, key) in categoryGroups"
      :key="key"
      role="tab"
      :aria-selected="group === key"
      class="focus-control rounded-control px-3 py-2 text-sm font-medium"
      :class="
        group === key ? 'bg-surface text-ink shadow-card' : 'text-ink-muted hover:bg-surface-muted'
      "
      @click="group = key"
    >
      {{ label }}
    </button>
  </div>
  <p v-if="categories.error" class="mb-4 text-sm text-tone-danger-ink" role="alert">
    {{ categories.error }}
  </p>
  <p v-if="!categories.ready" class="text-sm text-ink-muted">正在讀取案件範本。</p>

  <EmptyState
    v-else-if="categories.total === 0"
    title="還沒有案件範本"
    description="建立第一個流程後，就可以寫下填寫步驟，並從範本庫選取 Word 範本。範本會集中保存，刪除流程不會刪除檔案。"
  >
    <RouterLink v-if="session.canEditCategory" to="/categories/new" class="btn-primary">
      新增案件範本
    </RouterLink>
    <p v-else class="text-sm text-stone-600">請由系統管理員或被授權的使用者新增。</p>
  </EmptyState>

  <template v-else>
    <div class="case-browser">
      <label v-if="visible.length" class="mobile-case-select"
        ><span class="sr-only">選擇案件類別</span
        ><select
          class="field w-full"
          :value="selected?.id"
          @change="selection = ($event.target as HTMLSelectElement).value"
        >
          <option v-for="item in visible" :key="item.id" :value="item.id">
            {{ item.name }} · {{ item.steps.length }} 個範本步驟
          </option>
        </select></label
      >
      <aside class="data-panel case-selector">
        <div class="panel-heading"><h2>案件類別</h2></div>
        <div class="p-3">
          <label for="category-search" class="sr-only">搜尋案件類別</label
          ><input
            id="category-search"
            v-model="keyword"
            type="search"
            placeholder="搜尋案件類別"
            class="field w-full"
          />
        </div>
        <p v-if="!visible.length" class="p-4 text-sm text-ink-muted">沒有符合的案件類別。</p>
        <button
          v-for="item in visible"
          :key="item.id"
          type="button"
          class="case-select-row focus-control"
          :class="{ selected: selected?.id === item.id }"
          :aria-pressed="selected?.id === item.id"
          @click="selection = item.id"
        >
          <AppIcon name="folder" /><span
            ><strong>{{ item.name }}</strong
            ><small>{{ item.steps.length }} 個範本步驟</small></span
          ><span>›</span>
        </button>
      </aside>
      <CategoryView v-if="selected" :key="selected.id" :selected-id="selected.id" embedded />
    </div>
  </template>
</template>
