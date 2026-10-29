<script setup lang="ts">
import RocDateField from '@/components/RocDateField.vue'
import { renderDocx, templateMimeType, zipGeneratedFiles } from '@/services/docxTemplates'
import { useTemplateStore } from '@/stores/templates'
import { downloadBlob, downloadBytes } from '@/utils/download'
import { displayFileName } from '@/utils/fileName'
import { applyRocDateFields } from '@/utils/rocDate'
import { computed, onUnmounted, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'

const props = defineProps<{
  categoryId: string
  categoryCode: string
  categoryName: string
}>()

const templatesStore = useTemplateStore()
const values = ref<Record<string, string>>({})
const message = ref('')
const messageTone = ref<'ok' | 'warn'>('ok')
const busy = ref(false)
const dateInvalid = computed(() => currentValues() === null)

const categoryTemplates = computed(() => templatesStore.forCategory(props.categoryId))

const zipName = computed(() => {
  const base = (props.categoryCode || props.categoryName || '範本').replace(/[\\/:*?"<>|]/g, '_')
  return `${base}-範本文件.zip`
})

const fieldNames = computed(() => {
  const names = ['姓名', '日期']
  const seen = new Set(names)
  for (const template of categoryTemplates.value) {
    for (const placeholder of template.placeholders) {
      if (seen.has(placeholder) || placeholder === '日期_民國') continue
      seen.add(placeholder)
      names.push(placeholder)
    }
  }
  return names
})

const dateValue = computed({
  get: () => values.value['日期'] ?? '',
  set: (value: string) => {
    values.value = { ...values.value, 日期: value }
  },
})

const dateHint = '{{日期}}'
const dateSlashHint = '{{日期_民國}}'

function fieldValue(name: string) {
  return values.value[name] ?? ''
}

function onFieldInput(name: string, event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  values.value = { ...values.value, [name]: target.value }
}

function currentValues() {
  return applyRocDateFields(values.value)
}

function clearValues() {
  values.value = {}
  message.value = ''
}

async function renderOne(id: string) {
  const filled = currentValues()
  if (!filled) throw new Error('invalid-date')
  const template = categoryTemplates.value.find((item) => item.id === id)
  const bytes = await templatesStore.bytesFor(id)
  if (!template || !bytes) {
    throw new Error('missing-template')
  }
  return {
    name: `產生-${displayFileName(template.fileName)}`,
    data: renderDocx(bytes, filled),
  }
}

async function downloadOne(id: string) {
  if (busy.value || dateInvalid.value) return
  busy.value = true
  message.value = ''
  try {
    const rendered = await renderOne(id)
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

async function downloadAll() {
  if (busy.value || categoryTemplates.value.length === 0) return
  busy.value = true
  message.value = ''
  const rendered: { name: string; data: Uint8Array }[] = []
  const failed: string[] = []
  for (const template of categoryTemplates.value) {
    try {
      rendered.push(await renderOne(template.id))
    } catch {
      failed.push(displayFileName(template.fileName))
    }
  }
  try {
    if (rendered.length === 0) {
      messageTone.value = 'warn'
      message.value = '沒有可以下載的文件。請確認日期有效，且範本欄位寫成雙大括號。'
      return
    }
    const zip = await zipGeneratedFiles(rendered)
    downloadBlob(zip, zipName.value)
    messageTone.value = failed.length > 0 ? 'warn' : 'ok'
    message.value =
      failed.length > 0
        ? `已下載 ${rendered.length} 份文件。無法產生：${failed.join('、')}。填寫內容沒有被保存。`
        : `已下載 ${rendered.length} 份文件。填寫內容沒有被保存。`
  } finally {
    busy.value = false
  }
}

watch(
  () => props.categoryId,
  () => {
    clearValues()
  },
)

onBeforeRouteLeave(() => {
  clearValues()
})

onUnmounted(clearValues)
</script>

<template>
  <section class="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold text-stone-950">產生文件</h2>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
          填入欄位後，套用到此類別連結的每一份範本。這些內容只留在這個畫面，離開或重新整理後會清除，也不會寫進服務。
        </p>
      </div>
      <button
        type="button"
        class="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
        :disabled="busy || categoryTemplates.length === 0 || dateInvalid"
        @click="downloadAll"
      >
        下載全部（zip）
      </button>
    </div>

    <div class="mt-5 grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <div class="space-y-4">
        <div v-for="(name, index) in fieldNames" :key="name">
          <label class="block text-sm font-medium text-stone-800" :for="`generate-field-${index}`">
            {{ name }}
          </label>
          <RocDateField v-if="name === '日期'" v-model="dateValue" />
          <input
            v-else
            :id="`generate-field-${index}`"
            :value="fieldValue(name)"
            type="text"
            autocomplete="off"
            class="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-700"
            @input="onFieldInput(name, $event)"
          />
        </div>
        <p class="text-xs leading-5 text-stone-500">
          未填的欄位會以空白帶入。日期用民國年選擇，{{ dateHint }} 會寫成 115年10月29日，{{
            dateSlashHint
          }}
          會寫成 115/10/29。
        </p>
      </div>

      <div>
        <p v-if="categoryTemplates.length === 0" class="text-sm leading-6 text-stone-500">
          此類別還沒有連結的 .docx 範本。從範本庫選取或上傳後才能產生文件。
        </p>
        <ul v-else class="divide-y divide-stone-200 rounded-2xl border border-stone-200">
          <li
            v-for="template in categoryTemplates"
            :key="template.id"
            class="flex items-center justify-between gap-3 px-4 py-3"
          >
            <span class="min-w-0">
              <span class="block break-all text-sm font-medium text-stone-900">{{
                displayFileName(template.fileName)
              }}</span>
              <span class="mt-1 block text-xs text-stone-500">
                {{
                  template.placeholders.length > 0
                    ? template.placeholders.join('、')
                    : '沒有偵測到欄位'
                }}
              </span>
            </span>
            <button
              type="button"
              class="shrink-0 rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 hover:bg-stone-50 disabled:cursor-not-allowed disabled:text-stone-400"
              :disabled="busy || dateInvalid"
              @click="downloadOne(template.id)"
            >
              下載
            </button>
          </li>
        </ul>
      </div>
    </div>

    <p
      v-if="message"
      class="mt-4 rounded-xl px-3 py-2 text-sm leading-6"
      :class="
        messageTone === 'ok' ? 'bg-emerald-50 text-emerald-950' : 'bg-amber-50 text-amber-950'
      "
      role="status"
    >
      {{ message }}
    </p>
  </section>
</template>
