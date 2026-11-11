<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { BlockPhoto } from '../../shared/photoBlockRender'
const props = defineProps<{ photo: BlockPhoto }>()
const canvas = ref<HTMLCanvasElement | null>(null)
let revision = 0
watch(
  [() => props.photo, canvas],
  async () => {
    const token = ++revision
    if (!canvas.value) return
    let bitmap: ImageBitmap | undefined
    try {
      bitmap = await createImageBitmap(
        new Blob([new Uint8Array(props.photo.bytes)], { type: props.photo.mime }),
      )
      if (token !== revision || !canvas.value) return
      const scale = Math.min(160 / bitmap.width, 120 / bitmap.height, 1)
      canvas.value.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.value.height = Math.max(1, Math.round(bitmap.height * scale))
      canvas.value
        .getContext('2d')
        ?.drawImage(bitmap, 0, 0, canvas.value.width, canvas.value.height)
    } catch {
      // Upload has already decoded the image; keep the textual row usable if a preview fails.
    } finally {
      bitmap?.close()
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  revision++
  if (canvas.value) canvas.value.width = canvas.value.height = 0
})
</script>
<template>
  <canvas ref="canvas" class="max-h-32 max-w-40" role="img" aria-label="照片縮圖" />
</template>
