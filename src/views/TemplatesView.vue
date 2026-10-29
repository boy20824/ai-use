<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue'
import FileDropzone from '@/components/FileDropzone.vue'
import PageIntro from '@/components/PageIntro.vue'
import PlaceholderGuide from '@/components/PlaceholderGuide.vue'
import { useCategoryStore } from '@/stores/categories'
import { useSessionStore } from '@/stores/session'
import { useTemplateStore } from '@/stores/templates'
import type { TemplateSummary } from '@/storage'
import { formatBytes } from '@/utils/format'
import { displayFileName } from '@/utils/fileName'
import { formatStoredDate } from '@/utils/rocDate'
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const categories = useCategoryStore()
const templates = useTemplateStore()
const session = useSessionStore()
const feedback = ref('')
const feedbackTone = ref<'ok' | 'warn'>('ok')
const pendingDelete = ref<TemplateSummary | null>(null)
const deleting = ref(false)

const disabledReason = '需要可維護類別的權限才能上傳範本。刪除範本只有系統管理員可以操作。'

const requestedCategory = computed(() => {
  const raw = route.query.category
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return ''
  return categories.byId(value) ? value : ''
})

const visible = computed(() => {
  const categoryId = requestedCategory.value
  if (!categoryId) return templates.items
  return templates.items.filter((item) =>
    item.usages.some((usage) => usage.categoryId === categoryId),
  )
})

function usageLinks(item: TemplateSummary) {
  return item.usages
    .map((usage) => {
      const categoryName = categories.byId(usage.categoryId)?.name ?? usage.categoryName
      const step = usage.stepBody.replace(/\s+/g, ' ').trim()
      const short = step.length > 24 ? `${step.slice(0, 24)}…` : step
      return {
        id: `${usage.categoryId}-${usage.stepId}`,
        categoryId: usage.categoryId,
        label: short ? `${categoryName} → ${short}` : categoryName,
      }
    })
    .filter((usage) => usage.label.length > 0)
}

function onFilter(event: Event) {
  const value = event.target instanceof HTMLSelectElement ? event.target.value : ''
  void router.replace({ query: value ? { category: value } : {} })
}

function showAll() {
  void router.replace({ query: {} })
}

function askRemove(item: TemplateSummary) {
  pendingDelete.value = item
}

async function confirmRemove() {
  const item = pendingDelete.value
  if (!item || deleting.value) return
  deleting.value = true
  try {
    await templates.remove(item.id)
    await categories.reload()
    pendingDelete.value = null
    feedbackTone.value = 'ok'
    feedback.value = `已從範本庫移除「${displayFileName(item.fileName)}」。`
  } catch (cause) {
    feedbackTone.value = 'warn'
    feedback.value = cause instanceof Error ? cause.message : '無法移除範本。'
  } finally {
    deleting.value = false
  }
}

async function onFiles(files: File[]) {
  if (!session.canUpload) return
  const result = await templates.addFiles(files)
  if (result.added === 0 && result.skipped > 0 && result.rejected.length === 0) {
    feedbackTone.value = 'warn'
    feedback.value = `範本庫最多 ${templates.limit} 份，沒有再加入。`
    return
  }
  if (result.added === 0) {
    feedbackTone.value = 'warn'
    feedback.value = result.rejected[0] ?? '沒有可保存的 .docx 範本。'
    return
  }
  feedbackTone.value = result.rejected.length > 0 || result.skipped > 0 ? 'warn' : 'ok'
  const notes = [`已上傳 ${result.added} 份到範本庫。可在案件類別工作台選取。`]
  if (result.skipped > 0) notes.push(`另有 ${result.skipped} 份因筆數上限未加入。`)
  if (result.rejected.length > 0) notes.push(`${result.rejected.join('。')}。`)
  feedback.value = notes.join('')
}
</script>

