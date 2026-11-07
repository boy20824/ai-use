<script setup lang="ts">
import PageIntro from '@/components/PageIntro.vue'
import {
  batch,
  checkDimensions,
  defaultCuts,
  dimensions,
  encodeSlice,
  LIMITS,
  makeZip,
  moveCut,
  pad,
  readPixels,
  reorder,
  slices,
  type Source,
} from '@/splitter/core'
import { createPreviewRenderer, type PreviewState, type PreviewTarget } from '@/splitter/preview'
import { computed, onBeforeUnmount, ref, shallowRef, watchPostEffect } from 'vue'

const images = shallowRef<Source[]>([])
const selected = ref<number>()
const current = computed(() => images.value.find((image) => image.id === selected.value))
const busy = ref(false)
const error = ref('')
const status = ref('尚未加入圖片')
const input = ref<HTMLInputElement>()
const sourceCanvas = ref<HTMLCanvasElement>()
const sliceCanvases = ref<HTMLCanvasElement[]>([])
const previewState = ref<PreviewState>('empty')
const previewMessage = ref('')
const preview = createPreviewRenderer((state, message) => {
  previewState.value = state
  previewMessage.value = message
})
watchPostEffect(() => {
  const image = current.value
  const targets: PreviewTarget[] = []
  if (image && sourceCanvas.value) {
    targets.push({
      canvas: sourceCanvas.value,
      start: 0,
      end: image.height,
      maxWidth: 600,
      maxHeight: 8192,
    })
    for (const canvas of sliceCanvases.value) {
      targets.push({
        canvas,
        start: Number(canvas.dataset.start),
        end: Number(canvas.dataset.end),
        maxWidth: 100,
        maxHeight: 320,
      })
    }
  }
  preview.update(image, targets)
})
let alive = true
let serial = 0
let generation = 0
const downloadUrls = new Set<string>()
const timers = new Set<ReturnType<typeof setTimeout>>()
function releaseDownloads() {
  for (const timer of timers) clearTimeout(timer)
  timers.clear()
  for (const url of downloadUrls) URL.revokeObjectURL(url)
  downloadUrls.clear()
}
onBeforeUnmount(() => {
  alive = false
  generation++
  preview.dispose()
  releaseDownloads()
})
async function addFiles(files: File[]) {
  if (busy.value || !alive) return
  busy.value = true
  error.value = ''
  const token = ++generation
  try {
    if (images.value.length + files.length > LIMITS.images)
      throw new Error('最多加入 12 張圖片，請減少選取數量。')
    if (
      images.value.reduce((sum, image) => sum + image.file.size, 0) +
        files.reduce((sum, file) => sum + file.size, 0) >
      LIMITS.totalBytes
    )
      throw new Error('全部檔案合計不得超過 40 MiB。')
    for (const file of files) {
      if (!alive || token !== generation) return
      try {
        if (file.size > LIMITS.fileBytes) throw new Error('單檔不得超過 20 MiB。')
        const bytes = new Uint8Array(await file.arrayBuffer())
        if (!alive || token !== generation) return
        const size = dimensions(bytes)
        checkDimensions(size.width, size.height)
        if (
          images.value.reduce((sum, image) => sum + image.width * image.height, 0) +
            size.width * size.height >
          LIMITS.pixels
        )
          throw new Error('全部圖片合計不得超過 1200 萬像素；請移除圖片後再加入。')
        const bitmap = await createImageBitmap(file)
        let width: number, height: number
        try {
          width = bitmap.width
          height = bitmap.height
          checkDimensions(width, height)
        } finally {
          bitmap.close()
        }
        if (!alive || token !== generation) return
        const image: Source = {
          id: ++serial,
          name: file.name,
          file,
          width,
          height,
          cuts: defaultCuts(height),
        }
        images.value = [...images.value, image]
        selected.value ??= image.id
      } catch (cause) {
        if (alive)
          error.value += `${file.name}：${cause instanceof Error ? cause.message : '無法解碼圖片。'}\n`
      }
    }
    if (alive) status.value = `已加入 ${images.value.length} 張；依下列編號由上到下處理。`
  } catch (cause) {
    if (alive) error.value = cause instanceof Error ? cause.message : '無法加入圖片。'
  } finally {
    if (alive && token === generation) busy.value = false
  }
}
function choose(event: Event) {
  const target = event.target as HTMLInputElement
  void addFiles(Array.from(target.files ?? []))
  target.value = ''
}
function drop(event: DragEvent) {
  void addFiles(Array.from(event.dataTransfer?.files ?? []))
}
function move(index: number, offset: number) {
  if (busy.value) return
  releaseDownloads()
  images.value = reorder(images.value, index, index + offset)
}
function remove(id: number) {
  if (busy.value) return
  images.value = images.value.filter((item) => item.id !== id)
  if (selected.value === id) selected.value = images.value[0]?.id
  releaseDownloads()
}
function adjust(index: number, value: number) {
  if (busy.value || !current.value) return
  const image = current.value
  images.value = images.value.map((item) =>
    item.id === image.id ? { ...item, cuts: moveCut(item.cuts, index, value, image.height) } : item,
  )
  releaseDownloads()
}
function reset() {
  if (!current.value || busy.value) return
  const id = current.value.id
  images.value = images.value.map((item) =>
    item.id === id ? { ...item, cuts: defaultCuts(item.height) } : item,
  )
}
let drag: { pointer: number; index: number; id: number } | undefined
function pointerDown(event: PointerEvent, index: number) {
  if (busy.value || !current.value || (event.pointerType === 'mouse' && event.button !== 0)) return
  const target = event.currentTarget as HTMLElement
  target.focus({ preventScroll: true })
  target.setPointerCapture(event.pointerId)
  drag = { pointer: event.pointerId, index, id: current.value.id }
  event.preventDefault()
}
function pointerMove(event: PointerEvent) {
  if (!drag || drag.pointer !== event.pointerId || current.value?.id !== drag.id) return
  const rect = (event.currentTarget as HTMLElement).parentElement!.getBoundingClientRect()
  if (rect.height > 0)
    adjust(drag.index, ((event.clientY - rect.top) * current.value.height) / rect.height)
}
function pointerEnd(event: PointerEvent) {
  if (drag?.pointer === event.pointerId) drag = undefined
}
function keyCut(event: KeyboardEvent, index: number) {
  const image = current.value
  if (!image) return
  const delta = event.shiftKey ? 10 : 1
  const values: Record<string, number> = {
    ArrowUp: image.cuts[index] - delta,
    ArrowDown: image.cuts[index] + delta,
    ArrowLeft: image.cuts[index] - delta,
    ArrowRight: image.cuts[index] + delta,
    Home: 0,
    End: image.height,
  }
  if (event.key in values) {
    event.preventDefault()
    adjust(index, values[event.key])
  }
}
function save(bytes: Uint8Array<ArrayBuffer>, name: string, type: string) {
  if (!alive) return
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  downloadUrls.add(url)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  const timer = setTimeout(() => {
    URL.revokeObjectURL(url)
    downloadUrls.delete(url)
    timers.delete(timer)
  }, 30000)
  timers.add(timer)
}
async function exportImages(mode: 'zip' | 'all' | number) {
  if (busy.value || !current.value) return
  busy.value = true
  error.value = ''
  releaseDownloads()
  const token = ++generation
  const active = () => alive && token === generation
  const snapshot = images.value.map((image) => ({ ...image, cuts: [...image.cuts] }))
  const chosen = snapshot.findIndex((image) => image.id === selected.value)
  status.value = '依圖片順序產生 PNG 中…'
  try {
    if (mode === 'zip') {
      const zip = await makeZip(snapshot, active)
      if (zip && active()) save(new Uint8Array(zip), '詐騙訊息切割截圖.zip', 'application/zip')
    } else if (mode === 'all') {
      await batch(snapshot, active, async (path, png) => {
        if (active()) save(png, path.replace('/', '-'), 'image/png')
      })
    } else {
      const image = snapshot[chosen]
      const rgba = await readPixels(image)
      if (active())
        save(
          encodeSlice(rgba, image.width, image.height, slices(image.height, image.cuts)[mode]),
          `${pad(chosen)}-${pad(mode)}.png`,
          'image/png',
        )
    }
    if (active()) status.value = '已產生下載。若瀏覽器阻擋多檔下載，請下載 ZIP 或逐片點選。'
  } catch (cause) {
    if (active())
      error.value = cause instanceof Error ? cause.message : '產生失敗，請減少圖片數量後再試。'
  } finally {
    if (active()) busy.value = false
  }
}
</script>

