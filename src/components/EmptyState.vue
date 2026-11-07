<script setup lang="ts">
defineProps<{
  title: string
  description: string
}>()
</script>

<template>
  <div
    class="rounded-card border border-dashed border-edge-strong bg-surface-muted px-6 py-8 text-center"
  >
    <h2 class="text-base font-semibold text-ink">{{ title }}</h2>
    <p class="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-600">{{ description }}</p>
    <div v-if="$slots.default" class="mt-5">
      <slot />
    </div>
  </div>
</template>
