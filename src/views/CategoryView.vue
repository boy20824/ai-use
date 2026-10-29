<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue'
import FileDropzone from '@/components/FileDropzone.vue'
import GeneratePanel from '@/components/GeneratePanel.vue'
import PageIntro from '@/components/PageIntro.vue'
import PlaceholderGuide from '@/components/PlaceholderGuide.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { appName } from '@/config/app'
import { useCategoryStore } from '@/stores/categories'
import { useSessionStore } from '@/stores/session'
import { useTemplateStore } from '@/stores/templates'
import { formatBytes } from '@/utils/format'
import { displayFileName } from '@/utils/fileName'
import { formatStoredDate } from '@/utils/rocDate'
import { templateOriginLabel, templateTone } from '@/utils/status'
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const categories = useCategoryStore()
const templates = useTemplateStore()
const session = useSessionStore()
const feedback = ref('')
const feedbackTone = ref<'ok' | 'warn'>('ok')
const pickerOpen = ref(false)
const pickerQuery = ref('')
const selectedIds = ref<string[]>([])
const linking = ref(false)
const confirmDelete = ref(false)
const deleting = ref(false)

const disabledReason =
  '唯讀檢視只能閱讀步驟與已連結的範本，不能上傳或調整連結。若要變更，請登出後改以類別承辦或系統管理員進入。'

const categoryId = computed(() => {
  const raw = route.params.id
  return (Array.isArray(raw) ? raw[0] : raw) ?? ''
})

const category = computed(() => categories.byId(categoryId.value))
const categoryTemplates = computed(() => templates.forCategory(categoryId.value))
const pickerMatches = computed(() => {
  const query = pickerQuery.value.trim().toLocaleLowerCase()
  if (!query) return templates.items
  return templates.items.filter((item) =>
    displayFileName(item.fileName).toLocaleLowerCase().includes(query),
  )
})

watch(
  category,
  (value) => {
    document.title = value ? `${value.name} · ${appName}` : `找不到類別 · ${appName}`
  },
  { immediate: true },
)

watch(categoryId, () => {
  feedback.value = ''
  pickerOpen.value = false
  confirmDelete.value = false
  selectedIds.value = []
})

function templateName(id: string) {
  const found = templates.items.find((item) => item.id === id)
  return found ? displayFileName(found.fileName) : '已不在範本庫'
}

function openPicker() {
  selectedIds.value = categoryTemplates.value.map((item) => item.id)
  pickerQuery.value = ''
  pickerOpen.value = true
  confirmDelete.value = false
}

function toggleTemplate(id: string, event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  if (target.checked) {
    if (!selectedIds.value.includes(id)) selectedIds.value = [...selectedIds.value, id]
    return
  }
  selectedIds.value = selectedIds.value.filter((item) => item !== id)
}

function moveIds(ids: string[], index: number, delta: number) {
  const nextIndex = index + delta
  if (nextIndex < 0 || nextIndex >= ids.length) return ids
  const next = [...ids]
  const [item] = next.splice(index, 1)
  if (item === undefined) return ids
  next.splice(nextIndex, 0, item)
  return next
}

function moveSelected(index: number, delta: number) {
  selectedIds.value = moveIds(selectedIds.value, index, delta)
}

async function applyLinks() {
  if (!category.value || linking.value) return
  linking.value = true
  feedback.value = ''
  try {
    await templates.setLinks(category.value.id, selectedIds.value)
    await categories.reload()
    pickerOpen.value = false
    feedbackTone.value = 'ok'
    feedback.value = `已更新連結，此類別目前使用 ${selectedIds.value.length} 份範本。`
  } catch (cause) {
    feedbackTone.value = 'warn'
    feedback.value = cause instanceof Error ? cause.message : '無法更新範本連結。'
  } finally {
    linking.value = false
  }
}

async function saveOrder(ids: string[], message: string) {
  if (!category.value) return
  linking.value = true
  feedback.value = ''
  try {
    await templates.setLinks(category.value.id, ids)
    await categories.reload()
    if (pickerOpen.value) selectedIds.value = ids
    feedbackTone.value = 'ok'
    feedback.value = message
  } catch (cause) {
    feedbackTone.value = 'warn'
    feedback.value = cause instanceof Error ? cause.message : '無法更新範本連結。'
  } finally {
    linking.value = false
  }
}

