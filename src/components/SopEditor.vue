<script setup lang="ts">
import { docxMimeType } from '../../shared/templateUpload'
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import { apiRequest, apiErrorMessage } from '@/services/api'
import { useCategoryStore } from '@/stores/categories'
import { useSessionStore } from '@/stores/session'
import { useTemplateStore } from '@/stores/templates'
import type { CaseCategory, CategoryModule, CategoryStep, StepRef } from '@/types/domain'
import ConfirmDialog from './ConfirmDialog.vue'
import FileDropzone from './FileDropzone.vue'
import TemplatePicker from './TemplatePicker.vue'
import CombinationOrderEditor from './CombinationOrderEditor.vue'
import { focusAlert } from '@/utils/focusAlert'
import { restoreMoveFocus } from '@/utils/stepFocus'
import { displayFileName } from '@/utils/fileName'
const props = defineProps<{
  category: CaseCategory
  savingForm?: boolean
  scenariosOnly?: boolean
  initialStepId?: string
}>()
const categories = useCategoryStore()
const session = useSessionStore()
const templates = useTemplateStore()
const error = ref('')
const errorAlert = ref<HTMLElement | null>(null)
const titleError = ref('')
const titleAlert = ref<HTMLElement | null>(null)
const uploadError = ref('')
const titleErrorId = useId()
const templatePickerId = `sop-picker-${useId()}`
const existingStepSelect = ref<HTMLSelectElement | null>(null)
const selectedStepId = ref('')
const scopePanel = ref<HTMLElement | null>(null)
const scenarioHeading = ref<HTMLElement | null>(null)
const pendingRemoval = ref<StepRef | null>(null)
const pendingRename = ref<CategoryModule | null>(null)
const pendingModuleDelete = ref<CategoryModule | null>(null)
const renameValue = ref('')
const renameButton = ref<HTMLButtonElement | null>(null)
const busy = ref(false)
const scope = ref('base')
const emit = defineEmits<{ scopeChange: [scope: string] }>()
watch(scope, (value) => emit('scopeChange', value), { immediate: true })
const editing = ref<CategoryStep | null>(null)
const title = ref('')
const items = ref('')
const note = ref('')
const canRunInParallel = ref(false)
const templateIds = ref<string[]>([])
const locations = ref('')
const moduleName = ref('')
const orderEditor = ref<InstanceType<typeof CombinationOrderEditor> | null>(null)
const editorHeading = ref<HTMLElement | null>(null)
const titleInput = ref<HTMLInputElement | null>(null)
const addStepButton = ref<HTMLButtonElement | null>(null)
const moduleButton = ref<HTMLButtonElement | null>(null)
const moduleStatus = ref('')
const savedStep = ref('')
const baseline = ref('')
const dirtyStep = computed(() => editing.value !== null && stepSnapshot() !== baseline.value)
const hasDraft = computed(() => dirtyStep.value || !!moduleName.value || !!orderEditor.value?.dirty)
const isBusy = computed(() => busy.value || !!orderEditor.value?.busy)
const pendingEditorAction = ref<(() => void) | null>(null)
let opener: HTMLButtonElement | null = null

