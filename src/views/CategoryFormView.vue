<script setup lang="ts">
import { docxMimeType } from '../../shared/templateUpload'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { categoryGroups } from '@/config/app'
import type { CaseCategory, CategoryGroup, Variant, FieldDef } from '@/types/domain'
import SopEditor from '@/components/SopEditor.vue'
import EmptyState from '@/components/EmptyState.vue'
import FileDropzone from '@/components/FileDropzone.vue'
import PageIntro from '@/components/PageIntro.vue'
import TemplatePicker from '@/components/TemplatePicker.vue'
import { createdCategoryNotice, editPermissionHint } from '@/stores/categoryNotices'
import { focusAlert } from '@/utils/focusAlert'
import { restoreMoveFocus } from '@/utils/stepFocus'
import { useCategoryStore } from '@/stores/categories'
import { useSessionStore } from '@/stores/session'
import { useTemplateStore } from '@/stores/templates'
import { displayFileName } from '@/utils/fileName'
import { fieldMappingIssues } from '@/workbench/fieldMapping'
import { inputFields } from '@/workbench/overview'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  RouterLink,
  useRoute,
  useRouter,
} from 'vue-router'

const fieldMarkerExample = '{{姓名}}'
const copiedPlaceholder = ref('')
const copyError = ref('')
function fieldKey(field: FieldDef) {
  return (field.key || field.name || '')
    .trim()
    .replace(/^\{\{(.*)\}\}$/u, '$1')
    .trim()
}
function fieldPlaceholder(field: FieldDef) {
  return `{{${fieldKey(field)}}}`
}
async function copyPlaceholder(field: FieldDef) {
  const text = fieldPlaceholder(field)
  copiedPlaceholder.value = ''
  copyError.value = ''
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const previousFocus = document.activeElement
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('aria-label', '複製欄位寫法')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    let copied = false
    try {
      copied = document.execCommand('copy')
    } catch {
      copied = false
    } finally {
      area.remove()
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
    }
    if (!copied) {
      copyError.value = '無法自動複製，請選取欄位寫法後手動複製。'
      return
    }
  }
  copiedPlaceholder.value = text
}

interface DraftStep {
  key: string
  id?: string
  body: string
  canRunInParallel: boolean
  items: string
  note: string
  variantIds: string[]
  templateIds: string[]
  pickerOpen: boolean
  query: string
}

const route = useRoute()
const router = useRouter()
const categories = useCategoryStore()
const templates = useTemplateStore()
const session = useSessionStore()

const name = ref('')
const group = ref<CategoryGroup>('criminal')
const wizard = ref(route.name === 'category-edit' ? 3 : 1)
const variants = ref<Variant[]>([])
const fields = ref<FieldDef[]>([])
const builtinName = ref(false)
const sopScope = ref('base')
// Explicit base definitions survive without templates. Legacy definitions retain
// their exact base-template classification; never infer ownership from labels.
function attachedTemplates(stepIds?: Set<string>) {
  return steps.value
    .filter((step) => !stepIds || (step.id && stepIds.has(step.id)))
    .flatMap((step) => step.templateIds)
    .flatMap((id) => {
      const template = templates.byId(id)
      return template && template.kind !== 'pdf' ? [template] : []
    })
}
const baseTemplateFields = computed(() =>
  inputFields(
    attachedTemplates(
      isEdit.value ? new Set(existing.value?.baseSteps?.map((ref) => ref.stepId) ?? []) : undefined,
    ),
  ),
)
const legacyFields = computed(() =>
  fields.value.filter(
    (field) =>
      fieldKey(field) !== '日期' &&
      field.scope !== 'base' &&
      existing.value?.fields?.some((saved) => saved.id === field.id) &&
      !baseTemplateFields.value.includes(field.key),
  ),
)
const manualFields = computed(() =>
  fields.value.filter((field) => fieldKey(field) !== '日期' && !legacyFields.value.includes(field)),
)
const legacyIssues = computed(() => fieldMappingIssues(legacyFields.value, attachedTemplates()))
function removeField(key: string, field?: FieldDef) {
  if (key === '日期' || !session.canEditCategory) return
  const attachedStepIds = isEdit.value
    ? new Set([
        ...(existing.value?.baseSteps ?? []).map((ref) => ref.stepId),
        ...(existing.value?.modules ?? []).flatMap((module) =>
          module.steps.map((ref) => ref.stepId),
        ),
      ])
    : undefined
  const usedBy = new Set(
    attachedTemplates(attachedStepIds)
      .filter((template) => template.placeholders.some((placeholder) => placeholder.trim() === key))
      .map((template) => template.id),
  ).size
  if (
    usedBy &&
    !window.confirm(`有 ${usedBy} 份範本使用 {{${key}}}，移除後會改成在使用它的步驟內填寫`)
  )
    return
  fields.value = fields.value.filter((entry) => (field ? entry !== field : fieldKey(entry) !== key))
  if (key === '姓名') builtinName.value = false
}
const summary = ref('')
const steps = ref<DraftStep[]>([blankStep()])
const populated = ref(false)
const saving = ref(false)
const formError = ref('')
const nameError = ref('')
const invalidStepKey = ref('')
const uploadErrors = ref<Record<string, string>>({})
const formAlert = ref<HTMLElement | null>(null)
const nameAlert = ref<HTMLElement | null>(null)
const stepAlert = ref<HTMLElement[]>([])
const initialStepId = computed(() => {
  if (!editingId.value) return
  const id = router.options.history.state.editStepId
  return typeof id === 'string' ? id : undefined
})
const formNotice = ref('')
const savedNotice = ref('')
const editor = ref<InstanceType<typeof SopEditor> | null>(null)
const form = ref<HTMLFormElement | null>(null)
const confirmSave = ref(false)
const confirmLeave = ref(false)
let pendingLeave: Promise<boolean> | undefined
let resolveLeave: ((allowed: boolean) => void) | undefined
let leavingForLogout = false