function moveLinked(index: number, delta: number) {
  const ids = moveIds(
    categoryTemplates.value.map((item) => item.id),
    index,
    delta,
  )
  void saveOrder(ids, '已調整範本順序。')
}

function unlink(id: string) {
  const ids = categoryTemplates.value.map((item) => item.id).filter((item) => item !== id)
  void saveOrder(ids, '已取消連結。範本仍留在範本庫。')
}

async function onFiles(files: File[]) {
  if (!category.value || !session.canUpload) return
  const before = new Set(categoryTemplates.value.map((item) => item.id))
  const result = await templates.addFiles(files, category.value.id)
  await categories.reload()
  if (pickerOpen.value) {
    const added = templates
      .forCategory(category.value.id)
      .map((item) => item.id)
      .filter((id) => !before.has(id) && !selectedIds.value.includes(id))
    selectedIds.value = [...selectedIds.value, ...added]
  }
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
  const notes = [`已上傳 ${result.added} 份到範本庫，並連結到這個類別。`]
  if (result.skipped > 0) notes.push(`另有 ${result.skipped} 份因筆數上限未加入。`)
  if (result.rejected.length > 0) notes.push(`${result.rejected.join('。')}。`)
  feedback.value = notes.join('')
}

async function removeCategory() {
  if (!category.value || deleting.value) return
  deleting.value = true
  try {
    await categories.remove(category.value.id)
    await templates.reload()
    await router.push('/categories')
  } catch (cause) {
    feedbackTone.value = 'warn'
    feedback.value = cause instanceof Error ? cause.message : '無法刪除案件類別。'
    deleting.value = false
  }
}
</script>

