<script setup lang="ts">
defineProps<{
  eyebrow?: string
  title: string
  description: string
}>()
</script>

<template>
  <header class="mb-section flex flex-wrap items-start justify-between gap-4">
    <div class="min-w-0 flex-1 basis-xl">
      <p v-if="eyebrow" class="text-xs font-medium tracking-wide text-accent-ink">{{ eyebrow }}</p>
      <h1
        class="text-2xl font-semibold tracking-tight text-ink-strong sm:text-page-title"
        :class="eyebrow ? 'mt-2' : ''"
      >
        {{ title }}
      </h1>
      <p class="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">{{ description }}</p>
    </div>
    <div v-if="$slots.default" class="shrink-0">
      <slot />
    </div>
  </header>
</template>
