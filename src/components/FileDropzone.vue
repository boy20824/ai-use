<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  enabled: boolean
  disabledReason: string
  title: string
  hint: string
  compact?: boolean
  accept?: string
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
    class="rounded-2xl border border-dashed border-edge bg-surface-muted px-5 py-8 text-center"
  >
    <p class="text-sm font-medium text-stone-800">此身分不能上傳</p>
    <p class="mt-2 text-sm leading-6 text-stone-600">{{ disabledReason }}</p>
  </div>
  <label
    v-else
    class="focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-canvas block cursor-pointer rounded-2xl border border-dashed px-5 py-8 text-center transition"
    :class="[
      compact ? 'compact-upload' : '',
      dragging ? 'border-ink bg-surface-muted' : 'border-edge bg-surface hover:border-edge-strong',
    ]"
    @dragenter.prevent="onDragOver"
    @dragover.prevent="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <input type="file" class="sr-only" multiple :accept="accept" @change="onChange" />
    <p class="text-sm font-medium text-ink">{{ title }}</p>
    <p class="mx-auto mt-2 max-w-sm text-sm leading-6 text-stone-600">{{ hint }}</p>
  </label>
</template>