<template>
  <section class="splitter-page" :aria-busy="busy">
    <PageIntro
      title="詐騙訊息切割截圖"
      description="多張長截圖，依序切成方便檢視的 PNG。所有圖片僅於本機瀏覽器處理，不上傳、不儲存。"
    />
    <div class="splitter-note">
      預設每片 1792 個來源像素，末片保留實際高度；原寬、不縮放、不補白，不避開訊息。
      可拖動切線，或聚焦切線以方向鍵調整 1px（Shift：10px，Home／End：可用範圍邊界）。
    </div>
    <div class="splitter-upload" @dragover.prevent @drop.prevent="drop">
      <button class="btn-primary" :disabled="busy" @click="input?.click()">選擇多張圖片</button>
      <input
        ref="input"
        class="sr-only"
        type="file"
        multiple
        accept="image/png,image/jpeg"
        aria-label="加入 PNG 或 JPEG 圖片"
        :disabled="busy"
        @change="choose"
      />
      <p>或將多張 PNG／JPEG 拖放到這裡；新增圖片會接在清單末尾。</p>
      <small
        >最多 12 張、單檔 20 MiB、合計 40 MiB／1200 萬像素；每張寬 ≤8192、高 ≤24000px。匯出無壓縮
        PNG，較大批次可能需要數百 MiB 記憶體；不足時請減少圖片。</small
      >
    </div>
    <p role="status" class="splitter-status">{{ status }}</p>
    <p v-if="error" role="alert" class="splitter-error">{{ error }}</p>
    <div class="splitter-actions">
      <button class="btn-primary" :disabled="busy || !images.length" @click="exportImages('zip')">
        依序下載 ZIP
      </button>
      <button class="btn-secondary" :disabled="busy || !images.length" @click="exportImages('all')">
        依序下載所有 PNG
      </button>
    </div>
    <div v-if="images.length" class="splitter-layout">
      <aside class="splitter-list data-panel" aria-label="圖片處理順序">
        <h2>圖片順序</h2>
        <ol>
          <li v-for="(image, index) in images" :key="image.id" :data-source="image.name">
            <button
              class="splitter-select"
              :aria-pressed="selected === image.id"
              :disabled="busy"
              @click="selected = image.id"
            >
              {{ pad(index) }} · {{ image.name
              }}<small
                >{{ image.width }} × {{ image.height }}px · {{ image.cuts.length + 1 }} 片</small
              >
            </button>
            <div class="splitter-actions">
              <button
                class="btn-secondary"
                :aria-label="`上移 ${image.name}`"
                :disabled="busy || index === 0"
                @click="move(index, -1)"
              >
                上移
              </button>
              <button
                class="btn-secondary"
                :aria-label="`下移 ${image.name}`"
                :disabled="busy || index === images.length - 1"
                @click="move(index, 1)"
              >
                下移
              </button>
              <button
                class="btn-secondary"
                :aria-label="`移除 ${image.name}`"
                :disabled="busy"
                @click="remove(image.id)"
              >
                移除
              </button>
            </div>
          </li>
        </ol>
      </aside>
      <div v-if="current" class="splitter-workspace">
        <div class="splitter-actions">
          <h2>{{ current.name }}</h2>
          <button class="btn-secondary" :disabled="busy" @click="reset">重設為 1792px</button>
        </div>
        <p>預覽配合畫面縮小，輸出保留來源像素。ZIP 路徑：圖片編號／切片編號.png。</p>
        <p
          class="splitter-preview-status"
          :data-state="previewState"
          :role="previewState === 'error' ? 'alert' : 'status'"
        >
          {{ previewMessage }}
        </p>
        <div
          class="splitter-source"
          :style="{ aspectRatio: `${current.width} / ${current.height}` }"
        >
          <canvas ref="sourceCanvas" role="img" aria-label="待切割原圖預覽">待切割原圖預覽</canvas>
          <button
            v-for="(cut, index) in current.cuts"
            :key="`${current.id}-${index}`"
            class="splitter-cut"
            role="slider"
            aria-orientation="vertical"
            :aria-label="`切線 ${index + 1}（來源列）`"
            :aria-valuemin="(current.cuts[index - 1] ?? 0) + 1"
            :aria-valuemax="(current.cuts[index + 1] ?? current.height) - 1"
            :aria-valuenow="cut"
            :style="{ top: `${(cut / current.height) * 100}%` }"
            :disabled="busy"
            @pointerdown="pointerDown($event, index)"
            @pointermove="pointerMove"
            @pointerup="pointerEnd"
            @pointercancel="pointerEnd"
            @lostpointercapture="pointerEnd"
            @keydown="keyCut($event, index)"
          >
            <span>{{ cut }}px ↕</span>
          </button>
        </div>
        <h2>切片預覽與尺寸</h2>
        <ol class="splitter-slices">
          <li v-for="(slice, index) in slices(current.height, current.cuts)" :key="index">
            <div
              class="splitter-thumbnail"
              :style="{ aspectRatio: `${current.width} / ${slice.end - slice.start}` }"
            >
              <canvas
                ref="sliceCanvases"
                role="img"
                :aria-label="`切片 ${index + 1} 預覽`"
                :data-start="slice.start"
                :data-end="slice.end"
                >切片 {{ index + 1 }} 預覽</canvas
              >
            </div>
            <div>
              <strong>{{ pad(index) }}.png</strong>
              <p>{{ current.width }} × {{ slice.end - slice.start }}px</p>
              <small>來源列 [{{ slice.start }}, {{ slice.end }})</small>
            </div>
            <button
              class="btn-secondary"
              :disabled="busy"
              :aria-label="`下載切片 ${index + 1} PNG`"
              @click="exportImages(index)"
            >
              下載 PNG
            </button>
          </li>
        </ol>
      </div>
    </div>
  </section>
