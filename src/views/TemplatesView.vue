<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { categoryGroups } from '@/config/app'
import type { CategoryGroup } from '@/types/domain'
import { downloadBytes } from '@/utils/download'
import { templateMimeType } from '@/services/docxTemplates'
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

const fieldKeyHint = '{{欄位鍵}}'

const route = useRoute()
const router = useRouter()
const categories = useCategoryStore()
const templates = useTemplateStore()
const session = useSessionStore()
const keyword = ref('')
const group = ref<CategoryGroup | ''>('')
const feedback = ref('')
const feedbackTone = ref<'ok' | 'warn'>('ok')
const pendingDelete = ref<TemplateSummary | null>(null)
const deleting = ref(false)
const replacing = ref('')
const replacementBusy = ref(false)

const disabledReason = '需要可維護流程的權限才能上傳範本。刪除範本只有系統管理員可以操作。'

const requestedCategory = computed(() => {
  const raw = route.query.category
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return ''
  return categories.byId(value) ? value : ''
})

const visible = computed(() => {
  const query = keyword.value.trim().toLocaleLowerCase()
  return templates.items.filter(
    (item) =>
      (!requestedCategory.value ||
        item.usages.some((usage) => usage.categoryId === requestedCategory.value)) &&
      (!group.value ||
        item.usages.some(
          (usage) => (categories.byId(usage.categoryId)?.group ?? 'criminal') === group.value,
        )) &&
      (!query ||
        [
          displayFileName(item.fileName),
          ...item.placeholders,
          ...item.usages.map((usage) => `${usage.categoryName} ${usage.stepBody}`),
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(query)),
  )
})

async function downloadTemplate(item: TemplateSummary) {
  try {
    const bytes = await templates.bytesFor(item.id)
    if (!bytes) throw new Error('無法讀取範本檔案。')
    downloadBytes(new Uint8Array(bytes), displayFileName(item.fileName), templateMimeType)
  } catch (cause) {
    feedbackTone.value = 'warn'
    feedback.value = cause instanceof Error ? cause.message : '無法下載範本。'
  }
}

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
  keyword.value = ''
  group.value = ''
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

async function replaceFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !replacing.value || replacementBusy.value) return
  replacementBusy.value = true
  try {
    const result = await templates.replace(replacing.value, file)
    feedbackTone.value = 'ok'
    feedback.value = `已替換範本，${result.linkedCategoryCount} 個關聯流程同步使用新版。`
    await categories.reload()
    replacing.value = ''
  } catch (cause) {
    feedbackTone.value = 'warn'
    feedback.value = cause instanceof Error ? cause.message : '無法替換範本。'
  } finally {
    replacementBusy.value = false
    input.value = ''
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
  feedbackTone.value =
    result.rejected.length > 0 || result.skipped > 0 || result.formatNotice ? 'warn' : 'ok'
  const notes = [`已上傳 ${result.added} 份到範本庫。可在案件範本工作台選取。`]
  if (result.skipped > 0) notes.push(`另有 ${result.skipped} 份因筆數上限未加入。`)
  if (result.rejected.length > 0) notes.push(`${result.rejected.join('。')}。`)
  if (result.formatNotice) notes.push(result.formatNotice)
  feedback.value = notes.join('')
}
</script>

