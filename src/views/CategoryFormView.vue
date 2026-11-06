<script setup lang="ts">
import { categoryGroups } from '@/config/app'
import type { CaseCategory, CategoryGroup, Variant, FieldDef } from '@/types/domain'
import EmptyState from '@/components/EmptyState.vue'
import FileDropzone from '@/components/FileDropzone.vue'
import PageIntro from '@/components/PageIntro.vue'
import { useCategoryStore } from '@/stores/categories'
import { useSessionStore } from '@/stores/session'
import { useTemplateStore } from '@/stores/templates'
import { displayFileName } from '@/utils/fileName'
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

const fieldKeyHint = '{{欄位鍵}}'
const copiedPlaceholder = ref('')
const copyError = ref('')
function fieldKey(field: FieldDef) {
  return (field.name ?? field.key).trim()
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
const wizard = ref(1)
const variants = ref<Variant[]>([])
const fields = ref<FieldDef[]>([])
const copySource = ref('')
const copyTarget = ref('')
const summary = ref('')
const steps = ref<DraftStep[]>([])
const populated = ref(false)
const saving = ref(false)
const formError = ref('')
const formNotice = ref('')

const editingId = computed(() => {
  if (route.name !== 'category-edit') return ''
  const raw = route.params.id
  return (Array.isArray(raw) ? raw[0] : raw) ?? ''
})
const isEdit = computed(() => editingId.value.length > 0)
const existing = computed(() => (editingId.value ? categories.byId(editingId.value) : undefined))

function blankStep(): DraftStep {
  return {
    key: crypto.randomUUID(),
    body: '',
    items: '',
    note: '',
    variantIds: [],
    templateIds: [],
    pickerOpen: false,
    query: '',
  }
}

function fillFrom(category: CaseCategory) {
  name.value = category.name
  group.value = category.group ?? 'criminal'
  variants.value = (category.variants ?? []).map((v) => ({ ...v }))
  fields.value = (category.fields ?? []).map((f) => ({ ...f, name: f.name ?? f.key }))
  summary.value = category.summary
  steps.value = category.steps.map((step) => ({
    key: step.id,
    id: step.id,
    body: step.title ?? step.body,
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
  (category) => {
    if (!isEdit.value || !category || populated.value) return
    fillFrom(category)
  },
  { immediate: true },
)

watch(
  () => route.fullPath,
  () => {
    formError.value = ''
    formNotice.value = ''
    const category = existing.value
    if (category) {
      fillFrom(category)
      return
    }
    populated.value = false
    if (!isEdit.value) {
      name.value = ''
      group.value = 'criminal'
      variants.value = []
      fields.value = []
      wizard.value = 1
      summary.value = ''
      steps.value = []
    }
  },
)

function moveStep(index: number, delta: number) {
  const nextIndex = index + delta
  if (nextIndex < 0 || nextIndex >= steps.value.length) return
  const next = [...steps.value]
  const [item] = next.splice(index, 1)
  if (!item) return
  next.splice(nextIndex, 0, item)
  steps.value = next
}

function removeStep(index: number) {
  steps.value = steps.value.filter((_, itemIndex) => itemIndex !== index)
}

function onStep(index: number, event: Event) {
  const target = event.target
  if (!(target instanceof HTMLTextAreaElement)) return
  const next = [...steps.value]
  const current = next[index]
  if (!current) return
  next[index] = { ...current, body: target.value }
  steps.value = next
}

function templateName(id: string) {
  const found = templates.byId(id)
  return found ? displayFileName(found.fileName) : '範本'
}

function pickerMatches(step: DraftStep) {
  const query = step.query.trim().toLocaleLowerCase()
  if (!query) return templates.items
  return templates.items.filter((item) =>
    displayFileName(item.fileName).toLocaleLowerCase().includes(query),
  )
}

function togglePicker(index: number) {
  const next = [...steps.value]
  const current = next[index]
  if (!current) return
  next[index] = { ...current, pickerOpen: !current.pickerOpen }
  steps.value = next
}

function setQuery(index: number, event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const next = [...steps.value]
  const current = next[index]
  if (!current) return
  next[index] = { ...current, query: target.value }
  steps.value = next
}

function toggleTemplate(index: number, templateId: string, event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const next = [...steps.value]
  const current = next[index]
  if (!current) return
  const templateIds = target.checked
    ? current.templateIds.includes(templateId)
      ? current.templateIds
      : [...current.templateIds, templateId]
    : current.templateIds.filter((id) => id !== templateId)
  next[index] = { ...current, templateIds }
  steps.value = next
}

function moveTemplate(index: number, templateIndex: number, delta: number) {
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
}

async function onUpload(index: number, files: File[]) {
  const current = steps.value[index]
  if (!current) return
  const result = await templates.addFiles(files, current.id)
  formNotice.value = result.formatNotice
  if (result.ids.length === 0) {
    formError.value = result.rejected[0] ?? '沒有可保存的 .docx 範本。'
    return
  }
  const next = [...steps.value]
  const templateIds = [...current.templateIds]
  for (const id of result.ids) {
    if (!templateIds.includes(id)) templateIds.push(id)
  }
  next[index] = { ...current, templateIds, pickerOpen: true }
  steps.value = next
  formError.value = result.rejected.length > 0 ? result.rejected.join('。') : ''
}

const newId = () => crypto.randomUUID()

function removeVariant(id: string) {
  variants.value = variants.value.filter((v) => v.id !== id)
  steps.value = steps.value.map((s) => ({ ...s, variantIds: s.variantIds.filter((v) => v !== id) }))
}
function copyVariant() {
  if (!copySource.value || !copyTarget.value || copySource.value === copyTarget.value) return
  const copies = steps.value
    .filter((s) => s.variantIds.includes(copySource.value))
    .map((s) => ({
      ...s,
      key: crypto.randomUUID(),
      id: undefined,
      templateIds: [...s.templateIds],
      variantIds: [copyTarget.value],
    }))
  if (steps.value.length + copies.length > 30) {
    formError.value = '最多可建立 30 個步驟。'
    return
  }
  steps.value = [...steps.value, ...copies]
}

async function submit() {
  formError.value = ''
  if (!name.value.trim()) {
    wizard.value = 1
    formError.value = '請填寫流程名稱。'
    return
  }
  if (wizard.value === 2 && variants.value.some((v) => !v.name.trim())) {
    formError.value = '請填寫每個樣態的名稱。'
    return
  }
  if (wizard.value < 3) {
    wizard.value += 1
    return
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
    variantIds: step.variantIds,
    templateIds: step.templateIds,
  }))
  if (prepared.some((step) => step.body.length === 0)) {
    formError.value = '請填寫每個步驟的內容，或移除空白步驟。'
    return
  }
  const input = {
    name: name.value.trim(),
    group: group.value,
    variants: variants.value,
    fields: fields.value.map((field) => ({
      ...field,
      name: field.name?.trim(),
      key: fieldKey(field),
    })),
    summary: summary.value.trim(),
    steps: prepared,
  }
  if (!input.name) {
    formError.value = '請填寫流程名稱。'
    return
  }
  saving.value = true
  try {
    if (isEdit.value) {
      await categories.update(editingId.value, input)
      await templates.reload()
      await router.push(`/categories/${editingId.value}`)
      return
    }
    const created = await categories.create(input)
    await router.push(`/categories/${created.id}`)
  } catch (cause) {
    formError.value = cause instanceof Error ? cause.message : '無法儲存勤務流程。'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <PageIntro
    eyebrow="工作台"
    :title="isEdit ? '編輯勤務流程' : '新增勤務流程'"
    description="名稱必填且不可重複。基本資料（姓名、日期）會固定出現在流程第一步。這裡的步驟可以寫說明，並從範本庫選取要在該步驟產生的文件。"
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
  <p v-if="!categories.ready" class="text-sm text-ink-muted">正在讀取勤務流程。</p>
  <EmptyState
    v-else-if="!session.canEditCategory"
    title="此身分不能建立或編輯流程"
    description="只有系統管理員，或被授權可維護流程的使用者，可以建立或編輯流程、步驟與範本連結。其他已登入的使用者仍可在工作台產生文件。"
  >
    <RouterLink to="/categories" class="btn-primary"> 回到勤務流程 </RouterLink>
  </EmptyState>
  <EmptyState
    v-else-if="isEdit && !existing"
    title="找不到這個流程"
    description="流程可能已刪除，或連結不完整。"
  >
    <RouterLink to="/categories" class="btn-primary"> 回到勤務流程 </RouterLink>
  </EmptyState>

  <form
    v-else-if="!isEdit || populated"
    class="max-w-3xl rounded-2xl border border-edge bg-surface p-5 shadow-card sm:p-6"
    @submit.prevent="submit"
  >
    <ol class="mb-6 flex gap-3 text-sm" aria-label="編輯進度">
      <li
        v-for="(label, i) in ['命名與分類', '建立樣態', '步驟與範本']"
        :key="label"
        :class="wizard === i + 1 ? 'font-semibold text-accent-ink' : 'text-ink-muted'"
      >
        {{ i + 1 }}. {{ label }}
      </li>
    </ol>
    <section v-show="wizard === 1">
      <div>
        <label for="category-name" class="block text-sm font-medium text-stone-800">
          名稱 <span class="font-normal text-ink-muted">必填</span>
        </label>
        <input
          id="category-name"
          v-model="name"
          type="text"
          name="name"
          :required="wizard === 1"
          maxlength="80"
          autocomplete="off"
          placeholder="請輸入流程名稱"
          class="field mt-2 w-full"
        />
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
    <section v-show="wizard === 2" aria-label="樣態設定">
      <h2 class="font-semibold">建立樣態（選填）</h2>
      <p class="mt-2 text-sm text-ink-muted">不需要區分樣態時，可直接跳過。</p>
      <div v-for="variant in variants" :key="variant.id" class="mt-3 flex gap-3">
        <input
          v-model="variant.name"
          :aria-label="'樣態名稱'"
          maxlength="80"
          class="field w-full"
        />
        <button
          type="button"
          class="btn-ghost shrink-0 text-sm text-tone-danger-ink"
          @click="removeVariant(variant.id)"
        >
          移除樣態
        </button>
      </div>
      <button
        type="button"
        class="btn-secondary mt-4 py-2"
        :disabled="variants.length >= 30"
        @click="variants.push({ id: newId(), name: '' })"
      >
        新增樣態
      </button>
    </section>
    <section v-show="wizard === 3">
      <div v-if="variants.length > 1" class="mt-4 flex flex-wrap gap-3">
        <select v-model="copySource" aria-label="複製來源樣態" class="field">
          <option value="">來源樣態</option>
          <option v-for="v in variants" :key="v.id" :value="v.id">{{ v.name }}</option>
        </select>
        <select v-model="copyTarget" aria-label="複製目標樣態" class="field">
          <option value="">目標樣態</option>
          <option v-for="v in variants" :key="v.id" :value="v.id">{{ v.name }}</option>
        </select>
        <button type="button" class="btn-ghost text-sm text-accent-ink" @click="copyVariant">
          複製步驟與範本
        </button>
      </div>
      <fieldset class="mt-6">
        <legend class="text-sm font-medium text-stone-800">填寫步驟</legend>
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
              @input="onStep(index, $event)"
            ></textarea>
            <label class="mt-3 block text-sm"
              >細項（每行一項）<textarea v-model="step.items" rows="3" class="field mt-2 w-full" />
            </label>
            <label class="mt-3 block text-sm"
              >特別註記<textarea
                v-model="step.note"
                rows="2"
                maxlength="2000"
                class="field mt-2 w-full"
              />
            </label>
            <p class="mt-3 text-xs text-ink-muted">
              需同時符合的樣態：未勾選即為共同步驟；勾選多個時須全部符合。
            </p>
            <div class="mt-2 flex flex-wrap gap-3">
              <label v-for="v in variants" :key="v.id" class="text-sm"
                ><input v-model="step.variantIds" type="checkbox" :value="v.id" />
                {{ v.name }}</label
              >
            </div>
            <div class="mt-2 flex flex-wrap gap-3">
              <button
                type="button"
                class="btn-ghost text-sm text-stone-600 hover:text-ink"
                :disabled="index === 0"
                @click="moveStep(index, -1)"
              >
                上移
              </button>
              <button
                type="button"
                class="btn-ghost text-sm text-stone-600 hover:text-ink"
                :disabled="index === steps.length - 1"
                @click="moveStep(index, 1)"
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
                    class="btn-ghost text-sm text-stone-600 hover:text-ink"
                    :disabled="templateIndex === 0"
                    @click="moveTemplate(index, templateIndex, -1)"
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    class="btn-ghost text-sm text-stone-600 hover:text-ink"
                    :disabled="templateIndex === step.templateIds.length - 1"
                    @click="moveTemplate(index, templateIndex, 1)"
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
              <label class="block text-xs font-medium text-stone-600" :for="`picker-${step.key}`">
                搜尋範本
              </label>
              <input
                :id="`picker-${step.key}`"
                :value="step.query"
                type="search"
                placeholder="請輸入檔名"
                class="field mt-2 w-full"
                @input="setQuery(index, $event)"
              />
              <p v-if="templates.items.length === 0" class="mt-3 text-sm text-ink-muted">
                範本庫還沒有文件。可先在下方上傳。
              </p>
              <p v-else-if="pickerMatches(step).length === 0" class="mt-3 text-sm text-ink-muted">
                沒有符合的範本。
              </p>
              <ul v-else class="mt-3 max-h-48 space-y-2 overflow-auto">
                <li v-for="item in pickerMatches(step)" :key="item.id">
                  <label class="flex items-start gap-2 text-sm text-stone-800">
                    <input
                      type="checkbox"
                      class="mt-1"
                      :checked="step.templateIds.includes(item.id)"
                      @change="toggleTemplate(index, item.id, $event)"
                    />
                    <span class="break-all">{{ displayFileName(item.fileName) }}</span>
                  </label>
                </li>
              </ul>
              <div class="mt-4">
                <FileDropzone
                  :enabled="true"
                  disabled-reason=""
                  title="上傳 .docx 並連結到這個步驟"
                  hint="檔案會存進範本庫，並出現在這個步驟的範本清單。"
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  @select="onUpload(index, $event)"
                />
              </div>
            </div>
          </li>
        </ol>
        <button type="button" class="btn-secondary mt-4" @click="steps = [...steps, blankStep()]">
          新增步驟
        </button>
      </fieldset>
      <fieldset class="mt-6">
        <legend class="font-semibold">細項欄位</legend>
        <div v-for="(field, i) in fields" :key="field.id" class="mt-3 grid gap-2 sm:grid-cols-4">
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
            @click="fields.splice(i, 1)"
          >
            移除欄位
          </button>
        </div>
        <button
          type="button"
          class="btn-secondary mt-3 py-2"
          :disabled="fields.length >= 50"
          @click="fields.push({ id: newId(), name: '', key: '', type: 'text' })"
        >
          新增欄位
        </button>
        <p class="sr-only" role="status">
          {{ copiedPlaceholder ? '已複製 ' + copiedPlaceholder : '' }}
        </p>
        <p v-if="copyError" class="mt-2 text-sm text-tone-danger-ink" role="alert">
          {{ copyError }}
        </p>
        <p class="mt-2 text-xs text-ink-muted">
          範本欄位寫法：{{ fieldKeyHint }}。只儲存欄位定義。
        </p>
      </fieldset>
    </section>

    <p
      v-if="formNotice"
      class="mt-4 rounded-control bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950"
      role="status"
    >
      {{ formNotice }}
    </p>
    <p v-if="formError" class="mt-4 text-sm text-tone-danger-ink" role="alert">{{ formError }}</p>
    <div class="mt-6 flex flex-wrap gap-3">
      <button v-if="wizard > 1" type="button" class="btn-secondary py-2" @click="wizard--">
        上一步
      </button>
      <button type="submit" class="btn-primary" :disabled="saving">
        {{
          wizard === 2 && !variants.length
            ? '跳過樣態'
            : wizard < 3
              ? '下一步'
              : isEdit
                ? '儲存變更'
                : '建立流程'
        }}
      </button>
      <RouterLink :to="isEdit ? `/categories/${editingId}` : '/categories'" class="btn-secondary">
        取消
      </RouterLink>
    </div>
  </form>
</template>
