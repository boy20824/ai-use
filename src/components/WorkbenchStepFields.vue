<script setup lang="ts">
import StepFields from './StepFields.vue'
import type { FieldDef } from '@/types/domain'
import type { OverviewTemplate } from '@/workbench/overview'
import { displayFileName } from '@/utils/fileName'
defineProps<{
  sharedLabels?: Record<string, string>
  fields: string[]
  values: Record<string, string>
  definitions?: FieldDef[]
  prefix: string
  missing: string[]
  templates: OverviewTemplate[]
  photoCells?: Record<string, number>
  busy: boolean
  message: string
  messageTone: 'ok' | 'warn'
}>()
const emit = defineEmits<{
  update: [key: string, value: string]
  generate: [templateId: string]
  generateAll: []
  focusField: [key: string]
}>()
</script>
<template>
  <section
    v-if="fields.length || templates.some((item) => photoCells?.[item.id])"
    aria-label="本步驟欄位"
    class="mt-3"
  >
    <h4 class="text-sm font-semibold text-ink">本步驟欄位</h4>
    <StepFields
      :fields="fields"
      :values="values"
      :definitions="definitions"
      :shared-labels="sharedLabels"
      :prefix="prefix"
      @update="(key, value) => emit('update', key, value)"
    />
    <div
      v-for="item in templates.filter((item) => photoCells?.[item.id])"
      :key="item.id"
      class="mt-3"
    >
      <p class="text-sm font-medium">{{ displayFileName(item.fileName) }}</p>
      <slot name="photos" :template-id="item.id" />
    </div>
  </section>
  <p v-if="missing.length" class="mt-2 text-xs text-ink-muted">
    請先填寫：
    <template v-for="(key, index) in [...new Set(missing)]" :key="key">
      {{ index ? '、' : ''
      }}<button type="button" class="focus-control underline" @click="emit('focusField', key)">
        {{ key }}
      </button>
    </template>
  </p>
  <p v-if="templates.length === 0" class="mt-3 text-sm text-ink-muted">這個步驟還沒有範本。</p>
  <div v-else class="step-documents">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <button
        v-if="templates.length > 1"
        type="button"
        class="btn-primary"
        :disabled="busy || missing.length > 0"
        @click="emit('generateAll')"
      >
        產生本步驟全部
      </button>
    </div>
    <ul class="step-template-list divide-y divide-edge">
      <li
        v-for="item in templates"
        :key="item.id"
        class="flex items-center justify-between gap-3 px-4 py-3"
        :class="{ 'flex-wrap': !!photoCells?.[item.id] }"
      >
        <span class="min-w-0">
          <span class="block break-all text-sm font-medium text-ink">{{
            displayFileName(item.fileName)
          }}</span>
          <span class="mt-1 block text-xs text-ink-muted">
            {{ item.placeholders.length > 0 ? item.placeholders.join('、') : '沒有偵測到欄位' }}
          </span>
        </span>
        <button
          type="button"
          class="btn-secondary shrink-0 px-3 py-2"
          :title="missing.join('、') || '產出 .docx'"
          :disabled="busy || missing.length > 0"
          @click="emit('generate', item.id)"
        >
          產生
        </button>
      </li>
    </ul>
  </div>
  <p
    v-if="message"
    class="mt-3 rounded-control px-3 py-2 text-sm leading-6"
    :class="messageTone === 'ok' ? 'bg-emerald-50 text-emerald-950' : 'bg-amber-50 text-amber-950'"
    role="status"
  >
    {{ message }}
  </p>
</template>