<template>
  <div class="templates-page">
    <PageIntro title="範本庫" description="共用 Word 範本，可指定使用的案件類別與步驟。" />

    <p
      v-if="feedback"
      class="mb-6 rounded-control px-3 py-2 text-sm leading-6"
      :class="
        feedbackTone === 'ok' ? 'bg-emerald-50 text-emerald-950' : 'bg-amber-50 text-amber-950'
      "
      role="status"
    >
      {{ feedback }}
    </p>

    <p v-if="templates.error" class="mb-6 text-sm text-tone-danger-ink" role="alert">
      {{ templates.error }}
    </p>

    <div class="library-toolbar">
      <div
        class="group-tabs inline-flex gap-1 rounded-control bg-tone-neutral/60 p-1"
        role="tablist"
        aria-label="範本分類"
      >
        <button
          type="button"
          role="tab"
          :aria-selected="group === ''"
          class="focus-control rounded-control px-3 py-2 text-sm"
          :class="{ 'bg-surface shadow-card': group === '' }"
          @click="group = ''"
        >
          全部</button
        ><button
          v-for="(label, key) in categoryGroups"
          :key="key"
          type="button"
          role="tab"
          :aria-selected="group === key"
          class="focus-control rounded-control px-3 py-2 text-sm"
          :class="{ 'bg-surface shadow-card': group === key }"
          @click="group = key"
        >
          {{ label }}
        </button>
      </div>
      <div class="library-search">
        <label for="template-search" class="sr-only">搜尋範本</label
        ><input
          id="template-search"
          v-model="keyword"
          type="search"
          class="field"
          placeholder="搜尋範本名稱、欄位"
        /><label for="template-category" class="sr-only">使用於案件</label
        ><select id="template-category" class="field" :value="requestedCategory" @change="onFilter">
          <option value="">使用於：全部案件</option>
          <option v-for="item in categories.items" :key="item.id" :value="item.id">
            {{ item.name }}
          </option>
        </select>
      </div>
    </div>
    <div v-if="session.canUpload" class="library-upload mb-4">
      <FileDropzone
        compact
        :enabled="true"
        :disabled-reason="disabledReason"
        title="上傳 .docx 到範本庫"
        hint="檔案會存在服務上的範本庫。產生文件時填入的欄位不會被保存。"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        @select="onFiles"
      />
    </div>

    <p class="mb-3 text-xs text-ink-muted" role="status">顯示 {{ visible.length }} 筆</p>

    <EmptyState
      v-if="templates.ready && visible.length === 0 && templates.total === 0"
      title="範本庫還沒有文件"
      description="具有維護權限的使用者上傳 .docx 後，可在案件範本的工作台按「從範本庫選取」連結過來。"
    >
      <RouterLink to="/categories" class="btn-primary"> 前往案件範本 </RouterLink>
    </EmptyState>

    <EmptyState
      v-else-if="templates.ready && visible.length === 0"
      title="沒有符合的範本"
      description="請調整關鍵字或分類，或改看全部範本。"
    >
      <button type="button" class="btn-secondary" @click="showAll">看全部範本</button>
    </EmptyState>

    <p v-else-if="!templates.ready" class="text-sm text-ink-muted">正在讀取範本庫。</p>

    <section
      v-else
      class="template-list overflow-x-auto rounded-card border border-edge bg-surface shadow-card"
      aria-label="範本清單"
    >
      <table class="w-full border-collapse text-left text-sm">
        <thead>
          <tr class="border-b border-edge bg-surface-muted text-xs text-ink-muted">
            <th scope="col" class="px-4 py-3">範本名稱</th>
            <th scope="col" class="px-4 py-3">欄位標記</th>
            <th scope="col" class="px-4 py-3">使用於案件</th>
            <th scope="col" class="px-4 py-3">加入日期</th>
            <th scope="col" class="px-4 py-3">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-edge">
          <tr v-for="item in visible" :key="item.id" class="align-top">
            <td class="template-name max-w-64 px-4 py-4">
              <span class="entry-icon"><AppIcon /></span>
              <div>
                <p class="break-all font-semibold text-ink">{{ displayFileName(item.fileName) }}</p>
                <p class="mt-1 text-xs text-ink-muted">{{ formatBytes(item.sizeBytes) }}</p>
              </div>
            </td>
            <td class="template-fields max-w-48 px-4 py-4 text-xs leading-6 text-ink-muted">
              <template v-if="item.placeholders.length > 0">
                <span
                  v-for="key in item.placeholders"
                  :key="key"
                  class="mr-1 inline-block rounded border border-edge bg-surface-muted px-1.5 font-mono"
                >
                  {{ key }}
                </span>
              </template>
              <span v-else>沒有偵測到欄位</span>
            </td>
            <td class="template-usages max-w-64 px-4 py-4 text-xs leading-5">
              <span v-if="usageLinks(item).length === 0" class="text-ink-muted"
                >尚未被任何步驟使用</span
              >
              <template v-else>
                <RouterLink
                  v-for="link in usageLinks(item)"
                  :key="link.id"
                  :to="`/categories/${link.categoryId}`"
                  class="focus-control mb-1 block text-accent-ink hover:underline"
                >
                  {{ link.label }}
                </RouterLink>
              </template>
              <span
                class="mt-2 inline-flex rounded-pill bg-tone-neutral px-2 py-0.5 text-xs text-tone-neutral-ink"
              >
                關聯 {{ new Set(item.usages.map((u) => u.categoryId)).size }} 個流程
              </span>
            </td>
            <td class="template-date whitespace-nowrap px-4 py-4 text-xs text-ink-muted">
              {{ formatStoredDate(item.addedAt) }}
            </td>
            <td class="template-actions px-4 py-4">
              <div class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="focus-control download-template"
                  :aria-label="`下載 ${displayFileName(item.fileName)}`"
                  @click="downloadTemplate(item)"
                >
                  <AppIcon name="download" />
                </button>
                <button
                  v-if="session.canUpload"
                  type="button"
                  :disabled="replacementBusy"
                  class="btn-secondary px-2.5 py-1.5 text-xs"
                  @click="replacing = replacing === item.id ? '' : item.id"
                >
                  替換
                </button>
                <label v-if="replacing === item.id" class="text-xs text-ink-muted"
                  >選擇新版 .docx<input
                    type="file"
                    accept=".docx"
                    :disabled="replacementBusy"
                    class="block max-w-52"
                    @change="replaceFile"
                /></label>
                <button
                  v-if="session.canDelete"
                  type="button"
                  class="btn-secondary px-2.5 py-1.5 text-xs text-tone-danger-ink"
                  :aria-label="`移除 ${displayFileName(item.fileName)}`"
                  @click="askRemove(item)"
                >
                  移除
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <details class="template-guide mb-4">
      <summary class="focus-control">範本欄位說明</summary>
      <div class="mt-3">
        <PlaceholderGuide />
        <p class="mt-2 text-xs text-stone-600">
          範本欄位寫法：{{ fieldKeyHint
          }}<span v-if="requestedCategory"
            >；可用欄位：{{
              categories
                .byId(requestedCategory)
                ?.fields?.map((f) => f.key)
                .join('、') || '未設定'
            }}</span
          >
        </p>
      </div>
    </details>

    <div
      v-if="pendingDelete"
      class="fixed inset-0 z-50 flex items-center justify-center bg-nav/40 px-4"
      @click.self="pendingDelete = null"
    >
      <div
        class="w-full max-w-md rounded-2xl border border-edge bg-surface p-6 shadow-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-template-title"
      >
        <h2 id="delete-template-title" class="text-base font-semibold text-ink-strong">移除範本</h2>
        <p class="mt-2 text-sm leading-6 text-stone-600">
          <template v-if="usageLinks(pendingDelete).length > 0">
            「{{
              displayFileName(pendingDelete.fileName)
            }}」目前用在下列案件範本的步驟。確定後會解除這些連結，並從範本庫刪除檔案。流程與步驟會保留。
          </template>
          <template v-else>
            「{{
              displayFileName(pendingDelete.fileName)
            }}」尚未連結任何步驟。確定後會從範本庫刪除檔案。
          </template>
        </p>
        <ul v-if="usageLinks(pendingDelete).length > 0" class="mt-3 list-disc space-y-1 pl-5">
          <li
            v-for="link in usageLinks(pendingDelete)"
            :key="link.id"
            class="text-sm text-stone-800"
          >
            {{ link.label }}
          </li>
        </ul>
        <div class="mt-5 flex flex-wrap gap-3">
          <button type="button" class="btn-primary" :disabled="deleting" @click="confirmRemove">
            確定移除
          </button>
          <button type="button" class="btn-secondary" @click="pendingDelete = null">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>
