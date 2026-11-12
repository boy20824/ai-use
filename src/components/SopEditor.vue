<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { apiRequest, apiErrorMessage } from '@/services/api'
import { useCategoryStore } from '@/stores/categories'
import { useSessionStore } from '@/stores/session'
import { useTemplateStore } from '@/stores/templates'
import type { CaseCategory, CategoryStep, StepRef } from '@/types/domain'
import FileDropzone from './FileDropzone.vue'
import CombinationOrderEditor from './CombinationOrderEditor.vue'
import { displayFileName } from '@/utils/fileName'
const props = defineProps<{ category: CaseCategory }>()
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
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await action()
    await categories.reload()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '無法儲存設定。'
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
function moveRef(index: number, delta: number) {
  const order = [...orderedRefs.value]
  const target = index + delta
  if (target < 0 || target >= order.length) return
  const [item] = order.splice(index, 1)
  if (!item) return
  order.splice(target, 0, item)
  void run(async () => {
    await request(`/order/${encodeURIComponent(scope.value)}`, 'PUT', {
      ids: order.map((r) => r.stepId),
    })
  })
}
function createModule() {
  if (moduleName.value.trim())
    void run(async () => {
      const id = crypto.randomUUID()
      await request(`/modules/${id}`, 'POST', {
        name: moduleName.value,
        sortOrder: props.category.modules?.length ?? 0,
      })
      scope.value = `module:${id}`
      moduleName.value = ''
    })
}
function renameModule() {
  const m = activeModule.value
  if (!m) return
  const name = window.prompt('模組名稱', m.name)
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
    !window.confirm(
      `案類：${props.category.name}\n刪除模組「${m.name}」及下列引用：\n${m.steps
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
    scope.value = 'base'
  })
}
async function edit(step?: CategoryStep) {
  editing.value = step ?? { id: '', body: '', templateIds: [] }
  title.value = step?.title ?? step?.body ?? ''
  items.value = (step?.items ?? []).join('\n')
  note.value = step?.note ?? ''
  canRunInParallel.value = step?.canRunInParallel ?? false
  templateIds.value = [...(step?.templateIds ?? [])]
  locations.value = ''
  if (step)
    await run(async () => {
      const body = await request(`/steps/${encodeURIComponent(step.id)}/impact`, 'GET')
      locations.value = `基本 SOP：${body.impact.base.length} 處；模組：${body.impact.modules.map((m: { name: string }) => m.name).join('、') || '無'}`
    })
}
function saveStep() {
  if (!editing.value || !title.value.trim()) return
  const step = editing.value
  void run(async () => {
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
    const result = await request(
      step.id ? `/steps/${encodeURIComponent(step.id)}` : '/steps',
      step.id ? 'PATCH' : 'POST',
      data,
    )
    if (!step.id) {
      // Existing step creation gives a base ref. Move it explicitly when adding to a module.
      const id = result.step.id as string
      await putRef(id, refs.value.length ? Math.max(...refs.value.map((r) => r.sortOrder)) + 1 : 0)
      if (scope.value !== 'base') await request(`/refs/base/${encodeURIComponent(id)}`, 'DELETE')
    }
    editing.value = null
  })
}
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
    <fieldset :disabled="busy" class="space-y-5">
      <section aria-label="基本 SOP">
        <h2 class="font-semibold">基本 SOP</h2>
        <button type="button" class="btn-secondary mt-2" @click="scope = 'base'">
          維護基本 SOP
        </button>
      </section>
      <section aria-label="情境模組">
        <h2 class="font-semibold">情境模組</h2>
        <div class="mt-2 flex flex-wrap gap-2">
          <button
            v-for="m in category.modules"
            :key="m.id"
            type="button"
            class="btn-secondary"
            :aria-pressed="scope === `module:${m.id}`"
            @click="scope = `module:${m.id}`"
          >
            {{ m.name }}
          </button>
        </div>
        <div class="mt-2 flex gap-2">
          <input v-model="moduleName" aria-label="模組名稱" maxlength="80" class="field" /><button
            type="button"
            class="btn-secondary"
            @click="createModule"
          >
            新增模組
          </button>
        </div>
      </section>
      <section class="space-y-3 rounded-2xl border border-edge p-4">
        <h3 class="font-semibold">{{ scope === 'base' ? '基本 SOP' : activeModule?.name }}</h3>
        <div v-if="activeModule" class="flex flex-wrap gap-2">
          <button type="button" class="btn-ghost" @click="renameModule">編輯模組</button>
          <button type="button" class="btn-ghost" @click="moveModule(-1)">模組上移</button
          ><button type="button" class="btn-ghost" @click="moveModule(1)">模組下移</button>
          <button v-if="session.isSysadmin" type="button" class="btn-ghost" @click="deleteModule">
            刪除模組實體
          </button>
        </div>
        <ol class="space-y-3">
          <li
            v-for="(r, i) in orderedRefs"
            :key="r.stepId"
            class="rounded-control bg-surface-muted p-3"
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
              <button type="button" class="btn-ghost" @click="edit(stepFor(r.stepId))">
                編輯共用步驟
              </button>
              <button type="button" class="btn-ghost" :disabled="i === 0" @click="moveRef(i, -1)">
                引用上移</button
              ><button
                type="button"
                class="btn-ghost"
                :disabled="i === orderedRefs.length - 1"
                @click="moveRef(i, 1)"
              >
                引用下移
              </button>
              <button type="button" class="btn-ghost" @click="removeRef(r)">
                移除引用（保留共用步驟）
              </button>
            </div>
          </li>
        </ol>
        <button type="button" class="btn-secondary" @click="edit()">新增步驟</button>
      </section>
      <section v-if="editing" class="space-y-3 rounded-2xl border border-edge p-4">
        <h3>編輯共用步驟</h3>
        <p>{{ locations }}</p>
        <label class="block"
          >步驟名稱<input v-model="title" maxlength="500" class="field w-full"
        /></label>
        <label class="block"
          >細項（每行一項）<textarea v-model="items" class="field w-full" />
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
          accept=".docx,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
          @select="upload"
        />
        <button type="button" class="btn-secondary" @click="saveStep">儲存共用步驟</button
        ><button type="button" class="btn-ghost" @click="editing = null">取消</button>
      </section>
      <p v-if="error" role="alert" class="text-tone-danger-ink">{{ error }}</p>
    </fieldset>
    <CombinationOrderEditor :key="category.id" :category="category" />
  </div>
</template>
