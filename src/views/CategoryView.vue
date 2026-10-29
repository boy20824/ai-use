<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue'
import FileDropzone from '@/components/FileDropzone.vue'
import GeneratePanel from '@/components/GeneratePanel.vue'
import PageIntro from '@/components/PageIntro.vue'
import PlaceholderGuide from '@/components/PlaceholderGuide.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { appName } from '@/config/app'
import { useCategoryStore } from '@/stores/categories'
import { useSessionStore } from '@/stores/session'
import { useTemplateStore } from '@/stores/templates'
import { formatBytes } from '@/utils/format'
import { formatStoredDate } from '@/utils/rocDate'
import { documentTone, templateOriginLabel, templateTone } from '@/utils/status'
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

const route = useRoute()
const categories = useCategoryStore()
const templates = useTemplateStore()
const session = useSessionStore()
const expandedId = ref('')
const feedback = ref('')
const feedbackTone = ref<'ok' | 'warn'>('ok')

const disabledReason =
  '唯讀檢視只能閱讀文件與步驟，不能上傳或移除範本。若要試用上傳，請登出後改以類別承辦或系統管理員進入。'

const categoryId = computed(() => {
  const raw = route.params.id
  return (Array.isArray(raw) ? raw[0] : raw) ?? ''
})

const category = computed(() => categories.byId(categoryId.value))

const categoryTemplates = computed(() =>
  templates.items.filter((item) => item.categoryId === categoryId.value),
)

watch(
  category,
  (value) => {
    document.title = value ? `${value.name} · ${appName}` : `找不到類別 · ${appName}`
  },
  { immediate: true },
)

watch(categoryId, () => {
  expandedId.value = ''
  feedback.value = ''
})

function toggleDocument(id: string) {
  expandedId.value = expandedId.value === id ? '' : id
}

async function onFiles(files: File[]) {
  if (!category.value || !session.canUpload) return
  const result = await templates.addFiles(category.value.id, files)
  if (result.added === 0 && result.skipped > 0 && result.rejected.length === 0) {
    feedbackTone.value = 'warn'
    feedback.value = `範本最多 ${templates.limit} 份，沒有再加入。`
    return
  }
  if (result.added === 0) {
    feedbackTone.value = 'warn'
    feedback.value = result.rejected[0] ?? '沒有可保存的 .docx 範本。'
    return
  }
  feedbackTone.value = result.rejected.length > 0 || result.skipped > 0 ? 'warn' : 'ok'
  const notes = [`已保存 ${result.added} 份範本。重新整理後仍會留在這個瀏覽器，不會送到伺服器。`]
  if (result.skipped > 0) notes.push(`另有 ${result.skipped} 份因筆數上限未加入。`)
  if (result.rejected.length > 0) notes.push(`${result.rejected.join('。')}。`)
  feedback.value = notes.join('')
}

function removeTemplate(id: string) {
  void templates.remove(id)
}
</script>

