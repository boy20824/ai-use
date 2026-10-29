<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue'
import FileDropzone from '@/components/FileDropzone.vue'
import PageIntro from '@/components/PageIntro.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { appName } from '@/config/app'
import { useCategoryStore } from '@/stores/categories'
import { useDraftStore } from '@/stores/drafts'
import { useSessionStore } from '@/stores/session'
import { formatBytes } from '@/utils/format'
import { documentTone, draftTone } from '@/utils/status'
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

const route = useRoute()
const categories = useCategoryStore()
const drafts = useDraftStore()
const session = useSessionStore()
const expandedId = ref('')
const feedback = ref('')
const feedbackTone = ref<'ok' | 'warn'>('ok')

const disabledReason =
  '唯讀檢視只能閱讀文件與步驟。若要試用上傳，請登出後改以類別承辦或系統管理員進入。'

const categoryId = computed(() => {
  const raw = route.params.id
  return (Array.isArray(raw) ? raw[0] : raw) ?? ''
})

const category = computed(() => categories.byId(categoryId.value))

const categoryDrafts = computed(() =>
  drafts.items.filter((item) => item.categoryId === categoryId.value),
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

function onFiles(files: File[]) {
  if (!category.value || !session.canUpload) return
  const result = drafts.addFromFiles(category.value.id, files)
  if (result.added === 0 && result.skipped > 0) {
    feedbackTone.value = 'warn'
    feedback.value = `草稿清單最多 ${drafts.limit} 筆，沒有再加入。`
    return
  }
  if (result.added === 0) {
    feedbackTone.value = 'warn'
    feedback.value = '沒有可記錄的檔案。'
    return
  }
  feedbackTone.value = 'ok'
  feedback.value =
    result.skipped > 0
      ? `已記錄 ${result.added} 個檔案的檔名與大小。另有 ${result.skipped} 個因筆數上限未加入。內容沒有被讀取，也沒有送到伺服器。`
      : `已記錄 ${result.added} 個檔案的檔名與大小。內容沒有被讀取，也沒有送到伺服器。`
}

function removeDraft(id: string) {
  drafts.remove(id)
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
        整理於
        <time :datetime="category.updatedAt">{{ category.updatedAt }}</time>
      </li>
    </ul>
    <p class="mb-8 text-sm leading-6 text-stone-500">
      案件送審與結案尚未開放。請在此閱讀文件、依步驟準備，並留下草稿。
    </p>

    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div class="space-y-6">
        <section class="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div class="border-b border-stone-200 px-5 py-4">
            <h2 class="text-base font-semibold text-stone-950">相關文件</h2>
            <p class="mt-1 text-sm leading-6 text-stone-600">
              點開可閱讀準備這份草稿時要核對的重點。這些文件沒有附件可下載。
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
                  <time :datetime="document.updatedAt">{{ document.updatedAt }}</time>
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

      <aside class="lg:sticky lg:top-24">
        <section class="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 class="text-base font-semibold text-stone-950">上傳草稿</h2>
          <p class="mt-2 text-sm leading-6 text-stone-600">{{ category.caution }}</p>
          <div class="mt-4">
            <FileDropzone
              :enabled="session.canUpload"
              :disabled-reason="disabledReason"
              @select="onFiles"
            />
          </div>
          <p
            v-if="feedback"
            class="mt-3 rounded-xl px-3 py-2 text-sm leading-6"
            :class="
              feedbackTone === 'ok'
                ? 'bg-emerald-50 text-emerald-950'
                : 'bg-amber-50 text-amber-950'
            "
            role="status"
          >
            {{ feedback }}
          </p>

          <div class="mt-5 border-t border-stone-200 pt-4">
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-sm font-semibold text-stone-900">此類別的草稿</h3>
              <RouterLink
                :to="{ path: '/drafts', query: { category: category.id } }"
                class="text-sm text-orange-800 hover:underline"
              >
                全部
              </RouterLink>
            </div>
            <p v-if="categoryDrafts.length === 0" class="mt-3 text-sm text-stone-500">
              這個類別還沒有草稿紀錄。
            </p>
            <ul v-else class="mt-3 divide-y divide-stone-200">
              <li
                v-for="item in categoryDrafts.slice(0, 4)"
                :key="item.id"
                class="flex items-start justify-between gap-3 py-3"
              >
                <span class="min-w-0">
                  <span class="block break-all text-sm font-medium text-stone-900">{{
                    item.fileName
                  }}</span>
                  <span class="mt-1 block text-xs text-stone-500">
                    {{ formatBytes(item.sizeBytes) }} · {{ item.addedAt }}
                  </span>
                  <span class="mt-2 inline-flex">
                    <StatusBadge :label="item.source" :tone="draftTone(item.source)" />
                  </span>
                </span>
                <button
                  type="button"
                  class="shrink-0 text-sm text-stone-600 hover:text-rose-800"
                  :aria-label="`移出 ${item.fileName}`"
                  @click="removeDraft(item.id)"
                >
                  移出
                </button>
              </li>
            </ul>
            <p v-if="categoryDrafts.length > 4" class="mt-3 text-xs text-stone-500">
              另有 {{ categoryDrafts.length - 4 }} 筆在草稿清單。
            </p>
          </div>
        </section>
      </aside>
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
