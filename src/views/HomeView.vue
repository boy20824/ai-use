<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue'
import PageIntro from '@/components/PageIntro.vue'
import { useCategoryStore } from '@/stores/categories'
import { useSessionStore } from '@/stores/session'
import { useTemplateStore } from '@/stores/templates'
import AppIcon from '@/components/AppIcon.vue'
import { categoryGroups } from '@/config/app'
import { displayFileName } from '@/utils/fileName'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

const categories = useCategoryStore()
const templates = useTemplateStore()
const session = useSessionStore()

const entries = [
  { label: '案件範本', icon: 'documents', hint: '依案件類別檢視範本步驟', to: '/categories' },
  { label: '範本步驟', icon: 'steps', hint: '每一步驟挑選對應範本', to: '/categories' },
  { label: '範本庫', icon: 'folder', hint: '共用範本、上傳 .docx', to: '/templates' },
  { label: '產出文件', icon: 'document', hint: '填寫欄位後產生 .docx', to: '/categories' },
]

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
  <PageIntro title="總覽" description="選擇案件類別，依範本步驟挑選範本並產出 .docx 文件。">
    <div class="flex gap-2">
      <RouterLink to="/templates" class="btn-secondary"
        ><AppIcon name="folder" class="mr-2 h-4 w-4" />範本庫</RouterLink
      ><RouterLink to="/categories" class="btn-primary">選擇案件範本</RouterLink>
    </div>
  </PageIntro>
  <section class="overview-entries" aria-label="文件操作入口">
    <RouterLink
      v-for="entry in entries"
      :key="entry.label"
      :to="entry.to"
      class="entry-card focus-control"
      ><span class="entry-icon"><AppIcon :name="entry.icon" /></span>
      <div class="entry-text">
        <h2>{{ entry.label }}</h2>
        <p>{{ entry.hint }}</p>
      </div></RouterLink
    >
  </section>
  <p
    v-if="categories.error || templates.error"
    class="mt-4 text-sm text-tone-danger-ink"
    role="alert"
  >
    {{ categories.error || templates.error }}
  </p>
  <div class="overview-columns">
    <section class="data-panel">
      <div class="panel-heading">
        <h2>案件類別</h2>
        <RouterLink to="/categories" class="focus-control">全部案件範本 ›</RouterLink>
      </div>
      <EmptyState
        v-if="categories.ready && categories.total === 0"
        title="還沒有案件範本"
        description="建立案件類別與固定步驟後，即可連結範本並產生文件。"
        ><RouterLink v-if="session.canEditCategory" to="/categories/new" class="btn-primary"
          >新增案件範本</RouterLink
        ></EmptyState
      >
      <p v-else-if="!categories.ready" class="p-5 text-sm text-ink-muted">正在讀取案件範本。</p>
      <template v-else
        ><div class="category-table-heading">
          <span>案件類別</span><span>分類</span><span>範本步驟</span>
        </div>
        <RouterLink
          v-for="item in categories.items"
          :key="item.id"
          :to="`/categories/${item.id}`"
          class="category-table-row focus-control"
          ><AppIcon name="folder" /><span class="category-name"
            >{{ item.name }}<small>{{ item.steps.length }} 個範本步驟</small></span
          ><span class="group-badge" :class="item.group ?? 'criminal'">{{
            categoryGroups[item.group ?? 'criminal']
          }}</span
          ><span class="category-step-preview">{{
            item.steps.map((step) => step.title || step.body).join(' → ') || '尚未設定步驟'
          }}</span
          ><span class="row-chevron">›</span></RouterLink
        ></template
      >
    </section>
    <section class="data-panel overview-library">
      <div class="panel-heading">
        <h2>範本庫</h2>
        <RouterLink to="/templates" class="focus-control">全部 .docx ›</RouterLink>
      </div>
      <ul v-if="latestTemplates.length">
        <li v-for="item in latestTemplates" :key="item.id">
          <RouterLink to="/templates" class="library-preview-row focus-control"
            ><span class="entry-icon"><AppIcon /></span
            ><span
              ><strong>{{ displayFileName(item.fileName) }}</strong
              ><small>{{ usageLabel(item.usages) }}</small></span
            ></RouterLink
          >
        </li>
      </ul>
      <p v-else class="p-5 text-sm text-ink-muted">
        {{ templates.ready ? '範本庫還沒有文件。' : '正在讀取範本庫。' }}
      </p>
    </section>
  </div>
</template>
