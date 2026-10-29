<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue'
import PageIntro from '@/components/PageIntro.vue'
import RocDateField from '@/components/RocDateField.vue'
import { appName } from '@/config/app'
import { renderDocx, templateMimeType, zipGeneratedFiles } from '@/services/docxTemplates'
import { useCategoryStore } from '@/stores/categories'
import { useSessionStore } from '@/stores/session'
import { useTemplateStore } from '@/stores/templates'
import type { CategoryStep } from '@/types/domain'
import { downloadBlob, downloadBytes } from '@/utils/download'
import { displayFileName } from '@/utils/fileName'
import { applyRocDateFields, parseRocDate } from '@/utils/rocDate'
import {
  checkedTemplates,
  dedupedIds,
  inputFields,
  missingOverviewFields,
  overviewCatalog,
  overviewDownloadName,
  valuesForFields,
} from '@/workbench/overview'
import { computed, onUnmounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, RouterLink, useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const categories = useCategoryStore()
const templates = useTemplateStore()
const session = useSessionStore()
const values = ref<Record<string, string>>({})
const done = ref<Record<string, boolean>>({})
const busy = ref(false)
const message = ref('')
const messageTone = ref<'ok' | 'warn'>('ok')
const messageStepId = ref('')
const confirmDelete = ref(false)
const deleting = ref(false)
const tab = ref<'steps' | 'overview'>('steps')
const temporaryIds = ref<string[]>([])
const unchecked = ref<Record<string, boolean>>({})
const pickerOpen = ref(false)
const pickerQuery = ref('')
const overviewMessage = ref('')
const overviewTone = ref<'ok' | 'warn'>('ok')

const categoryId = computed(() => {
  const raw = route.params.id
  return (Array.isArray(raw) ? raw[0] : raw) ?? ''
})
const category = computed(() => categories.byId(categoryId.value))

const linkedTemplates = computed(() => {
  const ids = category.value?.steps.flatMap((step) => step.templateIds) ?? []
  const seen = new Set<string>()
  return ids
    .filter((id) => {
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    .map((id) => templates.byId(id))
    .filter((item) => item !== undefined)
})

function fieldPlaceholder(name: string) {
  if (name === '姓名') return '請輸入姓名'
  return `請輸入${name}`
}

const fieldNames = computed(() => {
  const names = ['姓名', '日期']
  const seen = new Set(names)
  for (const template of linkedTemplates.value) {
    for (const placeholder of template.placeholders) {
      if (seen.has(placeholder) || placeholder === '日期_民國') continue
      seen.add(placeholder)
      names.push(placeholder)
    }
  }
  return names
})

const missingFields = computed(() => {
  const missing: string[] = []
  for (const name of fieldNames.value) {
    const raw = (values.value[name] ?? '').trim()
    if (!raw) {
      missing.push(name)
      continue
    }
    if (name === '日期' && !parseRocDate(raw)) missing.push('日期格式')
  }
  return missing
})

const canGenerate = computed(() => missingFields.value.length === 0 && !busy.value)
const generateHint = computed(() => {
  if (missingFields.value.includes('日期格式')) return '日期不是有效的民國日期。'
  if (missingFields.value.length === 0) return ''
  return `請先在基本資料填寫：${missingFields.value.join('、')}。`
})

const dateToken = '{{日期}}'
const dateSlashToken = '{{日期_民國}}'

const dateValue = computed({
  get: () => values.value['日期'] ?? '',
  set: (value: string) => {
    values.value = { ...values.value, 日期: value }
  },
})

watch(
  category,
  (value) => {
    document.title = value ? `${value.name} · ${appName}` : `找不到類別 · ${appName}`
  },
  { immediate: true },
)

watch(categoryId, () => {
  clearDraft()
  confirmDelete.value = false
})

watch(
  () => session.authenticated,
  (signedIn) => {
    if (!signedIn) clearDraft()
  },
)

function clearDraft() {
  values.value = {}
  done.value = {}
  message.value = ''
  messageStepId.value = ''
  tab.value = 'steps'
  temporaryIds.value = []
  unchecked.value = {}
  pickerOpen.value = false
  pickerQuery.value = ''
  overviewMessage.value = ''
}

function fieldValue(name: string) {
  return values.value[name] ?? ''
}

function onFieldInput(name: string, event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  values.value = { ...values.value, [name]: target.value }
}

function templatesFor(step: CategoryStep) {
  return step.templateIds.map((id) => templates.byId(id)).filter((item) => item !== undefined)
}

function toggleDone(id: string, event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  done.value = { ...done.value, [id]: target.checked }
}

async function renderOne(id: string) {
  const filled = applyRocDateFields(values.value)
  if (!filled) throw new Error('invalid-date')
  const template = templates.byId(id)
  const bytes = await templates.bytesFor(id)
  if (!template || !bytes) throw new Error('missing-template')
  return {
    name: `產生-${displayFileName(template.fileName)}`,
    data: renderDocx(bytes, filled),
  }
}

async function produceOne(stepId: string, templateId: string) {
  if (!canGenerate.value) return
  busy.value = true
  message.value = ''
  messageStepId.value = stepId
  try {
    const rendered = await renderOne(templateId)
    downloadBytes(rendered.data, rendered.name, templateMimeType)
    messageTone.value = 'ok'
    message.value = `已下載「${rendered.name}」。填寫內容沒有被保存。`
  } catch (error) {
    messageTone.value = 'warn'
    message.value =
      error instanceof Error && error.message === 'invalid-date'
        ? '日期不是有效的民國日期。'
        : '無法產生這份文件。請確認範本裡的欄位寫成雙大括號，且括號在同一段文字中。'
  } finally {
    busy.value = false
  }
}

async function produceStep(stepId: string, templateIds: string[], index: number) {
  if (!canGenerate.value || !category.value || templateIds.length === 0) return
  busy.value = true
  message.value = ''
  messageStepId.value = stepId
  const rendered: { name: string; data: Uint8Array }[] = []
  const failed: string[] = []
  for (const templateId of templateIds) {
    try {
      rendered.push(await renderOne(templateId))
    } catch {
      const template = templates.byId(templateId)
      failed.push(template ? displayFileName(template.fileName) : '範本')
    }
  }
  try {
    if (rendered.length === 0) {
      messageTone.value = 'warn'
      message.value = '沒有可以下載的文件。請確認日期有效，且範本欄位寫成雙大括號。'
      return
    }
    const base = (category.value.code || category.value.name || '範本').replace(
      /[\\/:*?"<>|]/g,
      '_',
    )
    const zip = await zipGeneratedFiles(rendered)
    downloadBlob(zip, `${base}-步驟${index + 2}.zip`)
    messageTone.value = failed.length > 0 ? 'warn' : 'ok'
    message.value =
      failed.length > 0
        ? `已下載 ${rendered.length} 份文件。無法產生：${failed.join('、')}。填寫內容沒有被保存。`
        : `已下載 ${rendered.length} 份文件。填寫內容沒有被保存。`
  } finally {
    busy.value = false
  }
}

const categoryTemplateIds = computed(() => dedupedIds(category.value?.steps ?? []))

const overviewList = computed(() =>
  overviewCatalog(categoryTemplateIds.value, temporaryIds.value, (id) => {
    const item = templates.byId(id)
    if (!item) return undefined
    return { id: item.id, fileName: item.fileName, placeholders: item.placeholders }
  }),
)

const checkedOverview = computed(() => checkedTemplates(overviewList.value, unchecked.value))
const overviewFields = computed(() => inputFields(checkedOverview.value))
const overviewMissing = computed(() => missingOverviewFields(overviewFields.value, values.value))
const canGenerateOverview = computed(
  () => checkedOverview.value.length > 0 && overviewMissing.value.length === 0 && !busy.value,
)
const overviewHint = computed(() => {
  if (checkedOverview.value.length === 0) return '請勾選至少一份文件。'
  if (overviewMissing.value.includes('日期格式')) return '日期不是有效的民國日期。'
  if (overviewMissing.value.length === 0) return ''
  return `請先填寫：${overviewMissing.value.join('、')}。`
})

const additionChoices = computed(() => {
  const linked = new Set(categoryTemplateIds.value)
  const query = pickerQuery.value.trim().toLocaleLowerCase()
  return templates.items.filter((item) => {
    if (linked.has(item.id)) return false
    if (!query) return true
    return displayFileName(item.fileName).toLocaleLowerCase().includes(query)
  })
})

function isTemporary(id: string) {
  return temporaryIds.value.includes(id) && !categoryTemplateIds.value.includes(id)
}

function toggleOverview(id: string, event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  unchecked.value = { ...unchecked.value, [id]: !target.checked }
}

function toggleTemporary(id: string, event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  if (categoryTemplateIds.value.includes(id)) return
  if (target.checked) {
    if (!temporaryIds.value.includes(id)) temporaryIds.value = [...temporaryIds.value, id]
    if (unchecked.value[id]) {
      const next = { ...unchecked.value }
      delete next[id]
      unchecked.value = next
    }
    return
  }
  temporaryIds.value = temporaryIds.value.filter((item) => item !== id)
  if (!unchecked.value[id]) return
  const next = { ...unchecked.value }
  delete next[id]
  unchecked.value = next
}

function onPickerQuery(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  pickerQuery.value = target.value
}

async function produceChecked() {
  if (!canGenerateOverview.value || !category.value) return
  busy.value = true
  overviewMessage.value = ''
  const selected = checkedOverview.value
  const filled = applyRocDateFields(valuesForFields(values.value, overviewFields.value))
  if (!filled) {
    overviewTone.value = 'warn'
    overviewMessage.value = '日期不是有效的民國日期。'
    busy.value = false
    return
  }
  const rendered: { name: string; data: Uint8Array }[] = []
  const failed: string[] = []
  for (const template of selected) {
    try {
      const bytes = await templates.bytesFor(template.id)
      if (!bytes) throw new Error('missing-template')
      rendered.push({
        name: overviewDownloadName(template.fileName),
        data: renderDocx(bytes, filled),
      })
    } catch {
      failed.push(displayFileName(template.fileName))
    }
  }
  try {
    if (rendered.length === 0) {
      overviewTone.value = 'warn'
      overviewMessage.value = '沒有可以下載的文件。請確認日期有效，且範本欄位寫成雙大括號。'
      return
    }
    const base = (category.value.code || category.value.name || '範本').replace(
      /[\\/:*?"<>|]/g,
      '_',
    )
    const zip = await zipGeneratedFiles(rendered)
    downloadBlob(zip, `${base}-勾選文件.zip`)
    overviewTone.value = failed.length > 0 ? 'warn' : 'ok'
    overviewMessage.value =
      failed.length > 0
        ? `已下載 ${rendered.length} 份文件。無法產生：${failed.join('、')}。填寫內容沒有被保存。`
        : `已下載 ${rendered.length} 份文件。填寫內容沒有被保存。`
  } finally {
    busy.value = false
  }
}

async function removeCategory() {
  if (!category.value || deleting.value) return
  deleting.value = true
  try {
    clearDraft()
    await categories.remove(category.value.id)
    await templates.reload()
    await router.push('/categories')
  } catch (cause) {
    messageTone.value = 'warn'
    message.value = cause instanceof Error ? cause.message : '無法刪除案件類別。'
    deleting.value = false
  }
}

onBeforeRouteLeave(() => {
  clearDraft()
})

onUnmounted(clearDraft)
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
      eyebrow="各類案件流程"
      :title="category.name"
      :description="
        category.summary || '依步驟準備。第一步填基本資料，之後每個步驟產生自己連結的範本。'
      "
    />

    <ul class="mb-4 flex flex-wrap gap-2" aria-label="類別資訊">
      <li class="rounded-full bg-white px-3 py-1 text-xs text-stone-700 ring-1 ring-stone-200">
        {{ category.code || '未設代號' }}
      </li>
      <li class="rounded-full bg-white px-3 py-1 text-xs text-stone-700 ring-1 ring-stone-200">
        {{ category.steps.length }} 個填寫步驟
      </li>
      <li class="rounded-full bg-white px-3 py-1 text-xs text-stone-700 ring-1 ring-stone-200">
        {{ category.templateCount }} 份範本
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
        只會刪除這個類別、它的步驟，以及步驟和範本的連結。範本檔仍留在範本庫。
      </p>
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

    <div class="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="工作台檢視">
      <button
        id="tab-steps"
        type="button"
        role="tab"
        aria-controls="panel-steps"
        :aria-selected="tab === 'steps'"
        class="rounded-xl px-4 py-2.5 text-sm font-medium"
        :class="
          tab === 'steps'
            ? 'bg-stone-900 text-white'
            : 'bg-white text-stone-700 ring-1 ring-stone-200'
        "
        @click="tab = 'steps'"
      >
        填寫步驟
      </button>
      <button
        id="tab-overview"
        type="button"
        role="tab"
        aria-controls="panel-overview"
        :aria-selected="tab === 'overview'"
        class="rounded-xl px-4 py-2.5 text-sm font-medium"
        :class="
          tab === 'overview'
            ? 'bg-stone-900 text-white'
            : 'bg-white text-stone-700 ring-1 ring-stone-200'
        "
        @click="tab = 'overview'"
      >
        全部文件總覽
      </button>
    </div>

    <section
      v-if="tab === 'steps'"
      id="panel-steps"
      role="tabpanel"
      aria-labelledby="tab-steps"
      class="rounded-2xl border border-stone-200 bg-white px-5 py-5 shadow-sm"
    >
      <h2 class="text-base font-semibold text-stone-950">填寫步驟</h2>
      <p class="mt-1 text-sm leading-6 text-stone-600">
        基本資料的欄位只留在這個畫面。離開這個類別或登出後會清除，也不會送到服務。
      </p>
      <ol class="mt-6">
        <li class="flex gap-4">
          <div class="flex w-8 flex-col items-center">
            <span
              class="flex h-8 w-8 items-center justify-center rounded-full bg-stone-900 text-xs font-semibold text-white"
            >
              1
            </span>
            <span class="my-2 w-px flex-1 bg-stone-200" aria-hidden="true"></span>
          </div>
          <div class="min-w-0 flex-1 pb-8">
            <h3 class="text-sm font-semibold text-stone-900">基本資料</h3>
            <p class="mt-1 text-sm leading-6 text-stone-600">
              姓名與日期會套進這個類別各步驟的範本。日期用民國年，{{ dateToken }} 會寫成
              115年10月29日，{{ dateSlashToken }} 會寫成 115/10/29。
            </p>
            <div class="mt-4 grid max-w-xl gap-4">
              <div v-for="(name, index) in fieldNames" :key="name">
                <label class="block text-sm font-medium text-stone-800" :for="`draft-${index}`">
                  {{ name }}
                </label>
                <RocDateField v-if="name === '日期'" v-model="dateValue" />
                <input
                  v-else
                  :id="`draft-${index}`"
                  :value="fieldValue(name)"
                  type="text"
                  autocomplete="off"
                  :placeholder="fieldPlaceholder(name)"
                  class="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-700"
                  @input="onFieldInput(name, $event)"
                />
              </div>
            </div>
          </div>
        </li>

        <li v-if="category.steps.length === 0" class="flex gap-4">
          <div class="flex w-8 flex-col items-center">
            <span
              class="flex h-8 w-8 items-center justify-center rounded-full bg-stone-200 text-xs font-semibold text-stone-700"
            >
              2
            </span>
          </div>
          <p class="pb-2 text-sm leading-6 text-stone-500">尚未設定後續步驟。</p>
        </li>

        <li v-for="(step, index) in category.steps" :key="step.id" class="flex gap-4">
          <div class="flex w-8 flex-col items-center">
            <span
              class="flex h-8 w-8 items-center justify-center rounded-full bg-stone-900 text-xs font-semibold text-white"
            >
              {{ index + 2 }}
            </span>
            <span
              v-if="index < category.steps.length - 1"
              class="my-2 w-px flex-1 bg-stone-200"
              aria-hidden="true"
            ></span>
          </div>
          <div class="min-w-0 flex-1 pb-8">
            <h3 class="text-sm font-semibold text-stone-900 whitespace-pre-wrap">
              {{ step.body }}
            </h3>
            <label class="mt-3 inline-flex items-center gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                :checked="done[step.id] === true"
                @change="toggleDone(step.id, $event)"
              />
              本步驟已完成
            </label>
            <p v-if="templatesFor(step).length === 0" class="mt-3 text-sm text-stone-500">
              這個步驟還沒有範本。
            </p>
            <div v-else class="mt-4">
              <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p v-if="!canGenerate" class="text-sm text-amber-900">{{ generateHint }}</p>
                <button
                  v-if="templatesFor(step).length > 1"
                  type="button"
                  class="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
                  :disabled="!canGenerate"
                  @click="produceStep(step.id, step.templateIds, index)"
                >
                  產生本步驟全部
                </button>
              </div>
              <ul class="divide-y divide-stone-200 rounded-2xl border border-stone-200">
                <li
                  v-for="item in templatesFor(step)"
                  :key="item.id"
                  class="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <span class="min-w-0">
                    <span class="block break-all text-sm font-medium text-stone-900">{{
                      displayFileName(item.fileName)
                    }}</span>
                    <span class="mt-1 block text-xs text-stone-500">
                      {{
                        item.placeholders.length > 0
                          ? item.placeholders.join('、')
                          : '沒有偵測到欄位'
                      }}
                    </span>
                  </span>
                  <button
                    type="button"
                    class="shrink-0 rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 hover:bg-stone-50 disabled:cursor-not-allowed disabled:text-stone-400"
                    :disabled="!canGenerate"
                    @click="produceOne(step.id, item.id)"
                  >
                    產生
                  </button>
                </li>
              </ul>
            </div>
            <p
              v-if="message && messageStepId === step.id"
              class="mt-3 rounded-xl px-3 py-2 text-sm leading-6"
              :class="
                messageTone === 'ok'
                  ? 'bg-emerald-50 text-emerald-950'
                  : 'bg-amber-50 text-amber-950'
              "
              role="status"
            >
              {{ message }}
            </p>
          </div>
        </li>
      </ol>
    </section>

    <section
      v-else
      id="panel-overview"
      role="tabpanel"
      aria-labelledby="tab-overview"
      class="rounded-2xl border border-stone-200 bg-white px-5 py-5 shadow-sm"
    >
      <h2 class="text-base font-semibold text-stone-950">全部文件總覽</h2>
      <p class="mt-1 text-sm leading-6 text-stone-600">
        列出這個類別各步驟的範本，同一份只出現一次，預設全部勾選。取消勾選，或從範本庫暫時加入其他範本，只影響這次產生，不會改動類別設定。欄位與填寫步驟的基本資料共用，離開這個類別或登出後清除，也不會送到服務。
      </p>

      <div class="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div>
          <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 class="text-sm font-semibold text-stone-900">文件</h3>
            <button
              type="button"
              class="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-800 hover:bg-stone-50"
              :aria-expanded="pickerOpen"
              @click="pickerOpen = !pickerOpen"
            >
              從範本庫選取
            </button>
          </div>
          <p v-if="overviewList.length === 0" class="text-sm text-stone-500">
            這個類別還沒有範本。可從範本庫暫時加入。
          </p>
          <ul v-else class="divide-y divide-stone-200 rounded-2xl border border-stone-200">
            <li v-for="item in overviewList" :key="item.id" class="px-4 py-3">
              <label class="flex items-start gap-3 text-sm text-stone-800">
                <input
                  type="checkbox"
                  class="mt-1"
                  :checked="unchecked[item.id] !== true"
                  @change="toggleOverview(item.id, $event)"
                />
                <span class="min-w-0">
                  <span class="block break-all font-medium text-stone-900">
                    {{ displayFileName(item.fileName) }}
                    <span
                      v-if="isTemporary(item.id)"
                      class="ml-2 text-xs font-normal text-orange-800"
                    >
                      本次暫加
                    </span>
                  </span>
                  <span class="mt-1 block text-xs text-stone-500">
                    {{
                      item.placeholders.length > 0 ? item.placeholders.join('、') : '沒有偵測到欄位'
                    }}
                  </span>
                </span>
              </label>
            </li>
          </ul>

          <div v-if="pickerOpen" class="mt-3 rounded-2xl border border-stone-200 bg-stone-50 p-4">
            <label class="block text-xs font-medium text-stone-600" for="overview-picker">
              搜尋範本
            </label>
            <input
              id="overview-picker"
              :value="pickerQuery"
              type="search"
              placeholder="請輸入檔名"
              class="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-700"
              @input="onPickerQuery"
            />
            <p class="mt-2 text-xs leading-5 text-stone-500">
              這裡勾選的範本只加進這次清單，不會寫進類別或步驟。
            </p>
            <p v-if="templates.items.length === 0" class="mt-3 text-sm text-stone-500">
              範本庫還沒有文件。
            </p>
            <p v-else-if="additionChoices.length === 0" class="mt-3 text-sm text-stone-500">
              沒有其他可加入的範本。
            </p>
            <ul v-else class="mt-3 max-h-48 space-y-2 overflow-auto">
              <li v-for="item in additionChoices" :key="item.id">
                <label class="flex items-start gap-2 text-sm text-stone-800">
                  <input
                    type="checkbox"
                    class="mt-1"
                    :checked="temporaryIds.includes(item.id)"
                    @change="toggleTemporary(item.id, $event)"
                  />
                  <span class="break-all">{{ displayFileName(item.fileName) }}</span>
                </label>
              </li>
            </ul>
          </div>
        </div>

        <div>
          <h3 class="text-sm font-semibold text-stone-900">基本資料</h3>
          <p class="mt-1 text-sm leading-6 text-stone-600">
            已勾選範本裡的每個欄位只出現一次。日期用民國年，{{ dateToken }} 會寫成 115年10月29日，{{
              dateSlashToken
            }}
            會寫成 115/10/29。
          </p>
          <p v-if="overviewFields.length === 0" class="mt-4 text-sm text-stone-500">
            勾選文件後，這裡會列出要填的欄位。
          </p>
          <div v-else class="mt-4 grid gap-4">
            <div v-for="(name, index) in overviewFields" :key="name">
              <label class="block text-sm font-medium text-stone-800" :for="`overview-${index}`">
                {{ name }}
              </label>
              <RocDateField v-if="name === '日期'" v-model="dateValue" />
              <input
                v-else
                :id="`overview-${index}`"
                :value="fieldValue(name)"
                type="text"
                autocomplete="off"
                :placeholder="fieldPlaceholder(name)"
                class="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-700"
                @input="onFieldInput(name, $event)"
              />
            </div>
          </div>
          <div class="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              class="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
              :disabled="!canGenerateOverview"
              @click="produceChecked"
            >
              產生勾選文件
            </button>
            <p v-if="!canGenerateOverview && overviewHint" class="text-sm text-amber-900">
              {{ overviewHint }}
            </p>
          </div>
          <p
            v-if="overviewMessage"
            class="mt-3 rounded-xl px-3 py-2 text-sm leading-6"
            :class="
              overviewTone === 'ok'
                ? 'bg-emerald-50 text-emerald-950'
                : 'bg-amber-50 text-amber-950'
            "
            role="status"
          >
            {{ overviewMessage }}
          </p>
        </div>
      </div>
    </section>
  </div>

  <div v-else-if="!categories.ready">
    <p class="text-sm text-stone-500">正在讀取案件類別。</p>
  </div>

  <div v-else>
    <PageIntro
      eyebrow="各類案件流程"
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
