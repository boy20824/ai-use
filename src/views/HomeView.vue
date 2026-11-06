<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue'
import PageIntro from '@/components/PageIntro.vue'
import { useCategoryStore } from '@/stores/categories'
import { useSessionStore } from '@/stores/session'
import { useTemplateStore } from '@/stores/templates'
import { formatBytes } from '@/utils/format'
import { displayFileName } from '@/utils/fileName'
import { formatStoredDate } from '@/utils/rocDate'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

const categories = useCategoryStore()
const templates = useTemplateStore()
const session = useSessionStore()

const stats = computed(() => [
  {
    label: '勤務流程',
    value: categories.ready ? String(categories.total) : '…',
    hint: categories.ready && categories.total === 0 ? '尚未建立' : '可進入的工作台',
    to: '/categories',
  },
  {
    label: '填寫步驟',
    value: categories.ready ? String(categories.stepCount) : '…',
    hint: categories.ready && categories.stepCount === 0 ? '流程建立後可新增' : '各流程的準備順序',
    to: '/categories',
  },
  {
    label: '範本庫',
    value: templates.ready ? String(templates.total) : '…',
    hint: '全站共用，不屬於單一流程',
    to: '/templates',
  },
  {
    label: '留言板',
    value: '建議',
    hint: '網頁改善建議',
    to: '/feedback',
  },
])

const latestTemplates = computed(() => templates.items.slice(0, 4))

function usageLabel(usages: { categoryId: string; categoryName: string; stepBody: string }[]) {
  const labels = usages
    .map((usage) => {
      const categoryName = categories.byId(usage.categoryId)?.name ?? usage.categoryName
      const step = usage.stepBody.replace(/\s+/g, ' ').trim()
      if (!categoryName) return step
      return step ? `${categoryName} → ${step}` : categoryName
    })
    .filter((label) => label.length > 0)
  return labels.length > 0 ? labels.join('、') : '尚未連結步驟'
}
</script>

<template>
  <PageIntro
    eyebrow="工作台"
    title="總覽"
    description="先建立勤務流程，寫下填寫步驟，再從範本庫選取或上傳 Word 範本。產生文件時填入的欄位只留在這個畫面，不會寫進服務。"
  >
    <RouterLink
      v-if="session.canEditCategory && categories.ready && categories.total === 0"
      to="/categories/new"
      class="btn-primary"
    >
      新增勤務流程
    </RouterLink>
    <RouterLink v-else to="/categories" class="btn-primary"> 瀏覽勤務流程 </RouterLink>
  </PageIntro>

  <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="摘要">
    <RouterLink
      v-for="stat in stats"
      :key="stat.label"
      :to="stat.to"
      class="rounded-card border border-edge bg-surface px-4 py-4 shadow-card transition hover:border-edge-strong hover:shadow-float focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <p class="text-sm text-ink-muted">{{ stat.label }}</p>
      <p class="mt-3 text-3xl font-semibold tracking-tight text-ink-strong tabular-nums">
        {{ stat.value }}
      </p>
      <p class="mt-2 text-xs text-ink-muted">{{ stat.hint }}</p>
    </RouterLink>
  </section>

  <p
    v-if="categories.error || templates.error"
    class="mt-4 text-sm text-tone-danger-ink"
    role="alert"
  >
    {{ categories.error || templates.error }}
  </p>

  <div class="mt-4 grid gap-4 lg:grid-cols-5">
    <section
      class="overflow-hidden rounded-2xl border border-edge bg-surface shadow-card lg:col-span-3"
    >
      <div class="flex items-center justify-between gap-3 border-b border-edge px-4 py-3">
        <h2 class="text-base font-semibold">勤務流程</h2>
        <RouterLink to="/categories" class="focus-control text-sm text-accent-ink hover:underline"
          >查看全部</RouterLink
        >
      </div>
      <EmptyState
        v-if="categories.ready && categories.total === 0"
        title="還沒有勤務流程"
        description="新增一個流程後，總覽會列出工作台。範本庫的文件可以稍後再連結過來。"
      >
        <RouterLink v-if="session.canEditCategory" to="/categories/new" class="btn-primary">
          新增勤務流程
        </RouterLink>
        <p v-else class="text-sm text-stone-600">請由系統管理員或被授權的使用者新增。</p>
      </EmptyState>
      <p v-else-if="!categories.ready" class="px-5 py-8 text-sm text-ink-muted">
        正在讀取勤務流程。
      </p>
      <ul v-else class="divide-y divide-stone-200">
        <li v-for="item in categories.recent" :key="item.id">
          <RouterLink
            :to="`/categories/${item.id}`"
            class="focus-control flex items-center justify-between gap-4 px-4 py-3 hover:bg-surface-muted"
          >
            <span class="min-w-0">
              <span class="block text-sm font-medium text-ink">{{ item.name }}</span>
              <span class="mt-1 block text-xs text-ink-muted">
                {{ item.steps.length }} 個步驟 · {{ item.templateCount }} 份範本
              </span>
            </span>
            <time class="shrink-0 text-xs text-ink-muted" :datetime="item.updatedAt">{{
              formatStoredDate(item.updatedAt)
            }}</time>
          </RouterLink>
        </li>
      </ul>
    </section>

    <section
      class="overflow-hidden rounded-2xl border border-edge bg-surface shadow-card lg:col-span-2"
    >
      <div class="flex items-center justify-between gap-3 border-b border-edge px-4 py-3">
        <h2 class="text-base font-semibold">最近範本</h2>
        <RouterLink to="/templates" class="focus-control text-sm text-accent-ink hover:underline"
          >查看全部</RouterLink
        >
      </div>
      <ul v-if="latestTemplates.length > 0" class="divide-y divide-stone-200">
        <li v-for="item in latestTemplates" :key="item.id" class="px-4 py-3">
          <RouterLink
            to="/templates"
            class="focus-control break-all text-sm font-medium text-ink hover:underline"
          >
            {{ displayFileName(item.fileName) }}
          </RouterLink>
          <p class="mt-1 text-xs text-ink-muted">
            {{ usageLabel(item.usages) }} · {{ formatBytes(item.sizeBytes) }}
          </p>
          <p class="mt-2 text-xs text-ink-muted">{{ formatStoredDate(item.addedAt) }}</p>
        </li>
      </ul>
      <p v-else class="px-5 py-8 text-sm text-ink-muted">範本庫還沒有文件。</p>
    </section>
  </div>

  <p class="mt-8 text-xs leading-5 text-ink-muted">
    產生文件時填入的姓名、日期與其他欄位只留在該畫面，不會寫進服務。
  </p>
</template>
