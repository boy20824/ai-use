<script setup lang="ts">
defineProps<{
  title: string
  description: string
}>()
</script>

<template>
  <header class="mb-6">
    <h1 class="text-2xl font-semibold tracking-tight text-stone-900">{{ title }}</h1>
    <p class="mt-2 max-w-3xl text-sm leading-6 text-stone-600">{{ description }}</p>
  </header>
</template>