<template>
  <div v-if="category">
    <RouterLink
      to="/categories"
      class="mb-4 inline-flex text-sm text-stone-600 hover:text-stone-900"
    >
      回到全部類別
    </RouterLink>

    <PageIntro :eyebrow="category.code" :title="category.name" :description="category.summary" />

    <ul class="mb-4 flex flex-wrap gap-2" aria-label="類別資訊">
      <li class="rounded-full bg-white px-3 py-1 text-xs text-stone-700 ring-1 ring-stone-200">
        適用 {{ category.audience }}
      </li>
      <li class="rounded-full bg-white px-3 py-1 text-xs text-stone-700 ring-1 ring-stone-200">
        {{ category.documents.length }} 份文件
      </li>
      <li class="rounded-full bg-white px-3 py-1 text-xs text-stone-700 ring-1 ring-stone-200">
        {{ category.steps.length }} 個步驟
      </li>
      <li class="rounded-full bg-white px-3 py-1 text-xs text-stone-700 ring-1 ring-stone-200">
        {{ categoryTemplates.length }} 份範本
      </li>
    </ul>
    <p class="mb-8 text-sm leading-6 text-stone-500">
      案件送審與結案尚未開放。請在此閱讀文件、上傳範本，並在離開前下載產生的文件。
    </p>

    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div class="space-y-6">
        <section class="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div class="border-b border-stone-200 px-5 py-4">
            <h2 class="text-base font-semibold text-stone-950">相關文件</h2>
            <p class="mt-1 text-sm leading-6 text-stone-600">
              點開可閱讀準備這份文件時要核對的重點。這些說明沒有附件可下載。
            </p>
          </div>
          <ul class="divide-y divide-stone-200">
            <li v-for="document in category.documents" :key="document.id">
              <button
                type="button"
                class="w-full px-5 py-4 text-left hover:bg-stone-50"
                :aria-expanded="expandedId === document.id"
                @click="toggleDocument(document.id)"
              >
                <span class="flex flex-wrap items-center gap-2">
                  <StatusBadge :label="document.kind" :tone="documentTone(document.kind)" />
                  <span class="text-sm font-medium text-stone-900">{{ document.title }}</span>
                </span>
                <span class="mt-2 block text-sm leading-6 text-stone-600">{{
                  document.summary
                }}</span>
                <span class="mt-2 block text-xs text-stone-500">
                  更新
                  <time :datetime="document.updatedAt">{{
                    formatStoredDate(document.updatedAt)
                  }}</time>
                  · {{ expandedId === document.id ? '收合重點' : '展開重點' }}
                </span>
              </button>
              <ul
                v-if="expandedId === document.id"
                class="list-inside list-disc space-y-2 px-5 pb-4"
              >
                <li
                  v-for="point in document.points"
                  :key="point"
                  class="text-sm leading-6 text-stone-700"
                >
                  {{ point }}
                </li>
              </ul>
            </li>
          </ul>
        </section>

        <section class="rounded-2xl border border-stone-200 bg-white px-5 py-5 shadow-sm">
          <h2 class="text-base font-semibold text-stone-950">填寫步驟</h2>
          <p class="mt-1 text-sm leading-6 text-stone-600">依序準備即可。這不是送審流程。</p>
          <ol class="mt-5">
            <li v-for="(step, index) in category.steps" :key="step.id" class="flex gap-4">
              <div class="flex w-8 flex-col items-center">
                <span
                  class="flex h-8 w-8 items-center justify-center rounded-full bg-stone-900 text-xs font-semibold text-white"
                >
                  {{ index + 1 }}
                </span>
                <span
                  v-if="index < category.steps.length - 1"
                  class="my-2 w-px flex-1 bg-stone-200"
                  aria-hidden="true"
                ></span>
              </div>
              <div class="min-w-0 flex-1 pb-6">
                <h3 class="text-sm font-semibold text-stone-900">{{ step.title }}</h3>
                <p class="mt-1 text-sm leading-6 text-stone-600">{{ step.detail }}</p>
              </div>
            </li>
          </ol>
        </section>
      </div>

      <section class="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-base font-semibold text-stone-950">範本文件</h2>
          <RouterLink
            :to="{ path: '/templates', query: { category: category.id } }"
            class="text-sm text-orange-800 hover:underline"
          >
            全部
          </RouterLink>
        </div>
        <p class="mt-2 text-sm leading-6 text-stone-600">{{ category.caution }}</p>
        <div class="mt-4">
          <PlaceholderGuide />
        </div>
        <div class="mt-4">
          <FileDropzone
            :enabled="session.canUpload"
            :disabled-reason="disabledReason"
            title="將 .docx 範本拖到這裡，或選擇檔案"
            hint="只接受 Word 範本。檔案會留在這個瀏覽器，重新整理不會消失，也不會送到伺服器。"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            @select="onFiles"
          />
        </div>
        <p
          v-if="feedback"
          class="mt-3 rounded-xl px-3 py-2 text-sm leading-6"
          :class="
            feedbackTone === 'ok' ? 'bg-emerald-50 text-emerald-950' : 'bg-amber-50 text-amber-950'
          "
          role="status"
        >
          {{ feedback }}
        </p>
        <p v-if="templates.error" class="mt-3 text-sm text-rose-800" role="alert">
          {{ templates.error }}
        </p>
        <p v-if="categoryTemplates.length === 0" class="mt-4 text-sm text-stone-500">
          這個類別還沒有範本。上傳 .docx 後即可產生文件。
        </p>
        <ul v-else class="mt-4 divide-y divide-stone-200">
          <li
            v-for="item in categoryTemplates"
            :key="item.id"
            class="flex items-start justify-between gap-3 py-3"
          >
            <span class="min-w-0">
              <span class="block break-all text-sm font-medium text-stone-900">{{
                item.fileName
              }}</span>
              <span class="mt-1 block text-xs leading-5 text-stone-500">
                {{ formatBytes(item.sizeBytes) }} · {{ formatStoredDate(item.addedAt) }}
              </span>
              <span class="mt-1 block text-xs leading-5 text-stone-500">
                {{ item.placeholders.length > 0 ? item.placeholders.join('、') : '沒有偵測到欄位' }}
              </span>
              <span class="mt-2 inline-flex">
                <StatusBadge
                  :label="templateOriginLabel(item.origin)"
                  :tone="templateTone(item.origin)"
                />
              </span>
            </span>
            <button
              v-if="session.canDelete"
              type="button"
              class="shrink-0 text-sm text-stone-600 hover:text-rose-800"
              :aria-label="`移除 ${item.fileName}`"
              @click="removeTemplate(item.id)"
            >
              移除
            </button>
          </li>
        </ul>
      </section>
    </div>

    <div class="mt-6">
      <GeneratePanel :key="category.id" :category-id="category.id" :category-code="category.code" />
    </div>
  </div>

  <div v-else>
    <PageIntro
      eyebrow="案件類別"
      title="找不到這個類別"
      description="這個代號不在示範清單裡。請回到類別列表重新選擇。"
    />
    <EmptyState title="沒有對應的工作台" description="類別代號可能已變更，或連結不完整。">
      <RouterLink
        to="/categories"
        class="inline-flex rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
      >
        回到案件類別
      </RouterLink>
    </EmptyState>
  </div>
</template>
