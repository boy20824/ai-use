<script setup lang="ts">
import { ref } from 'vue'
import type { OverviewTemplate } from '@/workbench/overview'
import { useTemplateStore } from '@/stores/templates'
import { previewPdf } from '@/services/pdfPreview'
import { downloadBytes } from '@/utils/download'
import { displayFileName } from '@/utils/fileName'
import { pdfMimeType } from '../../shared/templateUpload'

defineProps<{ templates: OverviewTemplate[] }>()
const store = useTemplateStore()
const error = ref('')
async function open(item: OverviewTemplate, preview: boolean) {
  error.value = ''
  try {
    if (preview) await previewPdf(item.id)
    else {
      const data = await store.bytesFor(item.id)
      if (!data) throw new Error('無法讀取參考文件。')
      downloadBytes(new Uint8Array(data), displayFileName(item.fileName), pdfMimeType)
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '無法讀取參考文件。'
  }
}
</script>
<template>
  <section v-if="templates.length" aria-label="參考文件" class="mt-4">
    <h4 class="text-sm font-semibold text-ink">參考文件</h4>
    <ul class="mt-2 divide-y divide-edge">
      <li v-for="item in templates" :key="item.id" class="flex flex-wrap items-center gap-3 py-3">
        <span class="min-w-0 flex-1 break-all text-sm">{{ displayFileName(item.fileName) }}</span>
        <button type="button" class="btn-secondary" @click="open(item, true)">預覽</button>
        <button type="button" class="btn-secondary" @click="open(item, false)">下載</button>
      </li>
    </ul>
    <p v-if="error" role="alert" class="text-sm text-tone-danger-ink">{{ error }}</p>
  </section>
</template>
