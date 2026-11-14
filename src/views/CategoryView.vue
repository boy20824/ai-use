<script setup lang="ts">
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { fieldMappingIssues } from '@/workbench/fieldMapping'
import StepFields from '@/components/StepFields.vue'
import StepDateField from '@/components/StepDateField.vue'
import ReferenceDocuments from '@/components/ReferenceDocuments.vue'
import WorkbenchStepFields from '@/components/WorkbenchStepFields.vue'
import PhotoBlockFields from '@/components/PhotoBlockFields.vue'
import { readPhotoBlock } from '../../server/src/docxXml'
import {
  renderTemplatePhotos,
  type PhotoDraft,
  type PhotoDrafts,
} from '../../shared/photoBlockRender'
import { defaultRocDateSlash, parseRocDate } from '@/utils/rocDate'
import AppIcon from '@/components/AppIcon.vue'
import { parallelSteps } from '@/workbench/parallel'
import {
  contextKey,
  generationContexts,
  sharedFieldNames,
  sharedFieldLabels,
  localFieldNames,
  scopeKey,
  missingContextFields,
  filledContext,
  type GenerationContext,
} from '@/workbench/stepFields'
import EmptyState from '@/components/EmptyState.vue'
import PageIntro from '@/components/PageIntro.vue'
import PlaceholderGuide from '@/components/PlaceholderGuide.vue'
import RocDateField from '@/components/RocDateField.vue'
import { appName, categoryGroups } from '@/config/app'
import { renderDocx, templateMimeType, zipGeneratedFiles } from '@/services/docxTemplates'
import { useCategoryStore } from '@/stores/categories'
import { useSessionStore } from '@/stores/session'
import { useTemplateStore } from '@/stores/templates'
import type { CategoryStep } from '@/types/domain'
import { downloadBlob, downloadBytes } from '@/utils/download'
import { displayFileName } from '@/utils/fileName'
import { composeSteps } from '@/workbench/compose'
import { applyFieldDefaults } from '@/config/fieldDefaults'
import { initialDraftValues } from '@/workbench/draft'
import {
  checkedTemplates,
  dedupedIds,
  inputFields,
  missingOverviewFields,
} from '@/workbench/overview'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  RouterLink,
  useRoute,
  useRouter,
} from 'vue-router'

const props = defineProps<{ selectedId?: string; embedded?: boolean }>()

const fieldKeyHint = '{{欄位鍵}}'

const route = useRoute()
const router = useRouter()
const categories = useCategoryStore()
const templates = useTemplateStore()
const session = useSessionStore()
const workbench = ref<HTMLElement | null>(null)
const values = ref<Record<string, string>>(initialDraftValues())
const emptyValues = ref({ ...values.value })
const stepDateOverrides = ref<Record<string, string>>({})
const defaultedFields = new Set<string>()
const draftGeneration = ref(0)
const photoDrafts = ref<PhotoDrafts>({})
const photoCells = ref<Record<string, number>>({})
const photoProcessing = ref(new Set<symbol>())
function setPhotoProcessing(id: symbol, active: boolean) {
  if (active) photoProcessing.value.add(id)
  else photoProcessing.value.delete(id)
}
let photoMetadataLoading: Promise<void> = Promise.resolve()
let photoRevision = 0
function setPhotoDraft(id: string, draft: PhotoDraft) {
  photoDrafts.value = { ...photoDrafts.value, [id]: draft }
}
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
const completedSteps = ref<string[]>([])
let draftVersion = 0

const categoryId = computed(() => {
  if (props.selectedId) return props.selectedId
  const raw = route.params.id
  return (Array.isArray(raw) ? raw[0] : raw) ?? ''
})
const category = computed(() => categories.byId(categoryId.value))
const selectedVariants = ref<string[]>([])
const visibleSteps = computed(() =>
  category.value ? composeSteps(category.value, selectedVariants.value) : [],
)
const parallelWork = computed(() => parallelSteps(visibleSteps.value))
const handledSteps = ref<string[]>([])
const handledCount = computed(
  () => parallelWork.value.filter((step) => handledSteps.value.includes(step.id)).length,
)
const parallelRegion = ref<HTMLElement | null>(null)
function focusParallelWork() {
  parallelRegion.value?.scrollIntoView({ block: 'nearest' })
  parallelRegion.value?.focus({ preventScroll: true })
}
watch(
  visibleSteps,
  (steps) => {
    const active = new Set(steps.map((step) => step.id))
    handledSteps.value = handledSteps.value.filter((id) => active.has(id))
    completedSteps.value = completedSteps.value.filter((id) => active.has(id))
  },
  { flush: 'sync' },
)
watch(
  selectedVariants,
  () => {
    draftVersion++
    busy.value = false
    message.value = ''
    overviewMessage.value = ''
  },
  { deep: true, flush: 'sync' },
)
const printStep = ref<CategoryStep | null>(null)
async function printSop(step: CategoryStep) {
  printStep.value = step
  await nextTick()
  window.print()
  printStep.value = null
}
function fieldType(key: string) {
  return category.value?.fields?.find((f) => f.key === key)?.type ?? 'text'
}
function fieldLabel(key: string) {
  return category.value?.fields?.find((f) => f.key === key)?.name ?? key
}

function fieldPlaceholder(name: string) {
  if (name === '姓名') return '請輸入姓名'
  return `請輸入${name}`
}

