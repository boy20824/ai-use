<script setup lang="ts">
// Bind inherited classes first to preserve the existing class order.
defineOptions({ inheritAttrs: false })

defineProps<{ missing: string[] }>()

const emit = defineEmits<{ focus: [key: string] }>()
</script>

<template>
  <p v-bind="$attrs" class="text-xs text-ink-muted">
    請先填寫：
    <template v-for="(key, index) in [...new Set(missing)]" :key="key">
      {{ index ? '、' : ''
      }}<button type="button" class="focus-control underline" @click="emit('focus', key)">
        {{ key }}
      </button>
    </template>
  </p>
</template>
