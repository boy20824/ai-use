<script setup lang="ts">
defineProps<{
  eyebrow?: string
  title: string
  description: string
}>()
</script>

<template>
  <header class="mb-8">
    <p v-if="eyebrow" class="text-xs font-medium tracking-wide text-orange-800">{{ eyebrow }}</p>
    <h1
      class="text-2xl font-semibold tracking-tight text-stone-950 sm:text-3xl"
      :class="eyebrow ? 'mt-2' : ''"
    >
      {{ title }}
    </h1>
    <p class="mt-3 max-w-3xl text-sm leading-7 text-stone-600">{{ description }}</p>
    <div v-if="$slots.default" class="mt-5">
      <slot />
    </div>
  </header>
</template>
