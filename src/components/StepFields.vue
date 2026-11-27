<script setup lang="ts">
import { computed, shallowReactive } from 'vue'
import type { FieldDef } from '@/types/domain'
import type { FieldOwner, FieldOwnership } from '@/workbench/fieldOwnership'
import RocDateField from './RocDateField.vue'
const props = defineProps<{
  fields: string[]
  values: Record<string, string>
  definitions?: FieldDef[]
  ownership?: FieldOwnership
  stepId?: string
  stepNumbers?: ReadonlyMap<string, number>
  prefix: string
}>()
const emit = defineEmits<{ update: [key: string, value: string] }>()
const expanded = shallowReactive(new Map<string, FieldOwner>())
const rows = computed(() =>
  props.fields.map((name, index) => {
    const owner = props.stepId ? props.ownership?.[name] : undefined
    const reused =
      owner && (owner.source === 'base' || owner.owner !== props.stepId) ? owner : undefined
    const value = props.values[name] ?? ''
    const filled = !!value.trim()
    const isExpanded = !!reused && expanded.get(name) === reused
    return {
      name,
      id: `${props.prefix}-${index}`,
      definition: props.definitions?.find((field) => field.key === name),
      value,
      filled,
      reused,
      isExpanded,
      action: isExpanded ? '收合' : reused?.source === 'base' || filled ? '修改' : '在此填寫',
      ownerNumber: reused && props.stepNumbers?.get(reused.owner),
      sharedNumbers: reused ? [] : (owner?.sharedIn ?? []).map((id) => props.stepNumbers?.get(id)),
    }
  }),
)
function toggle(name: string, owner: FieldOwner) {
  if (expanded.get(name) === owner) expanded.delete(name)
  else expanded.set(name, owner)
}
function input(key: string, event: Event) {
  if (event.target instanceof HTMLInputElement) emit('update', key, event.target.value)
}
</script>
<template>
  <div class="mt-3 grid gap-4">
    <div
      v-for="{
        name,
        id,
        definition,
        value,
        filled,
        reused,
        isExpanded,
        action,
        ownerNumber,
        sharedNumbers,
      } in rows"
      :key="name"
      :data-field-key="name"
    >
      <div v-if="reused" class="flex items-center justify-between gap-2 text-sm">
        <span class="min-w-0 break-words">
          <template v-if="reused.source === 'base'"
            >沿用基本 SOP：{{ name }}＝{{ filled ? value : '未填' }}</template
          >
          <template v-else>
            {{ name }}：
            <template v-if="filled">已填：{{ value }}（填寫於步驟 {{ ownerNumber }}）</template>
            <template v-else>未填（請於步驟 {{ ownerNumber }} 填寫）</template>
          </template>
        </span>
        <button
          type="button"
          class="btn-secondary shrink-0 px-3 py-2"
          :aria-expanded="isExpanded"
          :aria-controls="`${id}-editor`"
          :aria-label="`${action}：${name}`"
          @click="toggle(name, reused)"
        >
          {{ action }}
        </button>
      </div>
      <div :id="`${id}-editor`">
        <template v-if="!reused || isExpanded">
          <label :for="id" class="block text-sm font-medium">
            {{ definition?.name ?? name }}
          </label>
          <span v-if="sharedNumbers.length" class="text-xs text-ink-muted">
            共用於：步驟 {{ sharedNumbers.join('、') }}
          </span>
          <RocDateField
            v-if="name === '日期'"
            :model-value="value"
            @update:model-value="emit('update', name, $event)"
          />
          <input
            v-else
            :id="id"
            :value="value"
            :type="definition?.type ?? 'text'"
            step="any"
            autocomplete="off"
            class="field mt-2 w-full"
            @input="input(name, $event)"
          />
        </template>
      </div>
    </div>
  </div>
</template>