const editingId = computed(() => {
  if (route.name !== 'category-edit') return ''
  const raw = route.params.id
  return (Array.isArray(raw) ? raw[0] : raw) ?? ''
})
const isEdit = computed(() => editingId.value.length > 0)
const existing = computed(() => (editingId.value ? categories.byId(editingId.value) : undefined))
const wizardSteps = computed(() => [
  { label: '名稱與分類', value: 1 },
  ...(isEdit.value ? [{ label: '情境', value: 2 }] : []),
  { label: '步驟與範本', value: 3 },
])

function blankStep(): DraftStep {
  return {
    key: crypto.randomUUID(),
    body: '',
    canRunInParallel: false,
    items: '',
    note: '',
    variantIds: [],
    templateIds: [],
    pickerOpen: false,
    query: '',
  }
}

function formSnapshot() {
  return JSON.stringify({
    name: name.value,
    group: group.value,
    summary: summary.value,
    fields: fields.value,
    builtinName: builtinName.value,
    steps: isEdit.value
      ? []
      : steps.value.map((step) => [
          step.body,
          step.items,
          step.note,
          step.canRunInParallel,
          step.variantIds,
          step.templateIds,
        ]),
  })
}
const baseline = ref(formSnapshot())
const formDirty = computed(() => formSnapshot() !== baseline.value)
const dirty = computed(() => formDirty.value || !!editor.value?.hasDraft)

function fillFrom(category: CaseCategory, preserveDraft = false) {
  if (!preserveDraft) {
    name.value = category.name
    group.value = category.group ?? 'criminal'
    summary.value = category.summary
    fields.value = (category.fields ?? []).map((field) => ({ ...field }))
    builtinName.value = category.builtinFields?.['姓名'] === true
    baseline.value = formSnapshot()
  }
  variants.value = (category.variants ?? []).map((v) => ({ ...v }))
  steps.value = category.steps.map((step) => ({
    key: step.id,
    id: step.id,
    body: step.title ?? step.body,
    canRunInParallel: step.canRunInParallel ?? false,
    items: (step.items ?? []).join('\n'),
    note: step.note ?? '',
    variantIds: [...(step.variantIds ?? [])],
    templateIds: [...step.templateIds],
    pickerOpen: false,
    query: '',
  }))
  populated.value = true
}

watch(
  existing,
  (category, previous) => {
    if (category) fillFrom(category, category.id === previous?.id && formDirty.value)
  },
  { immediate: true },
)

