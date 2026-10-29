<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue'
import FileDropzone from '@/components/FileDropzone.vue'
import PageIntro from '@/components/PageIntro.vue'
import { useCategoryStore } from '@/stores/categories'
import { useSessionStore } from '@/stores/session'
import { useTemplateStore } from '@/stores/templates'
import { displayFileName } from '@/utils/fileName'
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

interface DraftStep {
  key: string
  id?: string
  body: string
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
const code = ref('')
const summary = ref('')
const steps = ref<DraftStep[]>([])
const populated = ref(false)
const saving = ref(false)
const formError = ref('')

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
    templateIds: [],
    pickerOpen: false,
    query: '',
  }
}

function fillFrom(category: {
  name: string
  code: string
  summary: string
  steps: { id: string; body: string; templateIds: string[] }[]
}) {
  name.value = category.name
  code.value = category.code
  summary.value = category.summary
  steps.value = category.steps.map((step) => ({
    key: step.id,
    id: step.id,
    body: step.body,
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
    const category = existing.value
    if (category) {
      fillFrom(category)
      return
    }
    populated.value = false
    if (!isEdit.value) {
      name.value = ''
      code.value = ''
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
  formError.value = ''
}

async function submit() {
  formError.value = ''
  const prepared = steps.value.map((step) => ({
    id: step.id,
    body: step.body.trim(),
    templateIds: step.templateIds,
  }))
  if (prepared.some((step) => step.body.length === 0)) {
    formError.value = '請填寫每個步驟的內容，或移除空白步驟。'
    return
  }
  const input = {
    name: name.value.trim(),
    code: code.value.trim(),
    summary: summary.value.trim(),
    steps: prepared,
  }
  if (!input.name) {
    formError.value = '請填寫類別名稱。'
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
    formError.value = cause instanceof Error ? cause.message : '無法儲存案件類別。'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <PageIntro
    eyebrow="工作台"
    :title="isEdit ? '編輯案件類別' : '新增案件類別'"
    description="名稱必填且不可重複。基本資料（姓名、日期）會固定出現在流程第一步。這裡的步驟可以寫說明，並從範本庫選取要在該步驟產生的文件。"
  >
    <RouterLink
      :to="isEdit ? `/categories/${editingId}` : '/categories'"
      class="inline-flex text-sm text-stone-600 hover:text-stone-900"
    >
      {{ isEdit ? '回到工作台' : '回到全部類別' }}
    </RouterLink>
  </PageIntro>

  <p v-if="categories.error" class="mb-4 text-sm text-rose-800" role="alert">
    {{ categories.error }}
  </p>
  <p v-if="!categories.ready" class="text-sm text-stone-500">正在讀取案件類別。</p>
  <EmptyState
    v-else-if="!session.canEditCategory"
    title="此身分不能建立或編輯類別"
    description="只有系統管理員，或被授權可維護類別的使用者，可以建立或編輯類別、步驟與範本連結。其他已登入的使用者仍可在工作台產生文件。"
  >
    <RouterLink
      to="/categories"
      class="inline-flex rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
    >
      回到案件類別
    </RouterLink>
  </EmptyState>
  <EmptyState
    v-else-if="isEdit && !existing"
    title="找不到這個類別"
    description="類別可能已刪除，或連結不完整。"
  >
    <RouterLink
      to="/categories"
      class="inline-flex rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
    >
      回到案件類別
    </RouterLink>
  </EmptyState>

  <form
    v-else-if="!isEdit || populated"
    class="max-w-3xl rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6"
    @submit.prevent="submit"
  >
    <div>
      <label for="category-name" class="block text-sm font-medium text-stone-800">
        名稱 <span class="font-normal text-stone-500">必填</span>
      </label>
      <input
        id="category-name"
        v-model="name"
        type="text"
        name="name"
        required
        maxlength="80"
        autocomplete="off"
        placeholder="例如：竊盜案"
        class="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-700"
      />
    </div>
    <div class="mt-4">
      <label for="category-code" class="block text-sm font-medium text-stone-800">
        代號 <span class="font-normal text-stone-500">選填</span>
      </label>
      <input
        id="category-code"
        v-model="code"
        type="text"
        name="code"
        maxlength="32"
        autocomplete="off"
        placeholder="例如：A-01"
        class="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-700"
      />
    </div>
    <div class="mt-4">
      <label for="category-summary" class="block text-sm font-medium text-stone-800">
        簡述 <span class="font-normal text-stone-500">選填</span>
      </label>
      <textarea
        id="category-summary"
        v-model="summary"
        name="summary"
        rows="3"
        maxlength="400"
        placeholder="這個類別要協助準備什麼文件"
        class="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-700"
      ></textarea>
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
          class="rounded-2xl border border-stone-200 bg-stone-50 p-4"
        >
          <label class="block text-xs text-stone-500" :for="`category-step-${index}`">
            步驟 {{ index + 1 }}
          </label>
          <textarea
            :id="`category-step-${index}`"
            :value="step.body"
            rows="2"
            maxlength="500"
            class="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-700"
            @input="onStep(index, $event)"
          ></textarea>
          <div class="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              class="text-sm text-stone-600 hover:text-stone-900 disabled:text-stone-300"
              :disabled="index === 0"
              @click="moveStep(index, -1)"
            >
              上移
            </button>
            <button
              type="button"
              class="text-sm text-stone-600 hover:text-stone-900 disabled:text-stone-300"
              :disabled="index === steps.length - 1"
              @click="moveStep(index, 1)"
            >
              下移
            </button>
            <button
              type="button"
              class="text-sm text-stone-600 hover:text-rose-800"
              @click="removeStep(index)"
            >
              移除
            </button>
          </div>

          <p v-if="step.templateIds.length === 0" class="mt-3 text-sm text-stone-500">
            尚未連結範本。
          </p>
          <ol v-else class="mt-3 space-y-2">
            <li
              v-for="(templateId, templateIndex) in step.templateIds"
              :key="templateId"
              class="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2"
            >
              <span class="min-w-0 break-all text-sm text-stone-800">
                {{ templateIndex + 1 }}. {{ templateName(templateId) }}
              </span>
              <span class="flex shrink-0 gap-2">
                <button
                  type="button"
                  class="text-sm text-stone-600 hover:text-stone-900 disabled:text-stone-300"
                  :disabled="templateIndex === 0"
                  @click="moveTemplate(index, templateIndex, -1)"
                >
                  上移
                </button>
                <button
                  type="button"
                  class="text-sm text-stone-600 hover:text-stone-900 disabled:text-stone-300"
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
            class="mt-3 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-800 hover:bg-stone-50"
            :aria-expanded="step.pickerOpen"
            @click="togglePicker(index)"
          >
            從範本庫選取
          </button>
          <div v-if="step.pickerOpen" class="mt-3 rounded-2xl border border-stone-200 bg-white p-4">
            <label class="block text-xs font-medium text-stone-600" :for="`picker-${step.key}`">
              搜尋範本
            </label>
            <input
              :id="`picker-${step.key}`"
              :value="step.query"
              type="search"
              placeholder="檔名"
              class="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-700"
              @input="setQuery(index, $event)"
            />
            <p v-if="templates.items.length === 0" class="mt-3 text-sm text-stone-500">
              範本庫還沒有文件。可先在下方上傳。
            </p>
            <p v-else-if="pickerMatches(step).length === 0" class="mt-3 text-sm text-stone-500">
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
      <button
        type="button"
        class="mt-4 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-800 hover:bg-stone-50"
        @click="steps = [...steps, blankStep()]"
      >
        新增步驟
      </button>
    </fieldset>

    <p v-if="formError" class="mt-4 text-sm text-rose-800" role="alert">{{ formError }}</p>
    <div class="mt-6 flex flex-wrap gap-3">
      <button
        type="submit"
        class="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
        :disabled="saving"
      >
        {{ isEdit ? '儲存變更' : '建立類別' }}
      </button>
      <RouterLink
        :to="isEdit ? `/categories/${editingId}` : '/categories'"
        class="inline-flex rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-800 hover:bg-stone-50"
      >
        取消
      </RouterLink>
    </div>
  </form>
</template>
