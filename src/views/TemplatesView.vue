<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue'
import PageIntro from '@/components/PageIntro.vue'
import PlaceholderGuide from '@/components/PlaceholderGuide.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { useCategoryStore } from '@/stores/categories'
import { useSessionStore } from '@/stores/session'
import { useTemplateStore } from '@/stores/templates'
import { formatBytes } from '@/utils/format'
import { displayFileName } from '@/utils/fileName'
import { formatStoredDate } from '@/utils/rocDate'
import { templateOriginLabel, templateTone } from '@/utils/status'
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const categories = useCategoryStore()
const templates = useTemplateStore()
const session = useSessionStore()

const requestedCategory = computed(() => {
  const raw = route.query.category
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return ''
  return categories.byId(value) ? value : ''
})

const visible = computed(() => {
  const categoryId = requestedCategory.value
  if (!categoryId) return templates.items
  return templates.items.filter((item) => item.categoryId === categoryId)
})

function onFilter(event: Event) {
  const value = event.target instanceof HTMLSelectElement ? event.target.value : ''
  void router.replace({ query: value ? { category: value } : {} })
}

function showAll() {
  void router.replace({ query: {} })
}

function removeTemplate(id: string) {
  void templates.remove(id)
}
</script>

<template>
  <PageIntro
    eyebrow="工作台"
    title="範本文件"
    description="這裡是各案件類別的 Word 範本。檔案存在這個瀏覽器，重新整理後仍會保留，不會送到伺服器。之後 Phase C 可改把同一份清單接到後端。"
  />

  <div class="mb-6">
    <PlaceholderGuide />
  </div>

  <p v-if="templates.error" class="mb-6 text-sm text-rose-800" role="alert">
    {{ templates.error }}
  </p>

  <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div class="w-full max-w-xs">
      <label for="template-category" class="block text-sm font-medium text-stone-800">類別</label>
      <select
        id="template-category"
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
    v-if="templates.ready && visible.length === 0 && templates.total === 0"
    title="還沒有範本文件"
    description="到案件類別的工作台上傳 .docx。範本會留在這個瀏覽器。"
  >
    <RouterLink
      to="/categories"
      class="inline-flex rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
    >
      前往案件類別
    </RouterLink>
  </EmptyState>

  <EmptyState
    v-else-if="templates.ready && visible.length === 0"
    title="這個類別還沒有範本"
    description="可以改看全部類別，或回到該類別的工作台上傳。"
  >
    <button
      type="button"
      class="inline-flex rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-800 hover:bg-stone-50"
      @click="showAll"
    >
      看全部範本
    </button>
  </EmptyState>

  <p v-else-if="!templates.ready" class="text-sm text-stone-500">正在讀取這個瀏覽器裡的範本。</p>

  <section v-else class="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
    <ul class="divide-y divide-stone-200">
      <li
        v-for="item in visible"
        :key="item.id"
        class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="min-w-0">
          <p class="break-all text-sm font-medium text-stone-900">
            {{ displayFileName(item.fileName) }}
          </p>
          <p class="mt-1 text-xs leading-5 text-stone-500">
            <RouterLink
              :to="`/categories/${item.categoryId}`"
              class="text-orange-800 hover:underline"
            >
              {{ categories.nameOf(item.categoryId) }}
            </RouterLink>
            · {{ formatBytes(item.sizeBytes) }} · {{ formatStoredDate(item.addedAt) }}
          </p>
          <p class="mt-1 text-xs leading-5 text-stone-500">
            {{ item.placeholders.length > 0 ? item.placeholders.join('、') : '沒有偵測到欄位' }}
          </p>
        </div>
        <div class="flex items-center gap-3">
          <StatusBadge
            :label="templateOriginLabel(item.origin)"
            :tone="templateTone(item.origin)"
          />
          <button
            v-if="session.canDelete"
            type="button"
            class="text-sm text-stone-600 hover:text-rose-800"
            :aria-label="`移除 ${displayFileName(item.fileName)}`"
            @click="removeTemplate(item.id)"
          >
            移除
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>
