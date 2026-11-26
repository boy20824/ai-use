<script setup lang="ts">
import { docxMimeType } from '../../shared/templateUpload'
import { computed, nextTick, ref, watch } from 'vue'
import { apiRequest, apiErrorMessage } from '@/services/api'
import { useCategoryStore } from '@/stores/categories'
import { useSessionStore } from '@/stores/session'
import { useTemplateStore } from '@/stores/templates'
import type { CaseCategory, CategoryStep, StepRef } from '@/types/domain'
import ConfirmDialog from './ConfirmDialog.vue'
import FileDropzone from './FileDropzone.vue'
import CombinationOrderEditor from './CombinationOrderEditor.vue'
import { restoreMoveFocus } from '@/utils/stepFocus'
import { displayFileName } from '@/utils/fileName'
const props = defineProps<{ category: CaseCategory; savingForm?: boolean }>()
const categories = useCategoryStore()
const session = useSessionStore()
const templates = useTemplateStore()
const error = ref('')
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
const base = () => `/api/categories/${encodeURIComponent(props.category.id)}`
async function request(path: string, method: string, body?: unknown) {
  const response = await apiRequest(base() + path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) throw new Error(await apiErrorMessage(response, '無法儲存設定。'))
  return response.status === 204 ? {} : await response.json()
}
async function run(action: () => Promise<void>) {
  if (busy.value) return false
  busy.value = true
  error.value = ''
  moduleStatus.value = ''
  savedStep.value = ''
  try {
    await action()
    await categories.reload()
    return true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '無法儲存設定。'
    return false
  } finally {
    busy.value = false
  }
}
function refPath(stepId: string) {
  return `/refs/${encodeURIComponent(scope.value)}/${encodeURIComponent(stepId)}`
}
async function putRef(stepId: string, sortOrder: number) {
  await request(refPath(stepId), 'PUT', { stepId, sortOrder })
}
function removeRef(ref: StepRef) {
  void run(async () => {
    await request(refPath(ref.stepId), 'DELETE')
  })
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
      moduleStatus.value = `已新增模組「${name.trim()}」`
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
  const m = activeModule.value
  if (!m) return
  const name = window.prompt('情境名稱', m.name)
  if (name?.trim())
    void run(async () => {
      await request(`/modules/${m.id}`, 'PATCH', { name, sortOrder: m.sortOrder })
    })
}
function moveModule(delta: number) {
  const modules = [...(props.category.modules ?? [])]
  const index = modules.findIndex((m) => `module:${m.id}` === scope.value)
  const target = index + delta
  if (target < 0 || target >= modules.length) return
  const [item] = modules.splice(index, 1)
  if (!item) return
  modules.splice(target, 0, item)
  void run(async () => {
    await request('/order/modules', 'PUT', { ids: modules.map((m) => m.id) })
  })
}
function deleteModule() {
  const m = activeModule.value
  if (
    !m ||
    dirtyStep.value ||
    !window.confirm(
      `刪除情境「${m.name}」後，這些步驟將從此情境移除：\n${m.steps
        .map((r) => {
          const s = stepFor(r.stepId)
          return `${s?.title ?? s?.body}（${s?.templateIds.map((id) => displayFileName(templates.byId(id)?.fileName ?? '範本')).join('、') || '無文件'}）`
        })
        .join('\n')}\n共用步驟與文件會保留。`,
    )
  )
    return
  void run(async () => {
    await request(`/modules/${m.id}`, 'DELETE', { confirm: true })
    void closeEditor(false)
    scope.value = 'base'
    savedStep.value = ''
  })
}
function openEditor(button: HTMLButtonElement, step?: CategoryStep) {
  requestEditorAction(() => void edit(button, step))
}
async function edit(button: HTMLButtonElement, step?: CategoryStep) {
  newStepId = ''
  editing.value = step ?? { id: '', body: '', templateIds: [] }
  const draft = editing.value
  opener = button
  savedStep.value = ''
  moduleStatus.value = ''
  error.value = ''
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
    if (editing.value === draft)
      error.value = cause instanceof Error ? cause.message : '無法讀取步驟使用位置。'
  }
}
let newStepId = ''
async function saveStep(restoreFocus = true) {
  if (!editing.value || busy.value) return false
  if (!title.value.trim()) {
    error.value = '請填寫步驟名稱。'
    titleInput.value?.focus()
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
      await putRef(
        newStepId,
        current?.sortOrder ??
          (refs.value.length ? Math.max(...refs.value.map((r) => r.sortOrder)) + 1 : 0),
      )
      if (scope.value !== 'base')
        await request(`/refs/base/${encodeURIComponent(newStepId)}`, 'DELETE')
    }
  })
  if (!saved) {
    await nextTick()
    titleInput.value?.focus()
    return false
  }
  savedStep.value = step.id || 'new'
  await closeEditor(restoreFocus)
  return true
}
function dismissConfirmation() {
  pendingEditorAction.value = null
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
    if (result.rejected.length) throw new Error(result.rejected.join('。'))
  })
}
</script>