const contexts = computed(() =>
  generationContexts(visibleSteps.value, [], (id) => templates.byId(id)),
)
const mappingIssues = computed(() =>
  category.value
    ? fieldMappingIssues(
        (category.value.fields ?? []).filter((field) => field.scope !== 'base'),
        generationContexts(category.value.steps, [], (id) => templates.byId(id)),
      )
    : [],
)
const fieldNames = computed(() => (category.value ? sharedFieldNames(category.value) : []))
const sharedLabels = computed(() => sharedFieldLabels(visibleSteps.value, contexts.value))
function contextsFor(stepId: string) {
  return contexts.value.filter((context) => context.stepId === stepId)
}
function localFields(stepId: string) {
  return localFieldNames(contextsFor(stepId), fieldNames.value)
}
function setField(key: string, value: string) {
  values.value[key] = value
}
function setStepDateOverride(stepId: string, value: string | undefined) {
  if (value === undefined) delete stepDateOverrides.value[stepId]
  else stepDateOverrides.value[stepId] = value
}
function stepMissing(stepId: string) {
  return missingContextFields(contextsFor(stepId), values.value, stepDateOverrides.value)
}
async function focusField(key: string, stepId?: string) {
  const name = key === '日期格式' ? '日期' : key
  const overrideStep = name === '日期' && stepId && Object.hasOwn(stepDateOverrides.value, stepId)
  // Switch to the first workflow occurrence even when called from the overview/sidebar.
  const inBase = fieldNames.value.includes(name)
  const step = visibleSteps.value.find((step) => localFields(step.id).includes(name))
  if (inBase || step || overrideStep) tab.value = 'steps'
  await nextTick()
  const field = overrideStep
    ? [...(workbench.value?.querySelectorAll<HTMLElement>('[data-step-date-key]') ?? [])].find(
        (el) => el.dataset.stepDateKey === `step-${stepId}`,
      )
    : [...(workbench.value?.querySelectorAll<HTMLElement>('[data-field-key]') ?? [])].find(
        (el) => el.dataset.fieldKey === name,
      )
  for (let ancestor = field?.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true
  }
  field?.scrollIntoView({ block: 'center' })
  field
    ?.querySelector<HTMLElement>(overrideStep ? 'select' : 'input, select')
    ?.focus({ preventScroll: true })
}
function focusOverviewField(key: string) {
  const context = checkedOverview.value.find((context) =>
    missingContextFields([context], values.value, stepDateOverrides.value).includes(key),
  )
  return focusField(key, context?.stepId ?? undefined)
}
function canGenerateStep(stepId: string) {
  return !busy.value && photoProcessing.value.size === 0 && stepMissing(stepId).length === 0
}
const missingFields = computed(() => missingOverviewFields(fieldNames.value, values.value))
const generateHint = computed(() =>
  missingFields.value.length ? `請先在基本資料填寫：${missingFields.value.join('、')}。` : '',
)

const dateToken = '{{日期}}'
const dateSlashToken = '{{日期_民國}}'
const yearToken = '{{年}}'
const monthToken = '{{月}}'
const dayToken = '{{日}}'

const dateValue = computed({
  get: () => values.value['日期'] ?? '',
  set: (value: string) => {
    values.value = { ...values.value, 日期: value }
  },
})

watch(
  category,
  (value) => {
    document.title = value ? `${value.name} · ${appName}` : `找不到流程 · ${appName}`
  },
  { immediate: true },
)

watch(
  categoryId,
  () => {
    clearDraft()
    confirmDelete.value = false
  },
  { flush: 'sync' },
)

// A reloaded workflow or replacement template must not inherit old checkmarks.
watch(
  [category, () => templates.items],
  () => {
    completedSteps.value = []
    handledSteps.value = []
  },
  { flush: 'sync' },
)

watch(
  () => session.authenticated,
  (signedIn) => {
    if (!signedIn) {
      clearDraft()
      if (pendingLeave) finishLeave(true)
    }
  },
)

