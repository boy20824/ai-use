<script setup lang="ts">
defineProps<{
  text: string
}>()
</script>

<template>
  <span class="whitespace-pre-wrap break-words">{{ text }}</span>
</template>
