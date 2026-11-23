<script setup lang="ts">
import { animateCount } from '@/composables/useCountUp'
import { useTemplateRef, watchPostEffect } from 'vue'

const props = defineProps<{ value: number }>()
const count = useTemplateRef<HTMLSpanElement>('count')

watchPostEffect((onCleanup) => {
  if (count.value) onCleanup(animateCount(count.value, props.value))
})
</script>

<template>
  <span ref="count">{{ value }}</span>
</template>
