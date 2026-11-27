<script setup lang="ts">
import { docxMimeType } from '../../shared/templateUpload'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import AppIcon from '@/components/AppIcon.vue'
import { categoryGroups } from '@/config/app'
import type { CategoryGroup } from '@/types/domain'
import { downloadBytes } from '@/utils/download'
import { previewPdf } from '@/services/pdfPreview'
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
import {
  displayFileName,
  displayTemplateName,
  isPhotoTemplateName,
  photoTemplateLabel,
} from '@/utils/fileName'
import { formatStoredDate } from '@/utils/rocDate'
import { computed, nextTick, onActivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const categories = useCategoryStore()
const templates = useTemplateStore()
const session = useSessionStore()
const keyword = ref('')
const group = ref<CategoryGroup | ''>('')
const groupTabs = ref<HTMLElement | null>(null)
const tabSlider = ref<HTMLElement | null>(null)
const feedback = ref('')
const uploadError = ref('')
const feedbackTone = ref<'ok' | 'warn'>('ok')
const pendingDelete = ref<TemplateSummary | null>(null)
const deleting = ref(false)
const replacing = ref('')
const replacementBusy = ref(false)

function positionTabSlider(animate: boolean) {
  const selected = groupTabs.value?.querySelector<HTMLElement>('[aria-selected="true"]')
  const slider = tabSlider.value
  if (!selected || !slider) return

  slider.style.transition = animate ? '' : 'none'
  slider.style.transform = `translateX(${selected.offsetLeft}px) scaleX(${selected.offsetWidth / 100})`
  slider.style.opacity = '1'
}

function resetTabSlider() {
  positionTabSlider(false)
}

onMounted(() => {
  resetTabSlider()
  window.addEventListener('resize', resetTabSlider)
})
function refreshLibrary() {
  void templates.load({ refresh: true })
}
onMounted(refreshLibrary)
onActivated(refreshLibrary)
onUnmounted(() => window.removeEventListener('resize', resetTabSlider))
watch(group, async () => {
  await nextTick()
  positionTabSlider(true)
})

const disabledReason = '需要可維護流程的權限才能上傳範本。刪除範本只有系統管理員可以操作。'

const categoryOptions = computed(() => {
  const options = new Map(categories.items.map(({ id, name }) => [id, name]))
  for (const item of templates.items) {
    for (const usage of item.usages) {
      if (!options.has(usage.categoryId))
        options.set(usage.categoryId, usage.categoryName || usage.categoryId)
    }
  }
  return options
})

const requestedCategory = computed(() => {
  const raw = route.query.category
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return ''
  return categoryOptions.value.has(value) ? value : ''
})

function categoryNameFor(usage: TemplateSummary['usages'][number]) {
  return categories.byId(usage.categoryId)?.name ?? usage.categoryName
}

const visible = computed(() => {
  const query = keyword.value.trim().toLocaleLowerCase()
  return templates.items.filter(
    (item) =>
      (!requestedCategory.value ||
        item.usages.some((usage) => usage.categoryId === requestedCategory.value)) &&
      (!group.value ||
        item.usages.some((usage) => categories.byId(usage.categoryId)?.group === group.value)) &&
      (!query ||
        [
          displayFileName(item.fileName),
          ...item.placeholders,
          ...item.usages.map(
            (usage) => `${categoryNameFor(usage)} ${usage.stepTitle ?? usage.stepBody}`,
          ),
          photoTemplateLabel(item.fileName) ?? '',
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
    downloadBytes(
      new Uint8Array(bytes),
      displayFileName(item.fileName),
      item.mimeType ?? templateMimeType,
    )
  } catch (cause) {
    feedbackTone.value = 'warn'
    feedback.value = cause instanceof Error ? cause.message : '無法下載範本。'
  }
}

async function previewTemplate(item: TemplateSummary) {
  try {
    await previewPdf(item.id)
  } catch (cause) {
    feedbackTone.value = 'warn'
    feedback.value = cause instanceof Error ? cause.message : '無法預覽 PDF。'
  }
}

function shortenStepLabel(label: string) {
  const step = label.replace(/\s+/g, ' ').trim()
  return step.length > 24 ? `${step.slice(0, 24)}…` : step
}

function groupedUsages(item: TemplateSummary) {
  const groups = new Map<string, { categoryId: string; name: string; steps: string[] }>()
  for (const usage of item.usages) {
    let category = groups.get(usage.categoryId)
    if (!category) {
      category = {
        categoryId: usage.categoryId,
        name: categoryNameFor(usage),
        steps: [],
      }
      groups.set(usage.categoryId, category)
    }
    const step = shortenStepLabel(usage.stepTitle ?? usage.stepBody)
    if (step) category.steps.push(step)
  }
  return [...groups.values()]
}

const usageGroupsByTemplate = computed(() =>
  Object.fromEntries(visible.value.map((item) => [item.id, groupedUsages(item)])),
)

function usageLinks(item: TemplateSummary) {
  return item.usages
    .map((usage) => {
      const categoryName = categoryNameFor(usage)
      const short = shortenStepLabel(usage.stepTitle ?? usage.stepBody)
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
    feedback.value = `已從範本庫移除「${displayTemplateName(item.fileName)}」。`
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
    feedback.value = `已替換範本，${result.linkedCategoryCount} 個關聯案件範本同步使用新版。`
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
  uploadError.value = ''
  feedback.value = ''
  try {
    const result = await templates.addFiles(files)
    if (result.added === 0 && result.skipped > 0 && result.rejected.length === 0) {
      uploadError.value = `範本庫最多 ${templates.limit} 份，沒有再加入。`
      return
    }
    uploadError.value = result.rejected.join('。')
    if (result.added === 0) {
      uploadError.value ||= '沒有可保存的 Word 或 PDF 範本。'
      return
    }
    feedbackTone.value = result.skipped > 0 || result.formatNotice ? 'warn' : 'ok'
    const notes = [`已上傳 ${result.added} 份到範本庫。可在案件範本工作台選取。`]
    if (result.skipped > 0) notes.push(`另有 ${result.skipped} 份因筆數上限未加入。`)
    if (result.formatNotice) notes.push(result.formatNotice)
    feedback.value = notes.join('')
  } catch (cause) {
    uploadError.value = cause instanceof Error ? cause.message : '無法上傳範本。'
  }
}
</script>

<template>
  <div class="templates-page">
    <PageIntro title="範本庫" description="共用 Word 範本，可指定使用的案件範本與步驟。" />

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
        ref="groupTabs"
        class="group-tabs inline-flex gap-1 rounded-control bg-tone-neutral/60 p-1"
        role="tablist"
        aria-label="範本分類"
      >
        <span ref="tabSlider" class="tab-slider" aria-hidden="true"></span>
        <button
          type="button"
          role="tab"
          :aria-selected="group === ''"
          class="focus-control rounded-control px-3 py-2 text-sm"
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
          <option v-for="[id, name] in categoryOptions" :key="id" :value="id">
            {{ name }}
          </option>
        </select>
      </div>
    </div>
    <div v-if="session.canUpload" class="library-upload mb-4">
      <FileDropzone
        compact
        :enabled="true"
        :disabled-reason="disabledReason"
        title="上傳 Word 或 PDF 到範本庫"
        hint="檔案會存在服務上的範本庫。產生文件時填入的欄位不會被保存。"
        :accept="`.pdf,application/pdf,.docx,${docxMimeType}`"
        :error="uploadError"
        @select="onFiles"
      />
    </div>

    <p class="mb-3 text-xs text-ink-muted" role="status">
      顯示
      <span :key="visible.length" class="count-roll tabular-nums">{{ visible.length }}</span> 筆
    </p>

    <EmptyState
      v-if="templates.ready && visible.length === 0 && templates.total === 0"
      class="template-empty"
      title="範本庫還沒有文件"
      description="具有維護權限的使用者上傳 Word 或 PDF 後，可在案件範本的工作台按「從範本庫選取」連結過來。"
    >
      <RouterLink to="/categories" class="btn-primary"> 前往案件範本 </RouterLink>
    </EmptyState>

    <EmptyState
      v-else-if="templates.ready && visible.length === 0"
      class="template-empty"
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
        <TransitionGroup tag="tbody" name="row" class="divide-y divide-edge" appear>
          <tr
            v-for="(item, index) in visible"
            :key="item.id"
            class="align-top"
            :style="{ '--i': index }"
          >
            <td class="template-name max-w-64 px-4 py-4">
              <span class="entry-icon"><AppIcon /></span>
              <div>
                <p class="font-semibold text-ink [overflow-wrap:anywhere]">
                  {{ displayTemplateName(item.fileName) }}
                </p>
                <p
                  v-if="item.usages.length && isPhotoTemplateName(item.fileName)"
                  class="mt-1 text-xs text-ink-muted"
                >
                  此範本可在產生文件時插入照片
                </p>
                <span class="rounded border border-edge px-1.5 text-xs">{{
                  item.kind === 'pdf' ? 'PDF' : 'Word'
                }}</span>
                <p class="mt-1 text-xs text-ink-muted tabular-nums">
                  {{ formatBytes(item.sizeBytes) }}
                </p>
              </div>
            </td>
            <td class="template-fields max-w-48 px-4 py-4 text-xs leading-6 text-ink-muted">
              <span v-if="item.kind === 'pdf'">參考文件</span>
              <template v-else-if="item.placeholders.length > 0">
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
            <td
              class="template-usages max-w-64 px-4 py-4 text-xs leading-5 [overflow-wrap:anywhere]"
            >
              <template v-if="usageGroupsByTemplate[item.id].length === 0">
                <span class="text-ink-muted">尚未使用</span>
                <div v-if="isPhotoTemplateName(item.fileName)" class="mt-1 text-ink-muted">
                  <p>要插入照片，請到案件範本的步驟選用這份範本</p>
                  <RouterLink
                    to="/categories"
                    class="focus-control font-semibold text-accent-ink hover:underline"
                  >
                    前往案件範本
                  </RouterLink>
                </div>
              </template>
              <component
                v-else
                :is="usageGroupsByTemplate[item.id].length >= 3 ? 'details' : 'div'"
              >
                <summary
                  v-if="usageGroupsByTemplate[item.id].length >= 3"
                  class="focus-control text-accent-ink hover:underline"
                >
                  {{ usageGroupsByTemplate[item.id].length }} 個案件
                </summary>
                <ul class="space-y-1" role="list">
                  <li v-for="category in usageGroupsByTemplate[item.id]" :key="category.categoryId">
                    <RouterLink
                      :to="`/categories/${category.categoryId}`"
                      class="focus-control font-semibold text-accent-ink hover:underline"
                    >
                      {{ category.name }}
                    </RouterLink>
                    <p v-if="category.steps.length" class="text-ink-muted">
                      {{ category.steps.join('、') }}
                    </p>
                  </li>
                </ul>
              </component>
            </td>
            <td
              class="template-date whitespace-nowrap px-4 py-4 text-xs text-ink-muted tabular-nums"
            >
              {{ formatStoredDate(item.addedAt) }}
            </td>
            <td class="template-actions px-4 py-4">
              <div class="flex flex-wrap items-center gap-2">
                <button
                  v-if="item.kind === 'pdf'"
                  type="button"
                  class="btn-secondary"
                  @click="previewTemplate(item)"
                >
                  預覽
                </button>
                <button
                  type="button"
                  class="focus-control download-template"
                  :aria-label="`下載 ${displayTemplateName(item.fileName)}`"
                  @click="downloadTemplate(item)"
                >
                  <AppIcon name="download" /><span v-if="item.kind === 'pdf'">下載</span>
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
                  >選擇新版 {{ item.kind === 'pdf' ? '.pdf' : '.docx'
                  }}<input
                    type="file"
                    :accept="item.kind === 'pdf' ? '.pdf,application/pdf' : '.docx'"
                    :disabled="replacementBusy"
                    class="block max-w-52"
                    @change="replaceFile"
                /></label>
                <button
                  v-if="session.canDelete"
                  type="button"
                  class="btn-secondary px-2.5 py-1.5 text-xs text-tone-danger-ink"
                  :aria-label="`移除 ${displayTemplateName(item.fileName)}`"
                  @click="askRemove(item)"
                >
                  移除
                </button>
              </div>
            </td>
          </tr>
        </TransitionGroup>
      </table>
    </section>

    <details class="template-guide mb-4">
      <summary class="focus-control">怎麼寫欄位標記</summary>
      <div class="mt-3">
        <PlaceholderGuide />
        <p v-if="requestedCategory" class="mt-2 text-xs text-stone-600">
          可用欄位：{{
            categories
              .byId(requestedCategory)
              ?.fields?.map((field) => field.key)
              .join('、') || '未設定'
          }}
        </p>
      </div>
    </details>

    <ConfirmDialog
      tone="danger"
      v-if="pendingDelete"
      title="移除範本"
      confirm-label="確定移除"
      :busy="deleting"
      @confirm="confirmRemove"
      @cancel="pendingDelete = null"
    >
      <p class="mt-2 text-sm leading-6 text-stone-600">
        <template v-if="usageLinks(pendingDelete).length > 0">
          「{{
            displayTemplateName(pendingDelete.fileName)
          }}」目前用在下列案件範本的步驟。確定後會解除這些連結，並從範本庫刪除檔案。案件範本與步驟會保留。
        </template>
        <template v-else>
          「{{
            displayTemplateName(pendingDelete.fileName)
          }}」尚未連結任何步驟。確定後會從範本庫刪除檔案。
        </template>
      </p>
      <ul v-if="usageLinks(pendingDelete).length > 0" class="mt-3 list-disc space-y-1 pl-5">
        <li v-for="link in usageLinks(pendingDelete)" :key="link.id" class="text-sm text-stone-800">
          {{ link.label }}
        </li>
      </ul>
    </ConfirmDialog>
  </div>
</template>
