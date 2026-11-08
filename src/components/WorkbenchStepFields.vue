<script setup lang="ts">
import StepFields from './StepFields.vue'
import type { FieldDef } from '@/types/domain'
import type { OverviewTemplate } from '@/workbench/overview'
import { displayFileName } from '@/utils/fileName'
defineProps<{
  isBase: boolean
  fields: string[]
  values: Record<string, string>
  definitions?: FieldDef[]
  prefix: string
  missing: string[]
  templates: OverviewTemplate[]
  busy: boolean
  message: string
  messageTone: 'ok' | 'warn'
}>()
const emit = defineEmits<{
  update: [key: string, value: string]
  generate: [templateId: string]
  generateAll: []
}>()
</script>
<template>
  <StepFields
    v-if="!isBase"
    :fields="fields"
    :values="values"
    :definitions="definitions"
    :prefix="prefix"
    @update="(key, value) => emit('update', key, value)"
  />
  <p v-if="missing.length" class="mt-2 text-xs text-ink-muted">
    請先填寫：{{ missing.join('、') }}
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