<template>
  <div class="grid items-start gap-5 xl:grid-cols-2">
    <fieldset :disabled="busy || savingForm" class="min-w-0 space-y-5">
      <section aria-label="基本步驟">
        <h2 class="font-semibold">基本步驟</h2>
        <button type="button" class="btn-secondary mt-2" @click="switchScope('base')">
          維護基本步驟
        </button>
      </section>
      <section aria-label="情境">
        <h2 class="font-semibold">情境</h2>
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
      </section>
      <section class="scroll-mt-20 scroll-mb-20 space-y-3 rounded-2xl border border-edge p-4">
        <h3 class="font-semibold">{{ scope === 'base' ? '基本步驟' : activeModule?.name }}</h3>
        <div v-if="activeModule" class="flex flex-wrap gap-2">
          <button type="button" class="btn-ghost" @click="renameModule">編輯情境</button>
          <button type="button" class="btn-ghost" @click="moveModule(-1)">情境上移</button
          ><button type="button" class="btn-ghost" @click="moveModule(1)">情境下移</button>
          <button
            v-if="session.isSysadmin"
            type="button"
            class="btn-ghost"
            :disabled="dirtyStep"
            @click="deleteModule"
          >
            刪除這個情境
          </button>
        </div>
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
                @click="openEditor($event.currentTarget as HTMLButtonElement, stepFor(r.stepId))"
              >
                編輯這個步驟
              </button>
              <button
                type="button"
                class="btn-ghost"
                :disabled="i === 0"
                :aria-label="`${stepFor(r.stepId)?.title ?? stepFor(r.stepId)?.body}：上移`"
                data-move="up"
                @click="moveRef(i, -1, $event.currentTarget as HTMLButtonElement)"
              >
                上移</button
              ><button
                type="button"
                class="btn-ghost"
                :disabled="i === orderedRefs.length - 1"
                data-move="down"
                :aria-label="`${stepFor(r.stepId)?.title ?? stepFor(r.stepId)?.body}：下移`"
                @click="moveRef(i, 1, $event.currentTarget as HTMLButtonElement)"
              >
                下移
              </button>
              <button type="button" class="btn-ghost" @click="removeRef(r)">
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
        class="space-y-3 rounded-2xl border border-edge p-4"
        @keydown.esc.stop.prevent="cancelEditor"
      >
        <h3 ref="editorHeading" class="scroll-mt-20">編輯步驟（儲存後立即生效）</h3>
        <p>{{ locations }}</p>
        <label class="block"
          >步驟名稱<input ref="titleInput" v-model="title" maxlength="500" class="field w-full"
        /></label>
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
          <label v-for="t in templates.items" :key="t.id" class="block"
            ><input v-model="templateIds" type="checkbox" :value="t.id" />
            {{ displayFileName(t.fileName)
            }}<span v-if="t.kind === 'pdf'" class="ml-2 text-xs text-ink-muted"
              >參考文件</span
            ></label
          >
          <ol>
            <li v-for="(id, i) in templateIds" :key="id">
              {{ displayFileName(templates.byId(id)?.fileName ?? '範本')
              }}<span v-if="templates.byId(id)?.kind === 'pdf'" class="ml-2 text-xs text-ink-muted"
                >參考文件</span
              >
              <button
                v-if="i"
                type="button"
                class="btn-ghost"
                @click="templateIds.splice(i - 1, 0, templateIds.splice(i, 1)[0]!)"
              >
                上移
              </button>
            </li>
          </ol>
        </fieldset>
        <FileDropzone
          :enabled="true"
          disabled-reason=""
          title="上傳 Word 或 PDF 範本"
          hint="存入既有範本庫"
          :accept="`.docx,.pdf,${docxMimeType},application/pdf`"
          @select="upload"
        />
        <button type="button" class="btn-secondary" @click="saveStep()">儲存這個步驟</button
        ><button type="button" class="btn-ghost" @click="cancelEditor">取消</button>
      </section>
      <p v-if="error" role="alert" class="text-tone-danger-ink">{{ error }}</p>
    </fieldset>
    <CombinationOrderEditor
      ref="orderEditor"
      :key="category.id"
      :category="category"
      managed-by-form
    />
    <ConfirmDialog
      v-if="pendingEditorAction"
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
