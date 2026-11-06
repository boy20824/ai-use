<script setup lang="ts">
import type { StatusTone } from '@/types/domain'
import { computed } from 'vue'

const props = defineProps<{
  label: string
  tone: StatusTone
}>()

const toneClasses: Record<StatusTone, string> = {
  warn: 'bg-badge-warn text-tone-warn-ink',
  ok: 'bg-badge-ok text-tone-ok-ink',
  danger: 'bg-badge-danger text-badge-danger-ink',
  neutral: 'bg-tone-neutral text-tone-neutral-ink',
}

const toneClass = computed(() => toneClasses[props.tone])
</script>

<template>
  <span class="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium" :class="toneClass">
    {{ label }}
  </span>
</template>
