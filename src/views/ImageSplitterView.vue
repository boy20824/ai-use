<script setup lang="ts">
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import SplitterSourcePreview from '@/components/SplitterSourcePreview.vue'
import PageIntro from '@/components/PageIntro.vue'
import {
  batch,
  checkDimensions,
  defaultCuts,
  readDimensions,
  LIMITS,
  makeZip,
  moveCut,
  pad,
  reorder,
  slices,
  type Source,
} from '@/splitter/core'
import { createDocx, DOCX_MIME, docxFilename, victimNameError } from '@/splitter/docx'
import { createPreviewRenderer, type PreviewState, type PreviewTarget } from '@/splitter/preview'
import { computed, onBeforeUnmount, ref, shallowRef, watchPostEffect } from 'vue'

const victimName = ref('')
const nameError = computed(() => victimNameError(victimName.value))
const wordHint = computed(
  () => nameError.value || (!images.value.length ? '請先加入圖片並完成切割。' : ''),
)
const wordProgress = ref('')
const images = shallowRef<Source[]>([])
const selected = ref<number>()
const current = computed(() => images.value.find((image) => image.id === selected.value))
const busy = ref(false)
const error = ref('')
const status = ref('尚未加入圖片')
const input = ref<HTMLInputElement>()
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
  if (image) {
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
  releaseDownloads()
  error.value = ''
  const token = ++generation
  try {
    for (const file of files) {
      if (!alive || token !== generation) return
      try {
        if (file.size > LIMITS.fileBytes) throw new Error('單檔不得超過 200 MiB。')
        const { width, height } = await readDimensions(file)
        checkDimensions(width, height)
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
const pendingRemove = ref<number | null>(null)
function confirmRemove() {
  if (pendingRemove.value === null) return
  remove(pendingRemove.value)
  pendingRemove.value = null
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
  const cuts = moveCut(image.cuts, index, value, image.height)
  if (cuts[index] === image.cuts[index]) return
  images.value = images.value.map((item) => (item.id === image.id ? { ...item, cuts } : item))
  releaseDownloads()
}
function reset() {
  if (!current.value || busy.value) return
  releaseDownloads()
  const id = current.value.id
  images.value = images.value.map((item) =>
    item.id === id ? { ...item, cuts: defaultCuts(item.height) } : item,
  )
}
function save(bytes: Uint8Array<ArrayBuffer> | Blob, name: string, type: string) {
  if (!alive) return
  const url = URL.createObjectURL(bytes instanceof Blob ? bytes : new Blob([bytes], { type }))
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
      await batch(
        snapshot,
        active,
        async (path, png) => {
          if (active()) save(png, path.replace('/', '-'), 'image/png')
        },
        undefined,
        { imageIndex: chosen, sliceIndex: mode },
      )
    }
    if (active()) status.value = '已產生下載。若瀏覽器阻擋多檔下載，請下載 ZIP 或逐片點選。'
  } catch (cause) {
    releaseDownloads()
    if (active()) {
      status.value = '產生失敗，已清除暫存下載連結。'
      error.value = `產生失敗，可能記憶體不足；請改用逐片 PNG、減少本次圖片，或將來源轉存為 PNG 後重試。${cause instanceof Error ? cause.message : ''}`
    }
  } finally {
    if (active()) busy.value = false
  }
}
async function exportWord() {
  if (busy.value || wordHint.value) return
  busy.value = true
  error.value = ''
  releaseDownloads()
  const token = ++generation
  const active = () => alive && token === generation
  const snapshot = images.value.map((image) => ({ ...image, cuts: [...image.cuts] }))
  const name = victimName.value.trim()
  const total = snapshot.reduce((sum, image) => sum + image.cuts.length + 1, 0)
  wordProgress.value = `已處理第 0/${total} 張`
  status.value = '正在產出 Word…'
  try {
    const bytes = await createDocx({
      name,
      total,
      active,
      images: (append) =>
        batch(snapshot, active, async (_path, png) => {
          await append(new Uint8Array(await png.arrayBuffer()))
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }),
      onProgress: (processed, count) => {
        if (active()) wordProgress.value = `已處理第 ${processed}/${count} 張`
      },
    })
    if (active()) {
      save(bytes, docxFilename(name), DOCX_MIME)
      status.value = 'Word 已產生下載。'
    }
  } catch {
    if (active()) {
      releaseDownloads()
      status.value = 'Word 產出失敗。'
      error.value =
        '無法產出 Word，可能是範本讀取失敗或記憶體不足。請稍後重試、減少本次圖片，或改用 PNG／ZIP 下載；若持續失敗請聯絡管理員。'
    }
  } finally {
    if (active()) {
      busy.value = false
      wordProgress.value = ''
    }
  }
}
</script>

<template>
  <ConfirmDialog
    v-if="pendingRemove !== null"
    title="移除圖片"
    @confirm="confirmRemove"
    @cancel="pendingRemove = null"
  >
    將移除「{{
      images.find((image) => image.id === pendingRemove)?.name
    }}」及其切割設定，需要時須重新加入圖片。
  </ConfirmDialog>
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
        >單檔上限 200
        MiB；不限制圖片張數、合計容量或像素。逐張裁切處理，但瀏覽器解碼器可能仍在內部解碼整張圖片。
        PNG 為無壓縮輸出；ZIP 會保留全部編碼結果並在記憶體組合封存，可能耗盡記憶體。大圖建議逐片下載
        PNG。</small
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
    <div class="splitter-word data-panel">
      <label for="splitter-victim-name">被害人姓名（必填）</label>
      <input
        id="splitter-victim-name"
        v-model="victimName"
        type="text"
        maxlength="50"
        required
        autocomplete="off"
        :disabled="busy"
        :aria-invalid="!!nameError"
        aria-describedby="splitter-word-hint"
      />
      <button class="btn-primary" :disabled="busy || !!wordHint" @click="exportWord">
        產出 Word
      </button>
      <p id="splitter-word-hint">
        {{ wordHint || '每頁依序放置 3 張切片，姓名僅用於本機產出 Word。' }}
      </p>
      <p v-if="wordProgress" role="status">{{ wordProgress }}</p>
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
                @click="pendingRemove = image.id"
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
        <p>
          原圖以原尺寸顯示，超過可用寬度才縮小；可捲動查看完整圖片，輸出保留來源像素。ZIP
          路徑：圖片編號／切片編號.png。
        </p>
        <p
          class="splitter-preview-status"
          :data-state="previewState"
          :role="previewState === 'error' ? 'alert' : 'status'"
        >
          {{ previewMessage }}
        </p>
        <SplitterSourcePreview :source="current" :disabled="busy" @adjust="adjust" />
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
.splitter-word {
  padding: 16px;
  line-height: 1.8;
}
.splitter-word input {
  border: 1px solid var(--color-edge);
  border-radius: 4px;
  padding: 8px;
  margin: 8px;
  max-width: 100%;
}

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
  max-height: 320px;
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
