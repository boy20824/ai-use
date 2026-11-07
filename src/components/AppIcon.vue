<script setup lang="ts">
withDefaults(defineProps<{ name?: string }>(), { name: 'document' })
const paths: Record<string, string> = {
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  documents: 'M9 3h8l4 4v11H9z M17 3v5h4 M5 7H3v14h12v-2',
  folder: 'M3 7V4h6l3 3h9v13H3z M3 10h18',
  steps: 'M9 5h12 M9 12h12 M9 19h12 M3 4h1v3 M3 11h2l-2 3h2 M3 18h2v3H3',
  feedback: 'M3 4h14v11H8l-5 4z M20 9h2v13l-5-4h-5',
  members:
    'M15 21v-3a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v3 M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 3a4 4 0 0 1 0 7 M18 14a4 4 0 0 1 3 4v3',
  key: 'M14 3a6 6 0 0 0-5 9L2 19v3h4v-3h3v-3l3-3a6 6 0 1 0 2-10 M16 7h.01',
  logout: 'M9 3H3v18h6 M9 12h13 M17 7l5 5-5 5',
  download: 'M12 3v12 M7 10l5 5 5-5 M3 16v5h18v-5',
  document: 'M5 2h9l5 5v15H5z M14 2v6h5 M9 12h6 M9 16h6',
}
</script>
<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] ?? paths.document" />
  </svg>
</template>
