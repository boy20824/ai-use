<script setup lang="ts">
import RocDateField from './RocDateField.vue'

const props = defineProps<{ sharedDate: string; override?: string }>()
const emit = defineEmits<{ update: [value: string | undefined] }>()

function toggle(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.checked) emit('update', props.sharedDate)
  else if (window.confirm('確定關閉這一步的不同日期，改為沿用上方日期？')) emit('update', undefined)
  else input.checked = true
}
</script>

<template>
  <div class="mt-3" data-step-date>
    <p class="text-sm font-medium">日期</p>
    <label class="mt-2 inline-flex items-center gap-2 text-sm">
      <input type="checkbox" role="switch" :checked="override !== undefined" @change="toggle" />
      這一步用不同日期
    </label>
    <p v-if="override === undefined" class="mt-2 text-sm text-ink-muted">
      沿用上方日期：{{ sharedDate || '尚未填寫' }}
    </p>
    <RocDateField v-else :model-value="override" @update:model-value="emit('update', $event)" />
  </div>
</template>
