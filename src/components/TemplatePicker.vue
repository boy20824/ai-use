<script setup lang="ts">
import { computed, nextTick } from 'vue'
import type { TemplateSummary } from '@/storage'
import { displayFileName, photoTemplateLabel } from '@/utils/fileName'

const props = defineProps<{
  items: readonly Pick<TemplateSummary, 'id' | 'fileName' | 'kind'>[]
  modelValue: readonly string[]
  idPrefix: string
}>()
const query = defineModel<string>('query', { default: '' })
const emit = defineEmits<{
  'update:modelValue': [ids: string[]]
  toggle: [id: string, checked: boolean]
}>()

const selected = computed(() => new Set(props.modelValue))
const selectedCount = computed(
  () => props.items.filter((item) => selected.value.has(item.id)).length,
)
const matches = computed(() => {
  const search = query.value.trim().toLocaleLowerCase()
  return props.items
    .map((item) => {
      const label = photoTemplateLabel(item.fileName)
      const fileName = displayFileName(item.fileName)
      return { ...item, fileName, name: label ?? fileName, canInsertPhotos: !!label }
    })
    .filter(
      (item) =>
        item.name.toLocaleLowerCase().includes(search) ||
        item.fileName.toLocaleLowerCase().includes(search),
    )
    .sort((a, b) => Number(selected.value.has(b.id)) - Number(selected.value.has(a.id)))
})

async function toggle(id: string, event: Event) {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  const { checked, ownerDocument } = input
  const hadFocus = ownerDocument.activeElement === input
  if (checked !== selected.value.has(id)) {
    emit(
      'update:modelValue',
      checked
        ? [...props.modelValue, id]
        : props.modelValue.filter((selectedId) => selectedId !== id),
    )
  }
  emit('toggle', id, checked)
  if (hadFocus) {
    await nextTick()
    if (input.isConnected && ownerDocument.activeElement === ownerDocument.body) {
      input.focus()
    }
  }
}
</script>

<template>
  <div>
    <label class="block text-xs font-medium text-stone-600" :for="idPrefix">搜尋範本</label>
    <input
      :id="idPrefix"
      v-model="query"
      type="search"
      placeholder="請輸入檔名"
      class="field mt-2 w-full"
    />
    <slot name="hint" />
    <p v-if="matches.length === 0" class="mt-3 text-sm text-ink-muted">
      <slot name="empty">
        {{ items.length === 0 ? '範本庫還沒有文件。' : '沒有符合的範本。' }}
      </slot>
    </p>
    <ul v-else class="mt-3 max-h-48 space-y-2 overflow-auto">
      <li v-for="item in matches" :key="item.id">
        <label class="flex items-start gap-2 text-sm text-stone-800">
          <input
            type="checkbox"
            class="mt-1"
            :value="item.id"
            :checked="selected.has(item.id)"
            @change="toggle(item.id, $event)"
          />
          <span class="break-all">
            {{ item.name }}
            <span v-if="item.kind === 'pdf'" class="text-xs text-ink-muted">參考文件</span>
            <span v-if="item.canInsertPhotos" class="block text-xs text-ink-muted">可插入圖片</span>
          </span>
        </label>
      </li>
    </ul>
    <p class="mt-2 text-xs text-ink-muted" aria-live="polite">
      已選 {{ selectedCount }} 份，共 {{ items.length }} 份
    </p>
  </div>
</template>