watch([() => route.name, editingId], () => {
  formError.value = ''
  formNotice.value = ''
  savedNotice.value = ''
  wizard.value = isEdit.value ? 3 : 1
  nameError.value = ''
  invalidStepKey.value = ''
  uploadErrors.value = {}
  sopScope.value = 'base'
  pendingRemoveStep.value = null
  if (existing.value) return
  populated.value = false
  name.value = ''
  group.value = 'criminal'
  variants.value = []
  fields.value = []
  builtinName.value = false
  summary.value = ''
  steps.value = [blankStep()]
  baseline.value = formSnapshot()
})

function requestLeave(): Promise<boolean> {
  if (leavingForLogout) return Promise.resolve(true)
  if (saving.value || editor.value?.isBusy) return Promise.resolve(false)
  if (!dirty.value) return Promise.resolve(true)
  if (pendingLeave) return pendingLeave
  confirmSave.value = false
  pendingRemoveStep.value = null
  editor.value?.dismissConfirmation()
  confirmLeave.value = true
  pendingLeave = new Promise((resolve) => {
    resolveLeave = resolve
  })
  return pendingLeave
}
function finishLeave(allowed: boolean) {
  confirmLeave.value = false
  resolveLeave?.(allowed)
  resolveLeave = undefined
  pendingLeave = undefined
}
async function requestLogout() {
  leavingForLogout = await requestLeave()
  return leavingForLogout
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value && !saving.value && !editor.value?.isBusy) return
  event.preventDefault()
  event.returnValue = ''
}
onBeforeRouteLeave(requestLeave)
onBeforeRouteUpdate((to, from) => to.params.id === from.params.id || requestLeave())
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onUnmounted(() => {
  window.removeEventListener('beforeunload', beforeUnload)
  finishLeave(false)
})
defineExpose({ requestLeave: requestLogout })

async function changeWizard(value: number) {
  if (saving.value || editor.value?.isBusy) return
  formError.value = ''
  savedNotice.value = ''
  wizard.value = value
  await nextTick()
  form.value?.querySelector<HTMLElement>('[data-wizard-current]')?.focus()
}
async function addStep() {
  steps.value = [...steps.value, blankStep()]
  await nextTick()
  form.value
    ?.querySelector<HTMLTextAreaElement>(`#category-step-${steps.value.length - 1}`)
    ?.focus()
}

function moveStep(index: number, delta: number, button: HTMLButtonElement) {
  const nextIndex = index + delta
  if (nextIndex < 0 || nextIndex >= steps.value.length) return
  const next = [...steps.value]
  const [item] = next.splice(index, 1)
  if (!item) return
  next.splice(nextIndex, 0, item)
  steps.value = next
  void restoreMoveFocus(button)
}

const pendingRemoveStep = ref<DraftStep | null>(null)
function removeStep(index: number) {
  pendingRemoveStep.value = steps.value[index] ?? null
}
function confirmRemoveStep() {
  steps.value = steps.value.filter((step) => step.key !== pendingRemoveStep.value?.key)
  pendingRemoveStep.value = null
}

function onStep(index: number, event: Event) {
  const target = event.target
  if (!(target instanceof HTMLTextAreaElement)) return
  const next = [...steps.value]
  const current = next[index]
  if (!current) return
  next[index] = { ...current, body: target.value }
  steps.value = next
  if (current.key === invalidStepKey.value) invalidStepKey.value = ''
}

function templateName(id: string) {
  const found = templates.byId(id)
  return found
    ? `${displayFileName(found.fileName)}${found.kind === 'pdf' ? '（參考文件）' : ''}`
    : '範本'
}

function togglePicker(index: number) {
  const next = [...steps.value]
  const current = next[index]
  if (!current) return
  next[index] = { ...current, pickerOpen: !current.pickerOpen }
  steps.value = next
}

function toggleTemplate(index: number, templateId: string, checked: boolean) {
  const next = [...steps.value]
  const current = next[index]
  if (!current) return
  const templateIds = checked
    ? current.templateIds.includes(templateId)
      ? current.templateIds
      : [...current.templateIds, templateId]
    : current.templateIds.filter((id) => id !== templateId)
  next[index] = { ...current, templateIds }
  steps.value = next
}