function stepSnapshot() {
  return JSON.stringify([
    title.value,
    items.value,
    note.value,
    canRunInParallel.value,
    templateIds.value,
  ])
}
function requestEditorAction(action: () => void) {
  if (isBusy.value || props.savingForm) return
  if (dirtyStep.value) pendingEditorAction.value = action
  else action()
}
function confirmEditorAction() {
  const action = pendingEditorAction.value
  pendingEditorAction.value = null
  action?.()
}
function switchScope(value: string) {
  if (scope.value === value) return
  requestEditorAction(() => {
    void closeEditor(false)
    scope.value = value
    selectedStepId.value = ''
    savedStep.value = ''
    moduleStatus.value = ''
  })
}
async function closeEditor(restoreFocus = true) {
  editing.value = null
  if (!restoreFocus) return
  await nextTick()
  const target = opener?.isConnected ? opener : addStepButton.value
  target?.focus()
  const status =
    target?.closest('li')?.querySelector('[role="status"]') ??
    addStepButton.value?.nextElementSibling
  const visibleTarget = status?.textContent?.trim() ? status : target
  visibleTarget?.scrollIntoView({ block: 'nearest' })
}
function cancelEditor() {
  requestEditorAction(() => void closeEditor())
}
const activeModule = computed(() =>
  props.category.modules?.find((m) => `module:${m.id}` === scope.value),
)
const refs = computed(() =>
  scope.value === 'base' ? (props.category.baseSteps ?? []) : (activeModule.value?.steps ?? []),
)
const orderedRefs = computed(() =>
  [...refs.value].sort(
    (a, b) => a.sortOrder - b.sortOrder || (a.stepId < b.stepId ? -1 : a.stepId > b.stepId ? 1 : 0),
  ),
)
const stepFor = (id: string) => props.category.steps.find((s) => s.id === id)
const stepName = (id: string) => stepFor(id)?.title ?? stepFor(id)?.body ?? '步驟'
const availableSteps = computed(() =>
  props.category.steps.filter((step) => !refs.value.some((ref) => ref.stepId === step.id)),
)
const moduleIndex = computed(
  () => props.category.modules?.findIndex((m) => m === activeModule.value) ?? -1,
)
function nextSortOrder() {
  return refs.value.length ? Math.max(...refs.value.map((ref) => ref.sortOrder)) + 1 : 0
}
const base = () => `/api/categories/${encodeURIComponent(props.category.id)}`
async function request(path: string, method: string, body?: unknown) {
  const response = await apiRequest(base() + path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) throw new Error(await apiErrorMessage(response, '無法儲存設定。'))
  return response.status === 204 ? {} : await response.json()
}
async function run(action: () => Promise<void>, errorTarget = error) {
  if (busy.value) return false
  busy.value = true
  error.value = ''
  errorTarget.value = ''
  moduleStatus.value = ''
  savedStep.value = ''
  try {
    await action()
    await categories.reload()
    return true
  } catch (cause) {
    errorTarget.value = cause instanceof Error ? cause.message : '無法儲存設定。'
    return false
  } finally {
    busy.value = false
    if (error.value) {
      await nextTick()
      focusAlert(errorAlert.value)
    }
  }
}
function refPath(stepId: string) {
  return `/refs/${encodeURIComponent(scope.value)}/${encodeURIComponent(stepId)}`
}
async function putRef(stepId: string, sortOrder: number) {
  await request(refPath(stepId), 'PUT', { stepId, sortOrder })
}
async function removeRef() {
  const item = pendingRemoval.value
  if (!item) return
  pendingRemoval.value = null
  const removed = await run(async () => {
    await request(refPath(item.stepId), 'DELETE')
    if (editing.value?.id === item.stepId) void closeEditor(false)
  })
  if (removed) {
    await nextTick()
    ;(existingStepSelect.value ?? addStepButton.value)?.focus()
  }
}
async function addExistingStep() {
  const id = selectedStepId.value
  if (!availableSteps.value.some((step) => step.id === id)) return
  const added = await run(() => putRef(id, nextSortOrder()))
  if (added) {
    selectedStepId.value = ''
    await nextTick()
    stepEditButton(id)?.focus()
  }
}
async function moveRef(index: number, delta: number, button: HTMLButtonElement) {
  const order = [...orderedRefs.value]
  const target = index + delta
  if (target < 0 || target >= order.length) return
  const [item] = order.splice(index, 1)
  if (!item) return
  order.splice(target, 0, item)
  await run(async () => {
    await request(`/order/${encodeURIComponent(scope.value)}`, 'PUT', {
      ids: order.map((r) => r.stepId),
    })
  })
  await restoreMoveFocus(button)
}
function createModule() {
  const name = moduleName.value
  if (!name.trim()) return
  requestEditorAction(() => {
    const button = moduleButton.value
    const restoreFocus = button === document.activeElement
    void run(async () => {
      const id = crypto.randomUUID()
      await request(`/modules/${id}`, 'POST', {
        name,
        sortOrder: props.category.modules?.length ?? 0,
      })
      void closeEditor(false)
      scope.value = `module:${id}`
      savedStep.value = ''
      moduleName.value = ''
      moduleStatus.value = `已新增情境「${name.trim()}」`
    }).then(async () => {
      await nextTick()
      if (restoreFocus && document.activeElement === document.body) button?.focus()
      if (moduleStatus.value && document.activeElement === button) {
        button?.parentElement?.nextElementSibling?.scrollIntoView({ block: 'nearest' })
      }
    })
  })
}
function renameModule() {
  const module = activeModule.value
  if (!module) return
  renameValue.value = module.name
  pendingRename.value = module
}
async function saveModuleName() {
  const module = pendingRename.value
  const name = renameValue.value.trim()
  if (!module || !name) return
  pendingRename.value = null
  const saved = await run(async () => {
    await request(`/modules/${module.id}`, 'PATCH', { name, sortOrder: module.sortOrder })
  })
  if (saved) {
    await nextTick()
    if (document.activeElement === document.body) renameButton.value?.focus()
  }
}
function submitRename(event: KeyboardEvent) {
  if (event.isComposing) return
  event.preventDefault()
  void saveModuleName()
}
async function moveModule(delta: number, button: HTMLButtonElement) {
  const modules = [...(props.category.modules ?? [])]
  const index = moduleIndex.value
  const target = index + delta
  if (target < 0 || target >= modules.length) return
  const [item] = modules.splice(index, 1)
  if (!item) return
  modules.splice(target, 0, item)
  await run(async () => {
    await request('/order/modules', 'PUT', { ids: modules.map((m) => m.id) })
  })
  await restoreMoveFocus(button)
}
async function deleteModule() {
  const module = pendingModuleDelete.value
  pendingModuleDelete.value = null
  if (!module || !session.isSysadmin || dirtyStep.value) return
  const deleted = await run(async () => {
    await request(`/modules/${module.id}`, 'DELETE', { confirm: true })
    void closeEditor(false)
    scope.value = 'base'
    selectedStepId.value = ''
  })
  if (deleted) {
    await nextTick()
    scenarioHeading.value?.focus()
  }
}
function stepEditButton(id: string) {
  return [
    ...(scopePanel.value?.querySelectorAll<HTMLButtonElement>('[data-edit-step]') ?? []),
  ].find((button) => button.dataset.editStep === id)
}
onMounted(async () => {
  const id = props.initialStepId
  if (!id) return
  const step = stepFor(id)
  if (!step) return
  if (!refs.value.some((ref) => ref.stepId === id)) {
    const module = props.category.modules?.find((m) => m.steps.some((ref) => ref.stepId === id))
    if (module) scope.value = `module:${module.id}`
  }
  await nextTick()
  void edit(stepEditButton(id) ?? null, step)
})
function openEditor(button: HTMLButtonElement, step?: CategoryStep) {
  requestEditorAction(() => void edit(button, step))
}
async function edit(button: HTMLButtonElement | null, step?: CategoryStep) {
  newStepId = ''
  editing.value = step ?? { id: '', body: '', templateIds: [] }
  const draft = editing.value
  opener = button
  savedStep.value = ''
  moduleStatus.value = ''
  error.value = ''
  titleError.value = ''
  uploadError.value = ''
  title.value = step?.title ?? step?.body ?? ''
  items.value = (step?.items ?? []).join('\n')
  note.value = step?.note ?? ''
  canRunInParallel.value = step?.canRunInParallel ?? false
  templateIds.value = [...(step?.templateIds ?? [])]
  locations.value = ''
  baseline.value = stepSnapshot()
  await nextTick()
  editorHeading.value?.scrollIntoView({ block: 'start' })
  titleInput.value?.focus({ preventScroll: true })
  if (!step) return
  try {
    const { impact } = await request(`/steps/${encodeURIComponent(step.id)}/impact`, 'GET')
    if (editing.value === draft) {
      locations.value = `這個步驟用在：基本步驟 ${impact.base.length} 處、情境 ${impact.modules.length} 處`
    }
  } catch (cause) {
    if (editing.value !== draft) return
    error.value = cause instanceof Error ? cause.message : '無法讀取步驟使用位置。'
  }
}
let newStepId = ''
async function saveStep(restoreFocus = true) {
  if (!editing.value || busy.value) return false
  if (!title.value.trim()) {
    const index = orderedRefs.value.findIndex((ref) => ref.stepId === editing.value?.id)
    titleError.value = `第 ${index < 0 ? orderedRefs.value.length + 1 : index + 1} 個步驟還沒有填內容。請填寫步驟名稱。`
    await nextTick()
    focusAlert(titleAlert.value)
    return false
  }
  const step = editing.value
  const data = {
    title: title.value,
    body: title.value,
    items: items.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    note: note.value,
    canRunInParallel: canRunInParallel.value,
    templateIds: templateIds.value,
  }
  const saved = await run(async () => {
    const id = step.id || newStepId
    const result = await request(
      id ? `/steps/${encodeURIComponent(id)}` : '/steps',
      id ? 'PATCH' : 'POST',
      data,
    )
    if (!step.id) {
      // The server adds a new step to the base list. Continue wiring the same
      // step if a later request fails and the editor retries.
      newStepId ||= result.step.id as string
      const current = refs.value.find((ref) => ref.stepId === newStepId)
      await putRef(newStepId, current?.sortOrder ?? nextSortOrder())
      if (scope.value !== 'base')
        await request(`/refs/base/${encodeURIComponent(newStepId)}`, 'DELETE')
    }
  })
  if (!saved) return false
  savedStep.value = step.id || 'new'
  await closeEditor(restoreFocus)
  return true
}
function dismissConfirmation() {
  pendingEditorAction.value = null
  pendingRemoval.value = null
  pendingRename.value = null
  pendingModuleDelete.value = null
  orderEditor.value?.dismissConfirmation()
}
defineExpose({
  dirtyStep,
  hasDraft,
  isBusy,
  saveStep,
  discardStep: closeEditor,
  dismissConfirmation,
})
async function upload(files: File[]) {
  await run(async () => {
    const result = await templates.addFiles(files, editing.value?.id || undefined)
    templateIds.value = [...new Set([...templateIds.value, ...result.ids])]
    uploadError.value =
      result.rejected.join('。') || (result.ids.length ? '' : '沒有可保存的 Word 或 PDF 範本。')
  }, uploadError)
}
function moveTemplate(index: number, delta: number, button: HTMLButtonElement) {
  const target = index + delta
  if (target < 0 || target >= templateIds.value.length) return
  const [id] = templateIds.value.splice(index, 1)
  if (!id) return
  templateIds.value.splice(target, 0, id)
  void restoreMoveFocus(button)
}
</script>

