<script setup lang="ts">
import { onMounted, onUnmounted, ref, useId } from 'vue'

defineProps<{
  title: string
  confirmLabel?: string
  cancelLabel?: string
  alternateLabel?: string
  busy?: boolean
  tone?: 'danger' | 'default'
}>()
const emit = defineEmits<{ confirm: []; cancel: []; alternate: [] }>()
const dialog = ref<HTMLElement | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)
const id = useId()
let previousFocus: HTMLElement | null = null
function focusable() {
  return [
    ...(dialog.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    ) ?? []),
  ].filter((element) => !element.closest('[hidden], [inert]'))
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('cancel')
  } else if (event.key === 'Tab') {
    const elements = focusable()
    const index = elements.indexOf(document.activeElement as HTMLElement)
    event.preventDefault()
    const next = (index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length
    ;(elements[next] ?? dialog.value)?.focus()
  }
}
function containFocus(event: FocusEvent) {
  if (!dialog.value?.contains(event.target as Node)) cancelButton.value?.focus()
}
onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const initialFocus = dialog.value?.querySelector<HTMLElement>('[data-dialog-initial-focus]')
  ;(initialFocus ?? cancelButton.value)?.focus()
  document.addEventListener('keydown', keydown, true)
  document.addEventListener('focusin', containFocus)
})
onUnmounted(() => {
  document.removeEventListener('keydown', keydown, true)
  document.removeEventListener('focusin', containFocus)
  if (previousFocus?.isConnected) previousFocus.focus()
})
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-nav/40 px-4"
    @click.self="emit('cancel')"
  >
    <div
      ref="dialog"
      class="w-full max-w-md rounded-2xl border border-edge bg-surface p-6 shadow-card"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="`${id}-title`"
      :aria-describedby="`${id}-description`"
      tabindex="-1"
    >
      <h2 :id="`${id}-title`" class="text-base font-semibold text-ink-strong">{{ title }}</h2>
      <div :id="`${id}-description`" class="mt-2 text-sm leading-6 text-stone-600"><slot /></div>
      <div class="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          :class="tone === 'danger' ? 'btn-danger' : 'btn-primary'"
          :disabled="busy"
          @click="emit('confirm')"
        >
          {{ confirmLabel ?? '確定' }}
        </button>
        <button
          v-if="alternateLabel"
          type="button"
          class="btn-secondary"
          :disabled="busy"
          @click="emit('alternate')"
        >
          {{ alternateLabel }}
        </button>
        <button ref="cancelButton" type="button" class="btn-secondary" @click="emit('cancel')">
          {{ cancelLabel ?? '取消' }}
        </button>
      </div>
    </div>
  </div>
</template>
