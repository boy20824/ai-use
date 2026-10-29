<script setup lang="ts">
import type { StatusTone } from '@/types/records'
import { computed } from 'vue'

const props = defineProps<{
  label: string
  tone: StatusTone
}>()

const toneClasses: Record<StatusTone, string> = {
  warn: 'bg-amber-100 text-amber-950',
  ok: 'bg-emerald-100 text-emerald-950',
  danger: 'bg-rose-100 text-rose-950',
  neutral: 'bg-stone-200 text-stone-700',
}

const toneClass = computed(() => toneClasses[props.tone])
</script>

<template>
  <span class="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium" :class="toneClass">
    {{ label }}
  </span>
</template>