function clearDraft() {
  draftVersion++
  completedSteps.value = []
  handledSteps.value = []
  busy.value = false
  selectedVariants.value = []
  printStep.value = null
  defaultedFields.clear()
  values.value = initialDraftValues()
  emptyValues.value = { ...values.value }
  stepDateOverrides.value = {}
  draftGeneration.value++
  photoDrafts.value = {}
  photoProcessing.value.clear()
  photoCells.value = {}
  photoRevision++
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

async function renderOne(context: GenerationContext) {
  await photoMetadataLoading
  const id = context.templateId
  const filled = filledContext(context, values.value, stepDateOverrides.value)
  if (!filled) throw new Error('invalid-date')
  const template = templates.byId(id)
  if (!template || template.kind === 'pdf') throw new Error('missing-template')
  const bytes = await templates.bytesFor(id)
  if (!bytes) throw new Error('missing-template')
  const draft = photoDrafts.value[id]
  if (
    photoCells.value[id] &&
    draft?.photos.some((photo) => {
      const time = photo.overrides?.time ?? draft.common.time
      return time !== '' && !parseRocDate(time)
    })
  )
    throw new Error('invalid-date')
  return {
    name: `產生-${displayFileName(template.fileName)}`,
    data: photoCells.value[id]
      ? renderTemplatePhotos(id, bytes, filled, photoDrafts.value)
      : renderDocx(bytes, filled),
  }
}

async function produceOne(stepId: string, templateId: string) {
  if (!canGenerateStep(stepId)) return
  const context = contexts.value.find((item) => item.id === contextKey(stepId, templateId))
  if (!context) return
  const version = draftVersion
  busy.value = true
  message.value = ''
  messageStepId.value = stepId
  try {
    const rendered = await renderOne(context)
    if (version !== draftVersion) return
    downloadBytes(rendered.data, rendered.name, templateMimeType)
    messageTone.value = 'ok'
    message.value = `已下載「${rendered.name}」。填寫內容沒有被保存。`
  } catch (error) {
    if (version !== draftVersion) return
    messageTone.value = 'warn'
    message.value =
      error instanceof Error && error.message === 'invalid-date'
        ? '日期不是有效的民國日期。'
        : '無法產生這份文件。請確認範本裡的欄位寫成雙大括號。'
  } finally {
    if (version === draftVersion) busy.value = false
  }
}

async function produceStep(stepId: string, templateIds: string[], index: number) {
  if (!canGenerateStep(stepId) || !category.value || templateIds.length === 0) return
  const version = draftVersion
  busy.value = true
  message.value = ''
  messageStepId.value = stepId
  const rendered: { name: string; data: Uint8Array }[] = []
  const failed: string[] = []
  for (const templateId of templateIds.filter((id) => templates.byId(id)?.kind !== 'pdf')) {
    try {
      const context = contexts.value.find((item) => item.id === contextKey(stepId, templateId))
      if (!context) throw new Error('missing-context')
      rendered.push(await renderOne(context))
    } catch {
      const template = templates.byId(templateId)
      failed.push(template ? displayFileName(template.fileName) : '範本')
    }
    if (version !== draftVersion) return
  }
  try {
    if (rendered.length === 0) {
      messageTone.value = 'warn'
      message.value = '沒有可以下載的文件。請確認日期有效，且範本欄位寫成雙大括號。'
      return
    }
    const base = (category.value.name || '範本').replace(/[\\/:*?"<>|]/g, '_')
    const zip = await zipGeneratedFiles(rendered)
    if (version !== draftVersion) return
    downloadBlob(zip, `${base}-步驟${index + 2}.zip`)
    messageTone.value = failed.length > 0 ? 'warn' : 'ok'
    message.value =
      failed.length > 0
        ? `已下載 ${rendered.length} 份文件。無法產生：${failed.join('、')}。填寫內容沒有被保存。`
        : `已下載 ${rendered.length} 份文件。填寫內容沒有被保存。`
  } finally {
    if (version === draftVersion) busy.value = false
  }
}

const categoryTemplateIds = computed(() => dedupedIds(visibleSteps.value))
const referenceTemplates = computed(() =>
  categoryTemplateIds.value.flatMap((id) => {
    const item = templates.byId(id)
    return item?.kind === 'pdf' ? [item] : []
  }),
)

const overviewList = computed(() =>
  generationContexts(visibleSteps.value, temporaryIds.value, (id) => templates.byId(id)),
)
// Only initialize each available field once per draft, so clearing an input stays cleared.
watch(
  [() => [...fieldNames.value, ...inputFields(overviewList.value)], draftGeneration],
  ([fields]) => {
    const added = fields.filter((key) => !defaultedFields.has(key))
    values.value = applyFieldDefaults(values.value, added)
    emptyValues.value = applyFieldDefaults(emptyValues.value, added)
    for (const key of added) defaultedFields.add(key)
  },
  { immediate: true },
)
watch(
  [overviewList, () => templates.items],
  () => {
    const version = ++photoRevision
    const ids = [...new Set(overviewList.value.map((item) => item.templateId))]
    // Empty summaries have no readable file yet. Real template records always carry sizeBytes.
    const readable = ids.filter((id) => (templates.byId(id)?.sizeBytes ?? 0) > 0)
    photoMetadataLoading = (async () => {
      const next: Record<string, number> = {}
      for (const id of readable) {
        try {
          const bytes = await templates.bytesFor(id)
          if (version !== photoRevision) return
          if (!bytes) continue
          const block = readPhotoBlock(bytes)
          if (block) next[id] = block.photoCellsPerPage
        } catch {
          /* Upload validation reports invalid syntax; unavailable files cannot render. */
        }
      }
      if (version !== photoRevision) return
      photoCells.value = next
      photoDrafts.value = Object.fromEntries(
        Object.entries(photoDrafts.value).filter(([id]) => !!next[id]),
      )
    })()
  },
  { immediate: true },
)
const checkedOverview = computed(() => checkedTemplates(overviewList.value, unchecked.value))
const overviewFields = computed(() => {
  const needed = new Set(inputFields(checkedOverview.value))
  return fieldNames.value.filter((name) => needed.has(name))
})
const overviewGroups = computed(() => {
  const seen = new Set<string>()
  return checkedOverview.value
    .filter((context) => {
      const key = scopeKey(context)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((context) => ({
      context,
      fields: localFieldNames(
        checkedOverview.value.filter((item) => scopeKey(item) === scopeKey(context)),
        fieldNames.value,
      ),
    }))
})
const overviewMissing = computed(() =>
  missingContextFields(checkedOverview.value, values.value, stepDateOverrides.value),
)
const canGenerateOverview = computed(
  () =>
    checkedOverview.value.length > 0 &&
    overviewMissing.value.length === 0 &&
    !busy.value &&
    photoProcessing.value.size === 0,
)
const overviewHint = computed(() => {
  if (checkedOverview.value.length === 0) return '請勾選至少一份文件。'
  if (overviewMissing.value.some((name) => name === '日期格式')) return '日期不是有效的民國日期。'
  if (overviewMissing.value.length === 0) return ''
  return `請先填寫：${overviewMissing.value.join('、')}。`
})

const additionChoices = computed(() => {
  const linked = new Set(categoryTemplateIds.value)
  const query = pickerQuery.value.trim().toLocaleLowerCase()
  return templates.items.filter((item) => {
    if (item.kind === 'pdf' || linked.has(item.id)) return false
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
  const key = contextKey(null, id)
  if (target.checked) {
    if (!temporaryIds.value.includes(id)) temporaryIds.value = [...temporaryIds.value, id]
    if (unchecked.value[key]) {
      const next = { ...unchecked.value }
      delete next[key]
      unchecked.value = next
    }
    return
  }
  temporaryIds.value = temporaryIds.value.filter((item) => item !== id)
  if (!unchecked.value[key]) return
  const next = { ...unchecked.value }
  delete next[key]
  unchecked.value = next
}

function onPickerQuery(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  pickerQuery.value = target.value
}

async function produceChecked() {
  if (!canGenerateOverview.value || !category.value) return
  const version = draftVersion
  busy.value = true
  overviewMessage.value = ''
  const selected = checkedOverview.value
  const rendered: { name: string; data: Uint8Array }[] = []
  const failed: string[] = []
  for (const template of selected) {
    try {
      rendered.push(await renderOne(template))
    } catch {
      failed.push(displayFileName(template.fileName))
    }
    if (version !== draftVersion) return
  }
  try {
    if (rendered.length === 0) {
      overviewTone.value = 'warn'
      overviewMessage.value = '沒有可以下載的文件。請確認日期有效，且範本欄位寫成雙大括號。'
      return
    }
    const base = (category.value.name || '範本').replace(/[\\/:*?"<>|]/g, '_')
    const zip = await zipGeneratedFiles(rendered)
    if (version !== draftVersion) return
    downloadBlob(zip, `${base}-勾選文件.zip`)
    overviewTone.value = failed.length > 0 ? 'warn' : 'ok'
    overviewMessage.value =
      failed.length > 0
        ? `已下載 ${rendered.length} 份文件。無法產生：${failed.join('、')}。填寫內容沒有被保存。`
        : `已下載 ${rendered.length} 份文件。填寫內容沒有被保存。`
  } finally {
    if (version === draftVersion) busy.value = false
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
    message.value = cause instanceof Error ? cause.message : '無法刪除案件範本。'
    deleting.value = false
  }
}

// Defaults alone are not a draft. Check every in-memory input, including hidden
// step values and photos, rather than only the currently visible/required fields.
const hasDraftContent = computed(
  () =>
    Object.entries(values.value).some(([key, value]) => value !== (emptyValues.value[key] ?? '')) ||
    Object.keys(stepDateOverrides.value).length > 0 ||
    Object.values(photoDrafts.value).some(
      (draft) =>
        draft.photos.length > 0 ||
        draft.common.location !== '' ||
        draft.common.photographer !== '' ||
        draft.common.time !== defaultRocDateSlash(),
    ) ||
    photoProcessing.value.size > 0 ||
    selectedVariants.value.length > 0 ||
    temporaryIds.value.length > 0 ||
    Object.values(unchecked.value).some(Boolean) ||
    completedSteps.value.length > 0 ||
    handledSteps.value.length > 0,
)
const confirmLeave = ref(false)
let pendingLeave: Promise<boolean> | undefined
let resolveLeave: ((allowed: boolean) => void) | undefined
function finishLeave(allowed: boolean) {
  confirmLeave.value = false
  if (allowed) clearDraft()
  resolveLeave?.(allowed)
  resolveLeave = undefined
  pendingLeave = undefined
}
function requestLeave(): Promise<boolean> {
  if (!hasDraftContent.value) {
    clearDraft()
    return Promise.resolve(true)
  }
  if (pendingLeave) return pendingLeave
  confirmLeave.value = true
  pendingLeave = new Promise((resolve) => {
    resolveLeave = resolve
  })
  return pendingLeave
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (!hasDraftContent.value) return
  event.preventDefault()
  event.returnValue = ''
}
onBeforeRouteLeave(requestLeave)
onBeforeRouteUpdate((to, from) => (to.params.id !== from.params.id ? requestLeave() : true))
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onUnmounted(() => {
  window.removeEventListener('beforeunload', beforeUnload)
  finishLeave(false)
  clearDraft()
})
defineExpose({ requestLeave })
</script>

<template>
  <ConfirmDialog
    v-if="confirmLeave"
    title="離開工作台？"
    confirm-label="確定離開"
    @confirm="finishLeave(true)"
    @cancel="finishLeave(false)"
  >
    離開會清除本次填寫的欄位、步驟日期、照片與處理註記，內容不會保存。確定要離開嗎？
  </ConfirmDialog>
  <Teleport to="body">
    <article v-if="printStep" id="sop-print" class="hidden">
      <h1>{{ printStep.title ?? printStep.body }}</h1>
      <p v-if="printStep.canRunInParallel">此步驟可請其他人同步進行</p>
      <ul>
        <li v-for="(item, i) in printStep.items" :key="i">{{ item }}</li>
      </ul>
      <p v-if="printStep.note">{{ printStep.note }}</p>
    </article>
  </Teleport>
  <div v-if="category" ref="workbench" class="case-workbench" :class="{ embedded }">
    <RouterLink
      v-if="!embedded"
      to="/categories"
      class="focus-control mb-4 inline-flex text-sm text-stone-600 hover:text-ink"
    >
      回到全部流程
    </RouterLink>

    <PageIntro
      :eyebrow="categoryGroups[category.group ?? 'criminal']"
      :title="category.name"
      :description="category.summary || '依固定步驟挑選範本，填寫基本資料並產出 .docx。'"
    />

    <ul class="case-meta mb-4 flex flex-wrap gap-2" aria-label="流程資訊">
      <li class="rounded-full bg-surface px-3 py-1 text-xs text-stone-700 ring-1 ring-stone-200">
        案件範本
      </li>
      <li class="rounded-full bg-surface px-3 py-1 text-xs text-stone-700 ring-1 ring-stone-200">
        {{ visibleSteps.length }} 個範本步驟
      </li>
      <li class="rounded-full bg-surface px-3 py-1 text-xs text-stone-700 ring-1 ring-stone-200">
        {{ category.templateCount }} 份範本
      </li>
    </ul>
    <div class="case-edit-actions mb-4 flex flex-wrap gap-2">
      <RouterLink
        v-if="session.canEditCategory"
        :to="`/categories/${category.id}/edit`"
        class="btn-secondary"
      >
        繼續編輯
      </RouterLink>
      <button
        v-if="session.canDeleteCategory"
        type="button"
        class="btn-secondary"
        @click="confirmDelete = !confirmDelete"
      >
        刪除流程
      </button>
    </div>

    <div
      v-if="confirmDelete"
      class="mb-8 rounded-2xl border border-edge bg-surface p-5 shadow-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-category-title"
    >
      <h2 id="delete-category-title" class="text-base font-semibold text-ink-strong">
        刪除「{{ category.name }}」
      </h2>
      <p class="mt-2 text-sm leading-6 text-stone-600">
        只會刪除這個流程、它的步驟，以及步驟和範本的連結。範本檔仍留在範本庫。
      </p>
      <div class="mt-4 flex flex-wrap gap-3">
        <button type="button" class="btn-primary" :disabled="deleting" @click="removeCategory">
          確定刪除
        </button>
        <button type="button" class="btn-secondary" @click="confirmDelete = false">取消</button>
      </div>
    </div>

    <section
      v-if="tab === 'steps'"
      class="basic-data-row shared-fields-panel"
      aria-label="基本共用欄位"
    >
      <p v-if="generateHint" class="mb-3 text-xs text-ink-muted">
        請先填寫：
        <button
          v-for="key in missingFields"
          :key="key"
          type="button"
          class="focus-control mr-2 underline"
          @click="focusField(key)"
        >
          {{ key }}
        </button>
      </p>
      <details open>
        <summary class="focus-control cursor-pointer">
          <h3 class="inline text-sm font-semibold text-ink">基本資料</h3>
          <span class="ml-2 text-xs text-ink-muted">填寫欄位</span>
        </summary>
        <div class="py-4">
          <p class="mt-1 text-sm leading-6 text-stone-600">
            基本資料會套進各步驟的範本。日期預設為台北今天。
          </p>
          <details class="mt-3 text-xs text-ink-muted">
            <summary class="focus-control cursor-pointer">範本欄位說明</summary>
            <PlaceholderGuide class="mt-3" />
          </details>
          <div class="mt-4 grid max-w-xl gap-4">
            <div v-for="(name, index) in fieldNames" :key="name" :data-field-key="name">
              <label class="block text-sm font-medium text-stone-800" :for="`draft-${index}`">
                {{ fieldLabel(name) }}
              </label>
              <RocDateField v-if="name === '日期'" v-model="dateValue" />
              <input
                v-else
                :id="`draft-${index}`"
                :value="fieldValue(name)"
                :type="fieldType(name)"
                step="any"
                autocomplete="off"
                :placeholder="fieldPlaceholder(name)"
                class="field mt-2 w-full"
                @input="onFieldInput(name, $event)"
              />
            </div>
          </div>
        </div>
      </details>
    </section>

    <div
      v-if="category.modules?.length"
      class="mb-5 flex flex-wrap gap-2"
      aria-label="情境模組選擇"
    >
      <label
        v-for="variant in category.modules"
        :key="variant.id"
        class="scenario-choice cursor-pointer rounded-full border border-edge px-4 py-2 text-sm"
        :class="
          selectedVariants.includes(variant.id) ? 'bg-accent-soft text-accent-ink' : 'bg-surface'
        "
      >
        <input v-model="selectedVariants" type="checkbox" :value="variant.id" /> {{ variant.name }}
      </label>
    </div>
    <p v-for="issue in mappingIssues" :key="issue" role="alert" class="mb-3 text-tone-danger-ink">
      {{ issue }}
    </p>
    <div class="parallel-entry mb-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        class="btn-secondary focus-control"
        aria-controls="parallel-work"
        @click="focusParallelWork"
      >
        <AppIcon name="members" class="h-5 w-5" />
        可同步作業，共 {{ parallelWork.length }} 項
      </button>
      <span role="status" aria-live="polite" aria-atomic="true" class="text-sm text-ink-muted"
        >已處理 {{ handledCount }}／共 {{ parallelWork.length }}</span
      >
    </div>
    <div class="workbench-layout">
      <aside class="workbench-library self-start rounded-2xl border border-edge bg-surface p-4">
        <h2 class="font-semibold">全部範本</h2>
        <p class="mt-2 text-xs text-ink-muted">{{ fieldKeyHint }}：{{ fieldNames.join('、') }}</p>
        <ul class="mt-3 space-y-3">
          <li v-for="item in contexts" :key="item.id">
            <button
              class="btn-ghost text-left text-sm text-accent-ink hover:underline"
              :disabled="!canGenerateStep(item.stepId!)"
              @click="produceOne(item.stepId!, item.templateId)"
            >
              {{ item.stepTitle }}：{{ displayFileName(item.fileName) }}
            </button>
          </li>
        </ul>
      </aside>
      <div class="workbench-content min-w-0">
        <div class="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="工作台檢視">
          <button
            id="tab-steps"
            type="button"
            role="tab"
            aria-controls="panel-steps"
            :aria-selected="tab === 'steps'"
            class="focus-control rounded-control px-4 py-2.5 text-sm font-medium"
            :class="
              tab === 'steps'
                ? 'bg-ink text-white'
                : 'bg-surface text-stone-700 ring-1 ring-stone-200'
            "
            @click="tab = 'steps'"
          >
            範本步驟
          </button>
          <button
            id="tab-overview"
            type="button"
            role="tab"
            aria-controls="panel-overview"
            :aria-selected="tab === 'overview'"
            class="focus-control rounded-control px-4 py-2.5 text-sm font-medium"
            :class="
              tab === 'overview'
                ? 'bg-ink text-white'
                : 'bg-surface text-stone-700 ring-1 ring-stone-200'
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
          class="rounded-2xl border border-edge bg-surface px-5 py-5 shadow-card"
        >
          <h2 class="text-base font-semibold text-ink-strong">範本步驟</h2>
          <p class="mt-1 text-sm leading-6 text-stone-600">
            基本資料的欄位只留在這個畫面。離開這個流程或登出後會清除，也不會送到服務。
          </p>
          <ol class="fixed-steps-list mt-4">
            <li v-if="visibleSteps.length === 0" class="py-5 text-sm text-ink-muted">
              尚未設定範本步驟。
            </li>

            <li
              v-for="(step, index) in visibleSteps"
              :key="step.id"
              class="fixed-step flex gap-4 border-b border-edge py-5"
              :class="{
                'bg-tone-ok': !step.canRunInParallel && completedSteps.includes(step.id),
                'parallel-step': step.canRunInParallel,
              }"
            >
              <div class="flex w-8 flex-col items-center">
                <span
                  class="flex h-8 w-8 items-center justify-center rounded-control bg-accent-soft text-xs font-semibold text-accent-ink"
                >
                  {{ String(index + 1).padStart(2, '0') }}
                </span>
                <span
                  v-if="index < visibleSteps.length - 1"
                  class="my-2 w-px flex-1 bg-stone-200"
                  aria-hidden="true"
                ></span>
              </div>
              <div class="step-content min-w-0 flex-1">
                <div class="step-description">
                  <h3
                    class="text-sm font-semibold text-ink whitespace-pre-wrap"
                    :class="{
                      'line-through': !step.canRunInParallel && completedSteps.includes(step.id),
                    }"
                  >
                    {{ step.title ?? step.body }}
                  </h3>
                  <label
                    v-if="step.canRunInParallel"
                    class="mt-2 inline-flex cursor-pointer items-center gap-2 text-sm text-ink"
                  >
                    <input
                      v-model="handledSteps"
                      type="checkbox"
                      :value="step.id"
                      :aria-label="`${step.title ?? step.body}：本次已處理`"
                      class="focus-control h-4 w-4"
                    />
                    本次已處理
                  </label>
                  <label
                    v-else
                    class="mt-2 inline-flex cursor-pointer items-center gap-2 text-sm text-ink"
                  >
                    <input
                      v-model="completedSteps"
                      type="checkbox"
                      :value="step.id"
                      :aria-label="`${step.title ?? step.body}：已完成`"
                      class="focus-control h-4 w-4"
                    />
                    已完成
                  </label>
                  <details class="step-instructions mt-2 text-xs text-ink-muted">
                    <summary class="focus-control cursor-pointer">步驟說明 / 列印</summary>
                    <ul v-if="step.items?.length" class="mt-3 list-disc pl-5 text-sm">
                      <li v-for="(item, itemIndex) in step.items" :key="itemIndex">{{ item }}</li>
                    </ul>
                    <p
                      v-if="step.note"
                      class="mt-3 rounded-control bg-amber-100 p-3 text-sm font-medium text-amber-950"
                    >
                      {{ step.note }}
                    </p>
                    <button
                      type="button"
                      class="btn-ghost mt-3 block text-sm text-accent-ink hover:underline"
                      @click="printSop(step)"
                    >
                      列印 SOP
                    </button>
                  </details>
                </div>
                <p
                  v-if="step.canRunInParallel"
                  class="parallel-hint mt-2 flex items-center gap-2 text-sm"
                >
                  <AppIcon name="members" class="h-5 w-5 shrink-0" />可請其他人同步處理
                </p>
                <WorkbenchStepFields
                  :fields="localFields(step.id)"
                  :date-override="stepDateOverrides[step.id]"
                  :shared-labels="sharedLabels"
                  :values="values"
                  :definitions="category.fields"
                  :prefix="`step-${step.id}`"
                  :missing="stepMissing(step.id)"
                  :templates="templatesFor(step)"
                  :photo-cells="photoCells"
                  :busy="busy || photoProcessing.size > 0"
                  :message="messageStepId === step.id ? message : ''"
                  :message-tone="messageTone"
                  @update="setField"
                  @update-date-override="setStepDateOverride(step.id, $event)"
                  @focus-field="focusField($event, step.id)"
                  @generate="(id) => produceOne(step.id, id)"
                  @generate-all="produceStep(step.id, step.templateIds, index)"
                >
                  <template #photos="{ templateId }">
                    <PhotoBlockFields
                      v-if="photoCells[templateId]"
                      :template-id="templateId"
                      :cells="photoCells[templateId]!"
                      :draft="photoDrafts[templateId]"
                      :busy="busy || photoProcessing.size > 0"
                      @update="setPhotoDraft(templateId, $event)"
                      @processing="setPhotoProcessing"
                    />
                  </template>
                </WorkbenchStepFields>
              </div>
            </li>
          </ol>
        </section>

        <section
          v-else
          id="panel-overview"
          role="tabpanel"
          aria-labelledby="tab-overview"
          class="rounded-2xl border border-edge bg-surface px-5 py-5 shadow-card"
        >
          <h2 class="text-base font-semibold text-ink-strong">全部文件總覽</h2>
          <p class="mt-1 text-sm leading-6 text-stone-600">
            列出這個流程各步驟的範本，依所屬步驟分列，預設全部勾選。取消勾選，或從範本庫暫時加入其他範本，只影響這次產生，不會改動流程設定。欄位與範本步驟的基本資料共用，離開這個流程或登出後清除，也不會送到服務。
          </p>

          <ol aria-label="完整流程總覽" class="mt-4 space-y-2">
            <li v-for="step in visibleSteps" :key="step.id">
              <span>{{ step.title ?? step.body }}</span>
              <span v-if="step.canRunInParallel" class="ml-2 text-sm"
                >此步驟可請其他人同步進行</span
              >
            </li>
          </ol>
          <ReferenceDocuments :templates="referenceTemplates" />
          <div class="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div>
              <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h3 class="text-sm font-semibold text-ink">文件</h3>
                <button
                  type="button"
                  class="btn-secondary"
                  :aria-expanded="pickerOpen"
                  @click="pickerOpen = !pickerOpen"
                >
                  從範本庫選取
                </button>
              </div>
              <p v-if="overviewList.length === 0" class="text-sm text-ink-muted">
                這個流程還沒有範本。可從範本庫暫時加入。
              </p>
              <ul v-else class="divide-y divide-stone-200 rounded-2xl border border-edge">
                <li v-for="item in overviewList" :key="item.id" class="px-4 py-3">
                  <label class="flex items-start gap-3 text-sm text-stone-800">
                    <input
                      type="checkbox"
                      class="mt-1"
                      :checked="unchecked[item.id] !== true"
                      @change="toggleOverview(item.id, $event)"
                    />
                    <span class="min-w-0">
                      <span class="block break-all font-medium text-ink">
                        {{ item.stepTitle }}：{{ displayFileName(item.fileName) }}
                        <span
                          v-if="isTemporary(item.templateId)"
                          class="ml-2 text-xs font-normal text-accent-ink"
                        >
                          本次暫加
                        </span>
                      </span>
                      <span v-if="item.canRunInParallel" class="block text-sm"
                        >此步驟可請其他人同步進行</span
                      >
                      <span class="mt-1 block text-xs text-ink-muted">
                        {{
                          item.placeholders.length > 0
                            ? item.placeholders.join('、')
                            : '沒有偵測到欄位'
                        }}
                      </span>
                    </span>
                  </label>
                </li>
              </ul>

              <div
                v-if="pickerOpen"
                class="mt-3 rounded-2xl border border-edge bg-surface-muted p-4"
              >
                <label class="block text-xs font-medium text-stone-600" for="overview-picker">
                  搜尋範本
                </label>
                <input
                  id="overview-picker"
                  :value="pickerQuery"
                  type="search"
                  placeholder="請輸入檔名"
                  class="field mt-2 w-full"
                  @input="onPickerQuery"
                />
                <p class="mt-2 text-xs leading-5 text-ink-muted">
                  這裡勾選的範本只加進這次清單，不會寫進流程或步驟。
                </p>
                <p v-if="templates.items.length === 0" class="mt-3 text-sm text-ink-muted">
                  範本庫還沒有文件。
                </p>
                <p v-else-if="additionChoices.length === 0" class="mt-3 text-sm text-ink-muted">
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
              <h3 class="text-sm font-semibold text-ink">基本資料</h3>
              <p class="mt-1 text-sm leading-6 text-stone-600">
                共用欄位只填一次，步驟專屬欄位分開填寫。日期與範本步驟共用，預設為台北今天。{{
                  yearToken
                }}、{{ monthToken }}、{{ dayToken }}、{{ dateToken }}、{{ dateSlashToken }}
                預設跟這個日期走，可在本步驟欄位切換成不同日期。
              </p>
              <p v-if="overviewFields.length === 0" class="mt-4 text-sm text-ink-muted">
                勾選文件後，這裡會列出要填的欄位。
              </p>
              <div v-else class="mt-4 grid gap-4">
                <div v-for="(name, index) in overviewFields" :key="name">
                  <label
                    class="block text-sm font-medium text-stone-800"
                    :for="`overview-${index}`"
                  >
                    {{ fieldLabel(name) }}
                  </label>
                  <RocDateField v-if="name === '日期'" v-model="dateValue" />
                  <input
                    v-else
                    :id="`overview-${index}`"
                    :value="fieldValue(name)"
                    :type="fieldType(name)"
                    step="any"
                    autocomplete="off"
                    :placeholder="fieldPlaceholder(name)"
                    class="field mt-2 w-full"
                    @input="onFieldInput(name, $event)"
                  />
                </div>
              </div>
              <section
                v-for="group in overviewGroups"
                :key="scopeKey(group.context)"
                :aria-label="group.context.stepTitle"
                class="mt-4"
              >
                <p class="text-sm font-medium">{{ group.context.stepTitle }}：本步驟欄位</p>
                <StepDateField
                  v-if="
                    group.context.stepId !== null &&
                    inputFields(
                      checkedOverview.filter((item) => item.stepId === group.context.stepId),
                    ).includes('日期')
                  "
                  :shared-date="dateValue"
                  :override="stepDateOverrides[group.context.stepId]"
                  @update="setStepDateOverride(group.context.stepId!, $event)"
                />
                <StepFields
                  :fields="group.fields"
                  :shared-labels="sharedLabels"
                  :values="values"
                  :definitions="category.fields"
                  :prefix="`overview-${scopeKey(group.context)}`"
                  @update="setField"
                />
                <template
                  v-for="templateId in checkedOverview
                    .filter((item) => scopeKey(item) === scopeKey(group.context))
                    .map((item) => item.templateId)"
                  :key="templateId"
                >
                  <div v-if="photoCells[templateId]" class="mt-4">
                    <p class="text-sm font-medium">
                      {{ displayFileName(templates.byId(templateId)?.fileName ?? '') }}
                    </p>
                    <PhotoBlockFields
                      :template-id="templateId"
                      :cells="photoCells[templateId]!"
                      :draft="photoDrafts[templateId]"
                      :busy="busy || photoProcessing.size > 0"
                      @update="setPhotoDraft(templateId, $event)"
                      @processing="setPhotoProcessing"
                    />
                  </div>
                </template>
              </section>
              <div class="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  class="btn-primary"
                  :disabled="!canGenerateOverview"
                  @click="produceChecked"
                >
                  產生勾選文件
                </button>
                <p v-if="!canGenerateOverview && overviewHint" class="text-sm text-amber-900">
                  <template v-if="overviewMissing.length"
                    >請先填寫：
                    <button
                      v-for="key in overviewMissing"
                      :key="key"
                      type="button"
                      class="focus-control mr-2 underline"
                      @click="focusOverviewField(key)"
                    >
                      {{ key }}
                    </button>
                  </template>
                  <template v-else>{{ overviewHint }}</template>
                </p>
              </div>
              <p
                v-if="overviewMessage"
                class="mt-3 rounded-control px-3 py-2 text-sm leading-6"
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
      <section
        id="parallel-work"
        ref="parallelRegion"
        role="region"
        tabindex="-1"
        aria-labelledby="parallel-work-title"
        class="parallel-work focus-control rounded-2xl border border-edge bg-surface p-4"
      >
        <h2 id="parallel-work-title" class="font-semibold text-ink-strong">可同步作業區</h2>
        <p class="mt-2 text-sm text-ink">需要前置資料的作業，請確認備齊後再進行</p>
        <p class="mt-2 text-xs text-ink-muted">
          「本次已處理」僅為本次手動註記，非系統驗證或法定程序完成；離開後清除。
        </p>
        <p v-if="parallelWork.length === 0" class="mt-4 text-sm text-ink-muted">
          此情境組合沒有可同步作業
        </p>
        <ol v-else class="mt-4 space-y-4" aria-label="可同步作業清單">
          <li
            v-for="step in parallelWork"
            :key="step.id"
            class="parallel-work-item min-w-0 border-t border-edge pt-3"
          >
            <label class="mb-2 inline-flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                v-model="handledSteps"
                type="checkbox"
                :value="step.id"
                :aria-label="`${step.title ?? step.body}：本次已處理`"
                class="focus-control h-4 w-4"
              />
              本次已處理
            </label>
            <details>
              <summary class="focus-control cursor-pointer font-semibold text-ink">
                {{ step.title ?? step.body }}
              </summary>
              <ul v-if="step.items?.length" class="mt-3 list-disc pl-5 text-sm">
                <li v-for="(item, index) in step.items" :key="index">{{ item }}</li>
              </ul>
              <p
                v-if="step.note"
                class="mt-3 rounded-control bg-amber-100 p-3 text-sm text-amber-950"
              >
                {{ step.note }}
              </p>
              <button
                type="button"
                class="btn-ghost mt-3 text-sm text-accent-ink"
                @click="printSop(step)"
              >
                列印 SOP
              </button>
              <WorkbenchStepFields
                :fields="localFields(step.id)"
                :date-override="stepDateOverrides[step.id]"
                :shared-labels="sharedLabels"
                :values="values"
                :definitions="category.fields"
                :prefix="`parallel-${step.id}`"
                :missing="stepMissing(step.id)"
                :templates="templatesFor(step)"
                :photo-cells="photoCells"
                :busy="busy || photoProcessing.size > 0"
                :message="messageStepId === step.id ? message : ''"
                :message-tone="messageTone"
                @update="setField"
                @update-date-override="setStepDateOverride(step.id, $event)"
                @focus-field="focusField($event, step.id)"
                @generate="(id) => produceOne(step.id, id)"
                @generate-all="
                  produceStep(
                    step.id,
                    step.templateIds,
                    visibleSteps.findIndex((item) => item.id === step.id),
                  )
                "
              >
                <template #photos="{ templateId }">
                  <PhotoBlockFields
                    v-if="photoCells[templateId]"
                    :template-id="templateId"
                    :cells="photoCells[templateId]!"
                    :draft="photoDrafts[templateId]"
                    :busy="busy || photoProcessing.size > 0"
                    @update="setPhotoDraft(templateId, $event)"
                    @processing="setPhotoProcessing"
                  />
                </template>
              </WorkbenchStepFields>
            </details>
          </li>
        </ol>
      </section>
    </div>
  </div>

  <div v-else-if="!categories.ready">
    <p class="text-sm text-ink-muted">正在讀取案件範本。</p>
  </div>

  <div v-else>
    <PageIntro
      eyebrow="案件範本"
      title="找不到這個流程"
      description="這個流程不存在，或已經刪除。請回到列表重新選擇。"
    />
    <EmptyState title="沒有對應的工作台" description="流程可能已刪除，或連結不完整。">
      <RouterLink to="/categories" class="btn-primary"> 回到案件範本 </RouterLink>
    </EmptyState>
  </div>
</template>

<style>
@media print {
  body:has(#sop-print) > :not(#sop-print) {
    display: none !important;
  }
  #sop-print,
  #sop-print * {
    visibility: visible !important;
  }
  #sop-print {
    display: block !important;
    position: absolute;
    inset: 0;
    padding: 2cm;
    color: black;
    background: white;
  }
  #sop-print h1 {
    font-size: 24pt;
    margin-bottom: 1cm;
  }
  #sop-print p {
    margin-top: 1cm;
    white-space: pre-wrap;
  }
}
</style>
