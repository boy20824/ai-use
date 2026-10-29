<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  enabled: boolean
  disabledReason: string
}>()

const emit = defineEmits<{
  select: [files: File[]]
}>()

const dragging = ref(false)

function emitFiles(list: FileList | null) {
  if (!list || list.length === 0) return
  emit('select', Array.from(list))
}

function onDragOver() {
  dragging.value = true
}

function onDragLeave(event: DragEvent) {
  const current = event.currentTarget
  const next = event.relatedTarget
  if (current instanceof Node && next instanceof Node && current.contains(next)) return
  dragging.value = false
}

function onDrop(event: DragEvent) {
  dragging.value = false
  emitFiles(event.dataTransfer?.files ?? null)
}

function onChange(event: Event) {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  emitFiles(input.files)
  input.value = ''
}
</script>

<template>
  <div
    v-if="!enabled"
    class="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-5 py-8 text-center"
  >
    <p class="text-sm font-medium text-stone-800">此身分不能上傳</p>
    <p class="mt-2 text-sm leading-6 text-stone-600">{{ disabledReason }}</p>
  </div>
  <label
    v-else
    class="block cursor-pointer rounded-2xl border border-dashed px-5 py-8 text-center transition"
    :class="
      dragging ? 'border-stone-900 bg-stone-50' : 'border-stone-300 bg-white hover:border-stone-400'
    "
    @dragenter.prevent="onDragOver"
    @dragover.prevent="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <input type="file" class="sr-only" multiple @change="onChange" />
    <p class="text-sm font-medium text-stone-900">將檔案拖到這裡，或選擇檔案</p>
    <p class="mx-auto mt-2 max-w-sm text-sm leading-6 text-stone-600">
      可一次選擇多個檔案。這裡只記錄檔名、大小與類型，不會讀取內容，也不會送到伺服器。
    </p>
  </label>
</template>