function moveTemplate(
  index: number,
  templateIndex: number,
  delta: number,
  button: HTMLButtonElement,
) {
  const next = [...steps.value]
  const current = next[index]
  if (!current) return
  const nextIndex = templateIndex + delta
  if (nextIndex < 0 || nextIndex >= current.templateIds.length) return
  const templateIds = [...current.templateIds]
  const [item] = templateIds.splice(templateIndex, 1)
  if (!item) return
  templateIds.splice(nextIndex, 0, item)
  next[index] = { ...current, templateIds }
  steps.value = next
  void restoreMoveFocus(button)
}

async function onUpload(key: string, files: File[]) {
  const current = steps.value.find((step) => step.key === key)
  if (!current) return
  delete uploadErrors.value[key]
  try {
    const result = await templates.addFiles(files, current.id)
    const step = steps.value.find((step) => step.key === key)
    if (!step) return
    formNotice.value = result.formatNotice
    step.templateIds = [...new Set([...step.templateIds, ...result.ids])]
    uploadErrors.value[key] =
      result.rejected.join('。') || (result.ids.length ? '' : '沒有可保存的 Word 或 PDF 範本。')
  } catch (cause) {
    uploadErrors.value[key] = cause instanceof Error ? cause.message : '無法上傳範本。'
  }
}

async function showNameError(message: string) {
  wizard.value = 1
  nameError.value = message
  await nextTick()
  focusAlert(nameAlert.value)
}

const newId = () => crypto.randomUUID()