<template>
  <div v-if="category">
    <RouterLink
      to="/categories"
      class="mb-4 inline-flex text-sm text-stone-600 hover:text-stone-900"
    >
      回到全部類別
    </RouterLink>

    <PageIntro
      :eyebrow="category.code || '案件類別'"
      :title="category.name"
      :description="category.summary || '尚未填寫簡述。'"
    />

    <ul class="mb-4 flex flex-wrap gap-2" aria-label="類別資訊">
      <li class="rounded-full bg-white px-3 py-1 text-xs text-stone-700 ring-1 ring-stone-200">
        {{ category.steps.length }} 個步驟
      </li>
      <li class="rounded-full bg-white px-3 py-1 text-xs text-stone-700 ring-1 ring-stone-200">
        {{ categoryTemplates.length }} 份範本
      </li>
      <li class="rounded-full bg-white px-3 py-1 text-xs text-stone-700 ring-1 ring-stone-200">
        更新
        <time :datetime="category.updatedAt">{{ formatStoredDate(category.updatedAt) }}</time>
      </li>
    </ul>
    <div class="mb-8 flex flex-wrap gap-3">
      <RouterLink
        v-if="session.canEditCategory"
        :to="`/categories/${category.id}/edit`"
        class="inline-flex rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-800 hover:bg-stone-50"
      >
        編輯類別
      </RouterLink>
      <button
        v-if="session.canDeleteCategory"
        type="button"
        class="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-800 hover:bg-stone-50"
        @click="confirmDelete = !confirmDelete"
      >
        刪除類別
      </button>
    </div>

    <div
      v-if="confirmDelete"
      class="mb-8 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-category-title"
    >
      <h2 id="delete-category-title" class="text-base font-semibold text-stone-950">
        刪除「{{ category.name }}」
      </h2>
      <p class="mt-2 text-sm leading-6 text-stone-600">
        只會刪除這個類別，以及它和範本的連結。範本檔仍留在範本庫，其他類別可以繼續使用。
      </p>
      <ul v-if="categoryTemplates.length > 0" class="mt-3 list-disc space-y-1 pl-5">
        <li v-for="item in categoryTemplates" :key="item.id" class="text-sm text-stone-700">
          {{ displayFileName(item.fileName) }}
        </li>
      </ul>
      <p v-else class="mt-3 text-sm text-stone-500">這個類別目前沒有連結範本。</p>
      <div class="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          class="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:bg-stone-300"
          :disabled="deleting"
          @click="removeCategory"
        >
          確定刪除
        </button>
        <button
          type="button"
          class="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-800 hover:bg-stone-50"
          @click="confirmDelete = false"
        >
          取消
        </button>
      </div>
    </div>

    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section class="rounded-2xl border border-stone-200 bg-white px-5 py-5 shadow-sm">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-base font-semibold text-stone-950">填寫步驟</h2>
          <RouterLink
            v-if="session.canEditCategory"
            :to="`/categories/${category.id}/edit`"
            class="text-sm text-orange-800 hover:underline"
          >
            編輯步驟
          </RouterLink>
        </div>
        <p class="mt-1 text-sm leading-6 text-stone-600">依序準備即可。這不是送審流程。</p>
        <p v-if="category.steps.length === 0" class="mt-5 text-sm text-stone-500">
          尚未設定填寫步驟。
        </p>
        <ol v-else class="mt-5">
          <li
            v-for="(step, index) in category.steps"
            :key="`${category.id}-${index}`"
            class="flex gap-4"
          >
            <div class="flex w-8 flex-col items-center">
              <span
                class="flex h-8 w-8 items-center justify-center rounded-full bg-stone-900 text-xs font-semibold text-white"
              >
                {{ index + 1 }}
              </span>
              <span
                v-if="index < category.steps.length - 1"
                class="my-2 w-px flex-1 bg-stone-200"
                aria-hidden="true"
              ></span>
            </div>
            <p class="min-w-0 flex-1 pb-6 text-sm leading-6 whitespace-pre-wrap text-stone-700">
              {{ step }}
            </p>
          </li>
        </ol>
      </section>

      <section class="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-base font-semibold text-stone-950">範本文件</h2>
          <RouterLink to="/templates" class="text-sm text-orange-800 hover:underline">
            範本庫
          </RouterLink>
        </div>
        <p class="mt-2 text-sm leading-6 text-stone-600">
          範本集中存放在範本庫，這個類別只保存連結。同一份範本可以給多個類別使用。請勿在檔名放入個資、密碼或權杖。
        </p>
        <div class="mt-4">
          <PlaceholderGuide />
        </div>
        <div v-if="session.canEditCategory" class="mt-4">
          <button
            type="button"
            class="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-800 hover:bg-stone-50"
            :aria-expanded="pickerOpen"
            aria-controls="template-picker"
            @click="pickerOpen ? (pickerOpen = false) : openPicker()"
          >
            從範本庫選取
          </button>
        </div>

        <div
          v-if="pickerOpen"
          id="template-picker"
          class="mt-4 rounded-2xl border border-stone-200 bg-stone-50 p-4"
        >
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-sm font-semibold text-stone-950">從範本庫選取</h3>
            <button
              type="button"
              class="text-sm text-stone-600 hover:text-stone-900"
              @click="pickerOpen = false"
            >
              關閉
            </button>
          </div>
          <label for="template-picker-search" class="mt-3 block text-xs font-medium text-stone-600">
            搜尋範本
          </label>
          <input
            id="template-picker-search"
            v-model="pickerQuery"
            type="search"
            placeholder="檔名"
            class="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-700"
          />
          <p v-if="templates.items.length === 0" class="mt-3 text-sm text-stone-500">
            範本庫還沒有文件。可先在下方上傳，上傳後會出現在這裡。
          </p>
          <p v-else-if="pickerMatches.length === 0" class="mt-3 text-sm text-stone-500">
            沒有符合的範本。
          </p>
          <ul v-else class="mt-3 max-h-64 space-y-2 overflow-auto">
            <li v-for="item in pickerMatches" :key="item.id">
              <label class="flex items-start gap-2 text-sm text-stone-800">
                <input
                  type="checkbox"
                  class="mt-1"
                  :checked="selectedIds.includes(item.id)"
                  @change="toggleTemplate(item.id, $event)"
                />
                <span>
                  <span class="break-all font-medium">{{ displayFileName(item.fileName) }}</span>
                  <span class="mt-0.5 block text-xs text-stone-500">
                    {{
                      item.placeholders.length > 0 ? item.placeholders.join('、') : '沒有偵測到欄位'
                    }}
                  </span>
                </span>
              </label>
            </li>
          </ul>
          <div class="mt-4">
            <p class="text-xs font-medium text-stone-600">套用順序</p>
            <p v-if="selectedIds.length === 0" class="mt-2 text-sm text-stone-500">尚未選取。</p>
            <ol v-else class="mt-2 space-y-2">
              <li
                v-for="(id, index) in selectedIds"
                :key="id"
                class="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2"
              >
                <span class="min-w-0 break-all text-sm text-stone-800">
                  {{ index + 1 }}. {{ templateName(id) }}
                </span>
                <span class="flex shrink-0 gap-2">
                  <button
                    type="button"
                    class="text-sm text-stone-600 hover:text-stone-900 disabled:text-stone-300"
                    :disabled="index === 0"
                    @click="moveSelected(index, -1)"
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    class="text-sm text-stone-600 hover:text-stone-900 disabled:text-stone-300"
                    :disabled="index === selectedIds.length - 1"
                    @click="moveSelected(index, 1)"
                  >
                    下移
                  </button>
                </span>
              </li>
            </ol>
          </div>
          <button
            type="button"
            class="mt-4 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:bg-stone-300"
            :disabled="linking"
            @click="applyLinks"
          >
            套用連結
          </button>
        </div>

        <div class="mt-4">
          <FileDropzone
            :enabled="session.canUpload"
            :disabled-reason="disabledReason"
            title="將 .docx 範本拖到這裡，或選擇檔案"
            hint="上傳後會存進範本庫，並連結到這個類別。其他類別也可以再選用同一份。"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            @select="onFiles"
          />
        </div>
        <p
          v-if="feedback"
          class="mt-3 rounded-xl px-3 py-2 text-sm leading-6"
          :class="
            feedbackTone === 'ok' ? 'bg-emerald-50 text-emerald-950' : 'bg-amber-50 text-amber-950'
          "
          role="status"
        >
          {{ feedback }}
        </p>
        <p v-if="templates.error" class="mt-3 text-sm text-rose-800" role="alert">
          {{ templates.error }}
        </p>
        <p v-if="categoryTemplates.length === 0" class="mt-4 text-sm text-stone-500">
          這個類別還沒有連結範本。從範本庫選取，或上傳 .docx。
        </p>
        <ol v-else class="mt-4 divide-y divide-stone-200">
          <li
            v-for="(item, index) in categoryTemplates"
            :key="item.id"
            class="flex items-start justify-between gap-3 py-3"
          >
            <span class="min-w-0">
              <span class="block break-all text-sm font-medium text-stone-900">
                {{ index + 1 }}. {{ displayFileName(item.fileName) }}
              </span>
              <span class="mt-1 block text-xs leading-5 text-stone-500">
                {{ formatBytes(item.sizeBytes) }} · {{ formatStoredDate(item.addedAt) }}
              </span>
              <span class="mt-1 block text-xs leading-5 text-stone-500">
                {{ item.placeholders.length > 0 ? item.placeholders.join('、') : '沒有偵測到欄位' }}
              </span>
              <span class="mt-2 inline-flex">
                <StatusBadge
                  :label="templateOriginLabel(item.origin)"
                  :tone="templateTone(item.origin)"
                />
              </span>
            </span>
            <span v-if="session.canEditCategory" class="flex shrink-0 flex-col items-end gap-1">
              <button
                type="button"
                class="text-sm text-stone-600 hover:text-stone-900 disabled:text-stone-300"
                :disabled="linking || index === 0"
                @click="moveLinked(index, -1)"
              >
                上移
              </button>
              <button
                type="button"
                class="text-sm text-stone-600 hover:text-stone-900 disabled:text-stone-300"
                :disabled="linking || index === categoryTemplates.length - 1"
                @click="moveLinked(index, 1)"
              >
                下移
              </button>
              <button
                type="button"
                class="text-sm text-stone-600 hover:text-rose-800"
                :disabled="linking"
                :aria-label="`取消連結 ${displayFileName(item.fileName)}`"
                @click="unlink(item.id)"
              >
                取消連結
              </button>
            </span>
          </li>
        </ol>
      </section>
    </div>

    <div class="mt-6">
      <GeneratePanel
        :key="category.id"
        :category-id="category.id"
        :category-code="category.code"
        :category-name="category.name"
      />
    </div>
  </div>

  <div v-else-if="!categories.ready">
    <p class="text-sm text-stone-500">正在讀取案件類別。</p>
  </div>

  <div v-else>
    <PageIntro
      eyebrow="案件類別"
      title="找不到這個類別"
      description="這個類別不存在，或已經刪除。請回到列表重新選擇。"
    />
    <EmptyState title="沒有對應的工作台" description="類別可能已刪除，或連結不完整。">
      <RouterLink
        to="/categories"
        class="inline-flex rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
      >
        回到案件類別
      </RouterLink>
    </EmptyState>
  </div>
</template>