<template>
  <PageIntro
    eyebrow="工作台"
    title="範本庫"
    description="每一份 Word 範本只保存一次，不屬於單一案件類別。類別透過連結使用這些範本。上傳與連結需要可維護類別的權限，刪除只有系統管理員可以操作。"
  />

  <div class="mb-6">
    <PlaceholderGuide />
  </div>

  <div v-if="session.canUpload" class="mb-6">
    <FileDropzone
      :enabled="true"
      :disabled-reason="disabledReason"
      title="上傳 .docx 到範本庫"
      hint="檔案會存在服務上的範本庫。產生文件時填入的欄位不會被保存。"
      accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      @select="onFiles"
    />
  </div>

  <p
    v-if="feedback"
    class="mb-6 rounded-xl px-3 py-2 text-sm leading-6"
    :class="feedbackTone === 'ok' ? 'bg-emerald-50 text-emerald-950' : 'bg-amber-50 text-amber-950'"
    role="status"
  >
    {{ feedback }}
  </p>

  <p v-if="templates.error" class="mb-6 text-sm text-rose-800" role="alert">
    {{ templates.error }}
  </p>

  <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div class="w-full max-w-xs">
      <label for="template-category" class="block text-sm font-medium text-stone-800">
        使用於類別
      </label>
      <select
        id="template-category"
        class="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-700"
        :value="requestedCategory"
        @change="onFilter"
      >
        <option value="">全部範本</option>
        <option v-for="item in categories.items" :key="item.id" :value="item.id">
          {{ item.code ? `${item.code} ` : '' }}{{ item.name }}
        </option>
      </select>
    </div>
    <p class="text-sm text-stone-500">顯示 {{ visible.length }} 筆</p>
  </div>

  <EmptyState
    v-if="templates.ready && visible.length === 0 && templates.total === 0"
    title="範本庫還沒有文件"
    description="具有維護權限的使用者上傳 .docx 後，可在案件類別的工作台按「從範本庫選取」連結過來。"
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
    title="這個類別還沒有連結範本"
    description="可以改看全部範本，或回到該類別的工作台選取。"
  >
    <button
      type="button"
      class="inline-flex rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-800 hover:bg-stone-50"
      @click="showAll"
    >
      看全部範本
    </button>
  </EmptyState>

  <p v-else-if="!templates.ready" class="text-sm text-stone-500">正在讀取範本庫。</p>

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
            {{ formatBytes(item.sizeBytes) }} · {{ formatStoredDate(item.addedAt) }}
          </p>
          <p class="mt-1 text-xs leading-5 text-stone-500">
            {{ item.placeholders.length > 0 ? item.placeholders.join('、') : '沒有偵測到欄位' }}
          </p>
          <p class="mt-2 text-xs leading-5 text-stone-600">
            <span>使用於：</span>
            <template v-if="usageLinks(item).length === 0">尚未被任何步驟使用</template>
            <template v-else>
              <RouterLink
                v-for="(link, index) in usageLinks(item)"
                :key="link.id"
                :to="`/categories/${link.categoryId}`"
                class="text-orange-800 hover:underline"
              >
                {{ link.label }}<span v-if="index < usageLinks(item).length - 1">、</span>
              </RouterLink>
            </template>
          </p>
        </div>
        <div class="flex items-center gap-3">
          <button
            v-if="session.canDelete"
            type="button"
            class="text-sm text-stone-600 hover:text-rose-800"
            :aria-label="`移除 ${displayFileName(item.fileName)}`"
            @click="askRemove(item)"
          >
            移除
          </button>
        </div>
      </li>
    </ul>
  </section>

  <div
    v-if="pendingDelete"
    class="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 px-4"
    @click.self="pendingDelete = null"
  >
    <div
      class="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-template-title"
    >
      <h2 id="delete-template-title" class="text-base font-semibold text-stone-950">移除範本</h2>
      <p class="mt-2 text-sm leading-6 text-stone-600">
        <template v-if="usageLinks(pendingDelete).length > 0">
          「{{
            displayFileName(pendingDelete.fileName)
          }}」目前用在下列案件類別的步驟。確定後會解除這些連結，並從範本庫刪除檔案。類別與步驟會保留。
        </template>
        <template v-else>
          「{{
            displayFileName(pendingDelete.fileName)
          }}」尚未連結任何步驟。確定後會從範本庫刪除檔案。
        </template>
      </p>
      <ul v-if="usageLinks(pendingDelete).length > 0" class="mt-3 list-disc space-y-1 pl-5">
        <li v-for="link in usageLinks(pendingDelete)" :key="link.id" class="text-sm text-stone-800">
          {{ link.label }}
        </li>
      </ul>
      <div class="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          class="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:bg-stone-300"
          :disabled="deleting"
          @click="confirmRemove"
        >
          確定移除
        </button>
        <button
          type="button"
          class="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-800 hover:bg-stone-50"
          @click="pendingDelete = null"
        >
          取消
        </button>
      </div>
    </div>
  </div>
</template>