async function submit() {
  if (saving.value || editor.value?.isBusy) return
  formError.value = ''
  savedNotice.value = ''
  if (editor.value?.dirtyStep) {
    confirmSave.value = true
    return
  }
  await saveForm()
}
async function resolveSave(saveStep: boolean) {
  confirmSave.value = false
  const stepEditor = editor.value
  if (saveStep) {
    wizard.value = 3
    await nextTick()
    if (!(await stepEditor?.saveStep(false))) return
  }
  if (!saveStep) await stepEditor?.discardStep(false)
  await saveForm()
}
async function saveForm() {
  if (!name.value.trim()) {
    await showNameError('請填寫案件範本名稱。')
    return
  }
  if (!isEdit.value && wizard.value === 1) {
    await changeWizard(3)
    return
  }
  if (isEdit.value && categories.error) {
    saving.value = true
    try {
      await categories.reload()
      await nextTick()
    } finally {
      saving.value = false
    }
    if (categories.error) return
  }
  const prepared = steps.value.map((step, order) => ({
    id: step.id,
    body: step.body.trim(),
    title: step.body.trim(),
    order,
    items: step.items
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    note: step.note.trim(),
    canRunInParallel: step.canRunInParallel,
    variantIds: step.variantIds,
    templateIds: step.templateIds,
  }))
  const blankIndex = prepared.findIndex((step) => !step.body)
  if (!isEdit.value && blankIndex !== -1) {
    invalidStepKey.value = steps.value[blankIndex]!.key
    await nextTick()
    focusAlert(stepAlert.value[0])
    return
  }
  const mappedFields = fields.value.map((field) =>
    legacyFields.value.includes(field)
      ? { ...field }
      : { ...field, name: field.name?.trim(), key: fieldKey(field) },
  )
  const input = {
    name: name.value.trim(),
    group: group.value,
    fields: mappedFields,
    summary: summary.value.trim(),
    steps: prepared,
    ...(isEdit.value ? { builtinFields: { 姓名: builtinName.value } } : {}),
  }
  saving.value = true
  try {
    if (isEdit.value) {
      const previous = existing.value
      await categories.update(editingId.value, input)
      if (existing.value && existing.value !== previous) {
        fillFrom(existing.value)
      } else {
        fields.value = mappedFields
        baseline.value = formSnapshot()
      }
      savedNotice.value = '已儲存'
      await templates.reload()
      return
    }
    const created = await categories.create(input)
    if (prepared.some((step) => step.templateIds.length > 0))
      await templates.reload().catch(() => {})
    baseline.value = formSnapshot()
    const notice = { id: created.id, name: created.name || input.name }
    createdCategoryNotice.value = notice
    saving.value = false
    const failure = await router.push(`/categories/${created.id}`)
    if (failure && createdCategoryNotice.value?.id === notice.id) createdCategoryNotice.value = null
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '無法儲存案件範本。'
    saving.value = false
    if (message.includes('這個案件範本名稱已經存在')) {
      await showNameError(message)
    } else {
      formError.value = message
      await nextTick()
      focusAlert(formAlert.value)
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ConfirmDialog
    v-if="confirmLeave"
    title="放棄未儲存的修改？"
    confirm-label="放棄修改"
    cancel-label="繼續編輯"
    @confirm="finishLeave(true)"
    @cancel="finishLeave(false)"
  >
    離開後，尚未儲存的內容會清除。
  </ConfirmDialog>
  <ConfirmDialog
    v-else-if="confirmSave"
    title="編輯區還有未儲存的步驟修改，要一起儲存嗎？"
    confirm-label="儲存並繼續"
    alternate-label="放棄"
    @confirm="resolveSave(true)"
    @alternate="resolveSave(false)"
    @cancel="confirmSave = false"
  >
    放棄會清除步驟修改，並繼續儲存名稱與欄位。
  </ConfirmDialog>
  <ConfirmDialog
    tone="danger"
    v-if="pendingRemoveStep"
    title="移除步驟"
    @confirm="confirmRemoveStep"
    @cancel="pendingRemoveStep = null"
  >
    將移除「{{
      pendingRemoveStep.body || '空白步驟'
    }}」的內容、說明與範本連結；範本檔案仍保留在範本庫。
  </ConfirmDialog>
  <PageIntro
    :eyebrow="isEdit ? '編輯案件範本' : '新增案件範本'"
    :title="isEdit ? '編輯案件範本' : '新增案件範本'"
    :description="
      isEdit
        ? '步驟各自儲存，會立即生效。名稱與欄位請用頁底的按鈕儲存。'
        : '設定名稱、步驟與範本，再建立案件範本。'
    "
  >
    <RouterLink
      :to="isEdit ? `/categories/${editingId}` : '/categories'"
      class="focus-control inline-flex text-sm text-stone-600 hover:text-ink"
    >
      {{ isEdit ? '回到工作台' : '回到全部流程' }}
    </RouterLink>
  </PageIntro>

  <p v-if="categories.error" class="mb-4 text-sm text-tone-danger-ink" role="alert">
    {{ categories.error }}
  </p>
  <p v-if="!categories.ready" class="text-sm text-ink-muted">正在讀取案件範本。</p>
  <EmptyState
    v-else-if="!session.canEditCategory"
    title="你的帳號沒有編輯權限"
    :description="editPermissionHint"
  >
    <RouterLink to="/categories" class="btn-primary"> 回到案件範本 </RouterLink>
  </EmptyState>
  <EmptyState
    v-else-if="isEdit && !existing"
    title="找不到這個案件範本"
    description="案件範本可能已刪除，或連結不完整。"
  >
    <RouterLink to="/categories" class="btn-primary"> 回到案件範本 </RouterLink>
  </EmptyState>

  <form
    v-else-if="!isEdit || populated"
    ref="form"
    class="max-w-3xl rounded-2xl border border-edge bg-surface p-5 shadow-card sm:p-6"
    :class="{ 'xl:max-w-none': isEdit && wizard === 3 }"
    novalidate
    @submit.prevent="submit"
  >
    <nav v-if="isEdit" class="mb-6 flex flex-wrap gap-2" aria-label="表單區段">
      <button
        v-for="step in wizardSteps"
        :key="step.value"
        type="button"
        class="btn-secondary"
        :class="{ 'font-semibold': wizard === step.value }"
        :aria-current="wizard === step.value ? 'step' : undefined"
        :data-wizard-current="wizard === step.value ? '' : undefined"
        @click="changeWizard(step.value)"
      >
        {{ step.label }}
      </button>
    </nav>
    <ol v-else class="mb-6 flex gap-3 text-sm" aria-label="表單區段">
      <li
        v-for="(step, i) in wizardSteps"
        :key="step.value"
        :class="wizard === step.value ? 'font-semibold text-accent-ink' : 'text-ink-muted'"
      >
        <h2
          class="inline scroll-mt-20 rounded-sm focus-visible:outline-2"
          tabindex="-1"
          :data-wizard-current="wizard === step.value ? '' : undefined"
        >
          {{ i + 1 }}. {{ step.label }}
        </h2>
      </li>
    </ol>
    <p
      v-if="formError"
      ref="formAlert"
      class="mb-4 scroll-my-20 text-sm text-tone-danger-ink"
      role="alert"
      tabindex="-1"
    >
      {{ formError }}
    </p>
    <section v-show="wizard === 1" :inert="saving">
      <div>
        <label for="category-name" class="block text-sm font-medium text-stone-800">
          名稱 <span class="font-normal text-ink-muted">必填</span>
        </label>
        <input
          id="category-name"
          v-model="name"
          type="text"
          name="name"
          required
          :aria-invalid="nameError ? true : undefined"
          :aria-describedby="nameError ? 'category-name-error' : undefined"
          @input="nameError = ''"
          maxlength="80"
          autocomplete="off"
          placeholder="請輸入案件範本名稱"
          class="field mt-2 w-full"
        />
        <p
          v-if="nameError"
          id="category-name-error"
          ref="nameAlert"
          role="alert"
          tabindex="-1"
          class="mt-2 scroll-my-20 text-sm text-tone-danger-ink"
        >
          {{ nameError }}
        </p>
      </div>
      <label class="mt-4 block text-sm font-medium" for="category-group">大類</label>
      <select id="category-group" v-model="group" class="field mt-2 w-full">
        <option v-for="(label, key) in categoryGroups" :key="key" :value="key">{{ label }}</option>
      </select>
      <div class="mt-4">
        <label for="category-summary" class="block text-sm font-medium text-stone-800">
          簡述 <span class="font-normal text-ink-muted">選填</span>
        </label>
        <textarea
          id="category-summary"
          v-model="summary"
          name="summary"
          rows="3"
          maxlength="400"
          placeholder="請輸入簡述"
          class="field mt-2 w-full"
        ></textarea>
      </div>
    </section>
    <SopEditor
      v-if="isEdit && existing"
      v-show="wizard !== 1"
      ref="editor"
      :key="existing.id"
      :category="existing"
      :saving-form="saving"
      :scenarios-only="wizard === 2"
      :initial-step-id="initialStepId"
      @scope-change="sopScope = $event"
    />
    <section v-show="wizard === 3" :inert="saving">
      <fieldset v-if="!isEdit" class="mt-6">
        <legend class="text-sm font-medium text-stone-800">基本步驟</legend>
        <p class="mt-1 text-sm leading-6 text-stone-600">
          每個步驟可以附上零份或多份範本。上傳會先存進範本庫，並連結到該步驟。
        </p>
        <ol v-if="steps.length > 0" class="mt-4 space-y-4">
          <li
            v-for="(step, index) in steps"
            :key="step.key"
            class="rounded-2xl border border-edge bg-surface-muted p-4"
          >
            <label class="block text-xs text-ink-muted" :for="`category-step-${index}`">
              步驟 {{ index + 1 }}
            </label>
            <textarea
              :id="`category-step-${index}`"
              :value="step.body"
              rows="2"
              maxlength="500"
              class="field mt-2 w-full"
              :aria-invalid="invalidStepKey === step.key ? true : undefined"
              :aria-describedby="invalidStepKey === step.key ? `step-error-${step.key}` : undefined"
              @input="onStep(index, $event)"
            ></textarea>
            <p
              v-if="invalidStepKey === step.key"
              :id="`step-error-${step.key}`"
              ref="stepAlert"
              role="alert"
              tabindex="-1"
              class="mt-2 scroll-my-20 text-sm text-tone-danger-ink"
            >
              第 {{ index + 1 }} 個步驟還沒有填內容。
            </p>
            <label class="mt-3 block text-sm"
              >步驟內容（每行一項）<textarea
                v-model="step.items"
                rows="3"
                class="field mt-2 w-full"
              />
            </label>
            <label class="mt-3 block text-sm"
              >特別註記<textarea
                v-model="step.note"
                rows="2"
                maxlength="2000"
                class="field mt-2 w-full"
              />
            </label>
            <label class="mt-3 block text-sm"
              ><input v-model="step.canRunInParallel" type="checkbox" />
              此步驟可請其他人同步進行</label
            >
            <div class="mt-2 flex flex-wrap gap-3">
              <button
                type="button"
                class="btn-move text-sm"
                :disabled="index === 0"
                data-move="up"
                :aria-label="`${step.body || '步驟 ' + (index + 1)}：上移`"
                @click="moveStep(index, -1, $event.currentTarget as HTMLButtonElement)"
              >
                上移
              </button>
              <button
                type="button"
                class="btn-move text-sm"
                :disabled="index === steps.length - 1"
                data-move="down"
                :aria-label="`${step.body || '步驟 ' + (index + 1)}：下移`"
                @click="moveStep(index, 1, $event.currentTarget as HTMLButtonElement)"
              >
                下移
              </button>
              <button
                type="button"
                class="btn-ghost text-sm text-stone-600 hover:text-tone-danger-ink"
                @click="removeStep(index)"
              >
                移除
              </button>
            </div>

            <p v-if="step.templateIds.length === 0" class="mt-3 text-sm text-ink-muted">
              尚未連結範本。
            </p>
            <ol v-else class="mt-3 space-y-2">
              <li
                v-for="(templateId, templateIndex) in step.templateIds"
                :key="templateId"
                class="flex items-center justify-between gap-2 rounded-control bg-surface px-3 py-2"
              >
                <span class="min-w-0 break-all text-sm text-stone-800">
                  {{ templateIndex + 1 }}. {{ templateName(templateId) }}
                </span>
                <span class="flex shrink-0 gap-2">
                  <button
                    type="button"
                    class="btn-move text-sm"
                    :disabled="templateIndex === 0"
                    data-move="up"
                    :aria-label="`上移：${step.body || '步驟 ' + (index + 1)}的範本 ${templateName(templateId)}`"
                    @click="
                      moveTemplate(
                        index,
                        templateIndex,
                        -1,
                        $event.currentTarget as HTMLButtonElement,
                      )
                    "
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    class="btn-move text-sm"
                    :disabled="templateIndex === step.templateIds.length - 1"
                    data-move="down"
                    :aria-label="`下移：${step.body || '步驟 ' + (index + 1)}的範本 ${templateName(templateId)}`"
                    @click="
                      moveTemplate(
                        index,
                        templateIndex,
                        1,
                        $event.currentTarget as HTMLButtonElement,
                      )
                    "
                  >
                    下移
                  </button>
                </span>
              </li>
            </ol>

            <button
              type="button"
              class="btn-secondary mt-3"
              :aria-expanded="step.pickerOpen"
              @click="togglePicker(index)"
            >
              從範本庫選取
            </button>
            <div v-if="step.pickerOpen" class="mt-3 rounded-2xl border border-edge bg-surface p-4">
              <TemplatePicker
                v-model:query="step.query"
                :items="templates.items"
                :model-value="step.templateIds"
                :id-prefix="`picker-${step.key}`"
                @toggle="(id, checked) => toggleTemplate(index, id, checked)"
              >
                <template v-if="templates.items.length === 0" #empty>
                  範本庫還沒有文件。可先在下方上傳。
                </template>
              </TemplatePicker>
              <div class="mt-4">
                <FileDropzone
                  :enabled="true"
                  disabled-reason=""
                  title="上傳 Word 或 PDF 並連結到這個步驟"
                  hint="檔案會存進範本庫，並出現在這個步驟的範本清單。"
                  :accept="`.pdf,application/pdf,.docx,${docxMimeType}`"
                  :error="uploadErrors[step.key]"
                  @select="onUpload(step.key, $event)"
                />
              </div>
            </div>
          </li>
        </ol>
        <button type="button" class="btn-secondary mt-4" @click="addStep">新增步驟</button>
      </fieldset>
      <fieldset v-if="sopScope === 'base'" class="mt-6" aria-label="基本資料欄位">
        <legend class="font-semibold">基本資料欄位</legend>
        <div class="mt-3 flex flex-wrap items-center gap-3" aria-label="系統日期欄位">
          <span>日期</span>
          <button type="button" class="btn-ghost text-sm" disabled>移除欄位</button>
          <span class="text-xs text-ink-muted">日期為系統必要欄位</span>
        </div>
        <div
          v-if="builtinName && !fields.some((field) => fieldKey(field) === '姓名')"
          class="mt-3 flex items-center gap-3"
          aria-label="內建姓名欄位"
        >
          <span>姓名</span>
          <code v-text="'{{姓名}}'" />
          <button
            type="button"
            class="btn-ghost text-sm text-tone-danger-ink"
            @click="removeField('姓名')"
          >
            移除欄位
          </button>
        </div>
        <div v-for="field in manualFields" :key="field.id" class="mt-3 grid gap-2 sm:grid-cols-4">
          <input
            v-model="field.name"
            aria-label="欄位名稱"
            placeholder="名稱"
            maxlength="80"
            class="field"
          />
          <div class="flex items-center gap-2">
            <code class="break-all">{{ fieldPlaceholder(field) }}</code>
            <button
              type="button"
              class="btn-ghost shrink-0 text-sm text-accent-ink"
              :disabled="!fieldKey(field)"
              :aria-label="'複製 ' + fieldPlaceholder(field)"
              @click="copyPlaceholder(field)"
            >
              {{ copiedPlaceholder === fieldPlaceholder(field) ? '已複製' : '複製' }}
            </button>
          </div>
          <select v-model="field.type" aria-label="欄位型別" class="field">
            <option value="text">文字</option>
            <option value="number">數字</option>
          </select>
          <button
            type="button"
            class="btn-ghost text-sm text-tone-danger-ink"
            :disabled="fieldKey(field) === '日期'"
            @click="removeField(fieldKey(field), field)"
          >
            移除欄位
          </button>
        </div>
        <button
          type="button"
          class="btn-secondary mt-3 py-2"
          :disabled="fields.length >= 50"
          @click="fields.push({ id: newId(), name: '', key: '', type: 'text', scope: 'base' })"
        >
          新增欄位
        </button>
        <p class="sr-only" role="status">
          {{ copiedPlaceholder ? '已複製 ' + copiedPlaceholder : '' }}
        </p>
        <p v-if="copyError" class="mt-2 text-sm text-tone-danger-ink" role="alert">
          {{ copyError }}
        </p>
        <details class="mt-2 text-sm text-ink-muted">
          <summary class="focus-control cursor-pointer">怎麼寫欄位標記</summary>
          <p class="mt-2">
            Word 範本裡的欄位標記，寫法：<code>{{ fieldMarkerExample }}</code>
          </p>
          <p>已儲存的標記固定。修改欄位名稱只會更新顯示文字。</p>
          <p>手動新增的欄位在基本資料填寫，其他欄位在使用範本的步驟填寫。</p>
        </details>
      </fieldset>
      <p v-if="sopScope !== 'base'" class="mt-4 text-sm text-ink-muted">
        情境欄位由步驟所附 DOCX 的標記自動產生，在工作台對應步驟內填寫。
      </p>
      <section v-if="legacyFields.length" class="mt-6" aria-label="既有欄位定義（保留）">
        <h3 class="font-semibold">既有欄位定義（保留）</h3>
        <p class="mt-2 text-sm text-ink-muted">
          以下定義未對應基本步驟，保留原有名稱、型別及映射；情境欄位仍依 DOCX 自動顯示。
        </p>
        <ul class="mt-2 text-sm">
          <li v-for="field in legacyFields" :key="field.id">
            {{ field.name ?? field.key }} · <code v-text="'{{' + field.key + '}}'" /> ·
            {{ field.type }}
            <button
              type="button"
              class="btn-ghost text-sm text-tone-danger-ink"
              @click="removeField(fieldKey(field), field)"
            >
              移除欄位
            </button>
          </li>
        </ul>
        <p
          v-for="issue in legacyIssues"
          :key="issue"
          role="alert"
          class="mt-2 text-sm text-tone-danger-ink"
        >
          {{ issue }}
        </p>
      </section>
    </section>

    <p
      v-if="formNotice"
      class="mt-4 rounded-control bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950"
      role="status"
    >
      {{ formNotice }}
    </p>
    <div class="mt-6 flex flex-wrap gap-3">
      <button
        v-if="!isEdit && wizard > 1"
        :disabled="saving"
        type="button"
        class="btn-secondary py-2"
        @click="changeWizard(1)"
      >
        上一步
      </button>
      <button type="submit" class="btn-primary" :disabled="saving" :aria-busy="saving">
        <span v-if="saving" class="btn-spinner" aria-hidden="true"></span>
        {{ isEdit ? '儲存名稱與欄位' : wizard === 1 ? '下一步' : '建立案件範本' }}
      </button>
      <RouterLink :to="isEdit ? `/categories/${editingId}` : '/categories'" class="btn-secondary">
        取消
      </RouterLink>
      <p
        role="status"
        class="scroll-mb-20 self-center text-sm"
        :class="{ 'sr-only': !savedNotice }"
      >
        {{ savedNotice }}
      </p>
    </div>
  </form>
</template>