<template>
  <div class="grid items-start gap-5 xl:grid-cols-2">
    <fieldset :disabled="busy || savingForm" class="min-w-0 space-y-5">
      <p
        v-if="error"
        ref="errorAlert"
        role="alert"
        tabindex="-1"
        class="scroll-my-20 text-tone-danger-ink"
      >
        {{ error }}
      </p>
      <section v-show="!scenariosOnly" aria-label="基本步驟">
        <h2 class="font-semibold">基本步驟</h2>
        <button type="button" class="btn-secondary mt-2" @click="switchScope('base')">
          維護基本步驟
        </button>
      </section>
      <section aria-label="情境">
        <h2 ref="scenarioHeading" tabindex="-1" class="font-semibold">情境</h2>
        <div class="mt-2 flex flex-wrap gap-2">
          <button
            v-for="m in category.modules"
            :key="m.id"
            type="button"
            class="btn-secondary"
            :aria-pressed="scope === `module:${m.id}`"
            @click="switchScope(`module:${m.id}`)"
          >
            {{ m.name }}
          </button>
        </div>
        <div class="mt-2 flex gap-2">
          <input
            v-model="moduleName"
            aria-label="情境名稱"
            maxlength="80"
            class="field min-w-0"
          /><button
            type="button"
            ref="moduleButton"
            class="btn-secondary shrink-0"
            @click="createModule"
          >
            新增情境
          </button>
        </div>
        <p
          role="status"
          class="mt-2 scroll-mb-20 text-sm [overflow-wrap:anywhere]"
          :class="{ 'sr-only': !moduleStatus }"
        >
          {{ moduleStatus }}
        </p>
        <div v-if="activeModule" class="mt-2 flex flex-wrap gap-2">
          <button ref="renameButton" type="button" class="btn-ghost" @click="renameModule">
            編輯情境
          </button>
          <button
            type="button"
            class="btn-move"
            data-move="up"
            :disabled="moduleIndex <= 0"
            :aria-label="`上移：${activeModule.name}`"
            @click="moveModule(-1, $event.currentTarget as HTMLButtonElement)"
          >
            情境上移
          </button>
          <button
            type="button"
            class="btn-move"
            data-move="down"
            :disabled="moduleIndex === (category.modules?.length ?? 0) - 1"
            :aria-label="`下移：${activeModule.name}`"
            @click="moveModule(1, $event.currentTarget as HTMLButtonElement)"
          >
            情境下移
          </button>
          <button
            v-if="session.isSysadmin"
            type="button"
            class="btn-ghost"
            :disabled="dirtyStep"
            @click="pendingModuleDelete = activeModule"
          >
            刪除這個情境
          </button>
        </div>
      </section>
      <section
        v-show="!scenariosOnly"
        ref="scopePanel"
        class="scroll-mt-20 scroll-mb-20 space-y-3 rounded-2xl border border-edge p-4"
      >
        <h3 class="font-semibold">{{ scope === 'base' ? '基本步驟' : activeModule?.name }}</h3>
        <ol class="space-y-3">
          <li
            v-for="(r, i) in orderedRefs"
            :key="r.stepId"
            class="scroll-mt-20 scroll-mb-20 rounded-control bg-surface-muted p-3"
          >
            <p>{{ stepFor(r.stepId)?.title ?? stepFor(r.stepId)?.body }}</p>
            <p v-if="stepFor(r.stepId)?.canRunInParallel" class="text-sm">
              此步驟可請其他人同步進行
            </p>
            <p class="text-xs">
              {{
                stepFor(r.stepId)
                  ?.templateIds.map((id) => displayFileName(templates.byId(id)?.fileName ?? '範本'))
                  .join('、')
              }}
            </p>
            <div class="flex flex-wrap gap-3">
              <button
                type="button"
                class="btn-ghost scroll-mt-20 scroll-mb-20"
                :data-edit-step="r.stepId"
                @click="openEditor($event.currentTarget as HTMLButtonElement, stepFor(r.stepId))"
              >
                編輯這個步驟
              </button>
              <button
                type="button"
                class="btn-move"
                :disabled="i === 0"
                :aria-label="`上移：${stepName(r.stepId)}`"
                data-move="up"
                @click="moveRef(i, -1, $event.currentTarget as HTMLButtonElement)"
              >
                上移</button
              ><button
                type="button"
                class="btn-move"
                :disabled="i === orderedRefs.length - 1"
                data-move="down"
                :aria-label="`下移：${stepName(r.stepId)}`"
                @click="moveRef(i, 1, $event.currentTarget as HTMLButtonElement)"
              >
                下移
              </button>
              <button
                type="button"
                class="btn-ghost"
                @click="pendingRemoval = r"
                :disabled="dirtyStep && editing?.id === r.stepId"
              >
                從這裡拿掉（步驟本身還在）
              </button>
            </div>
            <p
              role="status"
              class="scroll-mb-20 text-sm"
              :class="{ 'sr-only': savedStep !== r.stepId }"
            >
              {{ savedStep === r.stepId ? '已儲存' : '' }}
            </p>
          </li>
        </ol>
        <div v-if="availableSteps.length" class="flex flex-wrap items-end gap-2">
          <label class="block min-w-0">
            <span class="block text-sm">既有步驟</span>
            <select v-model="selectedStepId" ref="existingStepSelect" class="field max-w-full">
              <option disabled value="">選擇步驟</option>
              <option v-for="step in availableSteps" :key="step.id" :value="step.id">
                {{ stepName(step.id) }}
              </option>
            </select>
          </label>
          <button
            type="button"
            class="btn-secondary"
            :disabled="!selectedStepId"
            @click="addExistingStep"
          >
            加回既有步驟
          </button>
        </div>
        <button
          ref="addStepButton"
          type="button"
          class="btn-secondary scroll-mt-20 scroll-mb-20"
          @click="openEditor($event.currentTarget as HTMLButtonElement)"
        >
          新增步驟
        </button>
        <p role="status" class="scroll-mb-20 text-sm" :class="{ 'sr-only': savedStep !== 'new' }">
          {{ savedStep === 'new' ? '已儲存' : '' }}
        </p>
      </section>
      <section
        v-if="editing"
        v-show="!scenariosOnly"
        class="space-y-3 rounded-2xl border border-edge p-4"
        @keydown.esc.stop.prevent="cancelEditor"
      >
        <h3 ref="editorHeading" class="scroll-mt-20">編輯步驟（儲存後立即生效）</h3>
        <p>{{ locations }}</p>
        <label class="block"
          >步驟名稱<input
            ref="titleInput"
            v-model="title"
            maxlength="500"
            class="field w-full"
            required
            :aria-invalid="titleError ? true : undefined"
            :aria-describedby="titleError ? titleErrorId : undefined"
            @input="titleError = ''"
        /></label>
        <p
          v-if="titleError"
          :id="titleErrorId"
          ref="titleAlert"
          role="alert"
          tabindex="-1"
          class="scroll-my-20 text-sm text-tone-danger-ink"
        >
          {{ titleError }}
        </p>
        <label class="block"
          >步驟內容（每行一項）<textarea v-model="items" class="field w-full" />
        </label>
        <label class="block"
          >特別註記<textarea v-model="note" maxlength="2000" class="field w-full" />
        </label>
        <label class="block"
          ><input v-model="canRunInParallel" type="checkbox" /> 此步驟可請其他人同步進行</label
        >
        <fieldset>
          <legend>關聯文件（沿用範本庫）</legend>
          <TemplatePicker
            :key="editing.id"
            v-model="templateIds"
            :items="templates.items"
            :id-prefix="templatePickerId"
          />
          <ol>
            <li v-for="(id, i) in templateIds" :key="id">
              {{ displayFileName(templates.byId(id)?.fileName ?? '範本')
              }}<span v-if="templates.byId(id)?.kind === 'pdf'" class="ml-2 text-xs text-ink-muted"
                >參考文件</span
              >
              <div class="inline-flex gap-2">
                <button
                  type="button"
                  class="btn-move"
                  :disabled="i === 0"
                  data-move="up"
                  :aria-label="`上移：${title || '步驟'}的範本 ${displayFileName(templates.byId(id)?.fileName ?? '範本')}`"
                  @click="moveTemplate(i, -1, $event.currentTarget as HTMLButtonElement)"
                >
                  上移
                </button>
                <button
                  type="button"
                  class="btn-move"
                  :disabled="i === templateIds.length - 1"
                  data-move="down"
                  :aria-label="`下移：${title || '步驟'}的範本 ${displayFileName(templates.byId(id)?.fileName ?? '範本')}`"
                  @click="moveTemplate(i, 1, $event.currentTarget as HTMLButtonElement)"
                >
                  下移
                </button>
              </div>
            </li>
          </ol>
        </fieldset>
        <FileDropzone
          :enabled="true"
          disabled-reason=""
          title="上傳 Word 或 PDF 範本"
          hint="存入既有範本庫"
          :accept="`.docx,.pdf,${docxMimeType},application/pdf`"
          :error="uploadError"
          @select="upload"
        />
        <button type="button" class="btn-secondary" @click="saveStep()">儲存這個步驟</button
        ><button type="button" class="btn-ghost" @click="cancelEditor">取消</button>
      </section>
    </fieldset>
    <CombinationOrderEditor
      v-show="!scenariosOnly"
      ref="orderEditor"
      :key="category.id"
      :category="category"
      managed-by-form
    />
    <ConfirmDialog
      v-if="pendingRemoval"
      title="從這裡拿掉這個步驟？"
      confirm-label="從這裡拿掉"
      tone="danger"
      @confirm="removeRef"
      @cancel="pendingRemoval = null"
    >
      「{{ stepName(pendingRemoval.stepId) }}」會從{{
        scope === 'base' ? '基本步驟' : `「${activeModule?.name}」`
      }}拿掉。步驟與範本會保留，可以再加回來。
    </ConfirmDialog>
    <ConfirmDialog
      v-else-if="pendingRename"
      title="編輯情境名稱"
      confirm-label="儲存情境名稱"
      :busy="!renameValue.trim()"
      @confirm="saveModuleName"
      @cancel="pendingRename = null"
    >
      <label class="block">
        情境名稱
        <input
          v-model="renameValue"
          class="field mt-2 w-full"
          maxlength="80"
          data-dialog-initial-focus
          @keydown.enter.stop="submitRename"
        />
      </label>
    </ConfirmDialog>
    <ConfirmDialog
      v-else-if="pendingModuleDelete"
      title="刪除這個情境？"
      confirm-label="刪除這個情境"
      cancel-label="取消"
      tone="danger"
      @confirm="deleteModule"
      @cancel="pendingModuleDelete = null"
    >
      「{{ pendingModuleDelete.name }}」會從這個案件範本移除。步驟與範本會保留。
    </ConfirmDialog>
    <ConfirmDialog
      v-else-if="pendingEditorAction"
      title="放棄未儲存的修改？"
      confirm-label="放棄修改"
      cancel-label="繼續編輯"
      @confirm="confirmEditorAction"
      @cancel="pendingEditorAction = null"
    >
      步驟修改尚未儲存。
    </ConfirmDialog>
  </div>
</template>
