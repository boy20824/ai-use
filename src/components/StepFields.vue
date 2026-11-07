<script setup lang="ts">
import type { FieldDef } from '@/types/domain'
import RocDateField from './RocDateField.vue'
defineProps<{
  fields: string[]
  values: Record<string, string>
  definitions?: FieldDef[]
  prefix: string
}>()
const emit = defineEmits<{ update: [key: string, value: string] }>()
function input(key: string, event: Event) {
  if (event.target instanceof HTMLInputElement) emit('update', key, event.target.value)
}
</script>
<template>
  <div class="mt-3 grid gap-4">
    <div v-for="(name, index) in fields" :key="name">
      <label :for="`${prefix}-${index}`" class="block text-sm font-medium">
        {{ definitions?.find((field) => field.key === name)?.name ?? name }}
      </label>
      <RocDateField
        v-if="name === '日期'"
        :model-value="values[name] ?? ''"
        @update:model-value="emit('update', name, $event)"
      />
      <input
        v-else
        :id="`${prefix}-${index}`"
        :value="values[name] ?? ''"
        :type="definitions?.find((field) => field.key === name)?.type ?? 'text'"
        step="any"
        autocomplete="off"
        class="field mt-2 w-full"
        @input="input(name, $event)"
      />
    </div>
  </div>
</template>
