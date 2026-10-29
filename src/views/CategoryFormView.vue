<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue'
import PageIntro from '@/components/PageIntro.vue'
import { useCategoryStore } from '@/stores/categories'
import { useSessionStore } from '@/stores/session'
import { useTemplateStore } from '@/stores/templates'
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const categories = useCategoryStore()
const templates = useTemplateStore()
const session = useSessionStore()

const name = ref('')
const code = ref('')
const summary = ref('')
const steps = ref<string[]>([])
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

function fillFrom(category: { name: string; code: string; summary: string; steps: string[] }) {
  name.value = category.name
  code.value = category.code
  summary.value = category.summary
  steps.value = [...category.steps]
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

function onStep(index: number, event: Event) {
  const target = event.target
  if (!(target instanceof HTMLTextAreaElement)) return
  const next = [...steps.value]
  next[index] = target.value
  steps.value = next
}

function moveStep(index: number, delta: number) {
  const nextIndex = index + delta
  if (nextIndex < 0 || nextIndex >= steps.value.length) return
  const next = [...steps.value]
  const [item] = next.splice(index, 1)
  if (item === undefined) return
  next.splice(nextIndex, 0, item)
  steps.value = next
}

function removeStep(index: number) {
  steps.value = steps.value.filter((_, itemIndex) => itemIndex !== index)
}

async function submit() {
  formError.value = ''
  const input = {
    name: name.value.trim(),
    code: code.value.trim(),
    summary: summary.value.trim(),
    steps: steps.value.map((step) => step.trim()).filter((step) => step.length > 0),
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
    description="名稱必填且不可重複。代號與簡述可以留空。填寫步驟會依序出現在工作台，供承辦準備文件。"
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
    description="唯讀檢視只能閱讀。請登出後改以類別承辦或系統管理員進入。"
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
        可留空。需要時再新增，並用上移、下移調整順序。
      </p>
      <ol v-if="steps.length > 0" class="mt-4 space-y-3">
        <li v-for="(step, index) in steps" :key="index" class="rounded-xl bg-stone-50 p-3">
          <label class="block text-xs text-stone-500" :for="`category-step-${index}`">
            步驟 {{ index + 1 }}
          </label>
          <textarea
            :id="`category-step-${index}`"
            :value="step"
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
        </li>
      </ol>
      <button
        type="button"
        class="mt-4 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-800 hover:bg-stone-50"
        @click="steps = [...steps, '']"
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