</template>

<style scoped>
.splitter-note,
.splitter-upload {
  padding: 18px;
  border: 1px solid var(--color-edge);
  border-radius: 8px;
  background: white;
  margin-bottom: 16px;
  line-height: 1.8;
}
.splitter-note {
  background: var(--color-accent-soft);
}
.splitter-upload {
  border-style: dashed;
  text-align: center;
}
.splitter-upload small,
.splitter-workspace > p,
.splitter-slices small {
  color: var(--color-ink-muted);
  font-size: 12px;
}
.splitter-status {
  margin: 12px 0;
  font-size: 14px;
}
.splitter-error {
  white-space: pre-wrap;
  color: var(--color-tone-danger-ink);
}
.splitter-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 10px 0;
}
.splitter-actions button,
.splitter-slices button {
  min-height: 44px;
}
.splitter-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 20px;
  margin-top: 20px;
  align-items: start;
}
.splitter-list h2 {
  padding: 16px;
}
.splitter-list li {
  padding: 12px;
  border-top: 1px solid var(--color-edge);
}
.splitter-select {
  width: 100%;
  text-align: left;
  overflow-wrap: anywhere;
  padding: 8px;
  border-radius: 4px;
}
.splitter-select[aria-pressed='true'] {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}
.splitter-select small {
  display: block;
}
.splitter-workspace {
  min-width: 0;
}
.splitter-workspace h2 {
  overflow-wrap: anywhere;
  font-weight: 600;
}
.splitter-source {
  position: relative;
  width: 100%;
  max-width: 600px;
  margin: 24px auto;
  background: white;
}
.splitter-source > canvas {
  width: 100%;
  height: 100%;
  display: block;
  user-select: none;
}
.splitter-cut {
  position: absolute;
  left: 0;
  width: 100%;
  height: 44px;
  transform: translateY(-50%);
  touch-action: none;
  cursor: ns-resize;
  z-index: 1;
}
.splitter-cut::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  border-top: 2px solid #b42318;
}
.splitter-cut span {
  position: relative;
  background: #b42318;
  color: white;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
}
.splitter-cut:focus-visible {
  z-index: 2;
}
.splitter-slices {
  display: grid;
  gap: 12px;
  margin-top: 12px;
}
.splitter-slices li {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  padding: 16px;
  background: white;
  border: 1px solid var(--color-edge);
  border-radius: 8px;
}
.splitter-slices li > div:nth-child(2) {
  flex: 1;
}
.splitter-thumbnail {
  width: 100px;
  overflow: hidden;
  position: relative;
  background: var(--color-canvas);
}
.splitter-thumbnail canvas {
  display: block;
  width: 100%;
  height: 100%;
}
@media (max-width: 767px) {
  .splitter-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .splitter-thumbnail {
    width: 64px;
  }
}
</style>
