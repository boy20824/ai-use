<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { cropBitmap, type Source } from '@/splitter/core'
import {
  clampScroll,
  edgeVelocity,
  nearbyCuts,
  sourceRow,
  sourceScale,
  visibleTiles,
} from '@/splitter/scrollGeometry'

const props = defineProps<{ source: Source; disabled: boolean }>()
const emit = defineEmits<{ adjust: [index: number, row: number] }>()
const viewport = ref<HTMLElement>()
const spacer = ref<HTMLElement>()
const rangeMessage = ref('')
const measured = ref(false)
const width = ref(1)
const height = ref(600)
const scroll = ref(0)
const message = ref('')
const scale = computed(() => sourceScale(props.source.width, width.value))
const tiles = computed<ReturnType<typeof visibleTiles>>((previous) => {
  const next = measured.value
    ? visibleTiles(props.source.width, props.source.height, scale.value, scroll.value, height.value)
    : []
  return previous &&
    previous.length === next.length &&
    previous.every(
      (tile, index) => tile.start === next[index].start && tile.end === next[index].end,
    )
    ? previous
    : next
})
const canvases = new Map<number, HTMLCanvasElement>()
let revision = 0
let loading = false
let disposed = false
let resize: ResizeObserver | undefined
let frame = 0
let drag:
  { pointer: number; index: number; y: number; target: HTMLElement; time?: number } | undefined
const focusIndex = ref<number>()
const lines = computed(() => {
  if (!measured.value) return []
  const indices = nearbyCuts(
    props.source.cuts,
    (scroll.value - 44) / scale.value,
    (scroll.value + height.value + 44) / scale.value,
  )
  for (const index of [drag?.index, focusIndex.value])
    if (index !== undefined && !indices.includes(index)) indices.push(index)
  return indices
})
function canvasRef(start: number, node: unknown) {
  const old = canvases.get(start)
  if (old && old !== node) {
    old.width = old.height = 0
    canvases.delete(start)
  }
  if (node instanceof HTMLCanvasElement && old !== node) {
    node.width = node.height = 0
    canvases.set(start, node)
  }
}
function clear() {
  for (const canvas of canvases.values()) canvas.width = canvas.height = 0
}
async function render() {
  if (loading || disposed) return
  loading = true
  try {
    while (!disposed) {
      const token = revision
      const source = props.source
      const requested = tiles.value.map((tile) => ({ ...tile, canvas: canvases.get(tile.start) }))
      try {
        for (const { start, end, canvas } of requested) {
          if (disposed || token !== revision) break
          if (!canvas || canvas.width) continue
          const bitmap = await cropBitmap(
            source.file,
            start,
            source.width,
            end - start,
            undefined,
            () => !disposed && token === revision,
          )
          try {
            if (disposed || token !== revision) break
            // CSS uses the exact source scale; backing stores need no device-pixel upscaling.
            const ratio = Math.min(scale.value, 4096 / source.width)
            canvas.width = Math.max(1, Math.round(source.width * ratio))
            canvas.height = Math.max(1, Math.round((end - start) * ratio))
            const context = canvas.getContext('2d')
            if (!context) throw new Error('瀏覽器無法建立預覽畫布。')
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
          } finally {
            bitmap.close()
          }
        }
        if (token === revision) {
          message.value = ''
          return
        }
      } catch (error) {
        if (token === revision) {
          clear()
          message.value = error instanceof Error ? error.message : '無法繪製預覽。'
          return
        }
      }
    }
  } finally {
    loading = false
  }
}
function syncScroll() {
  const box = viewport.value
  if (!box) return
  box.scrollTop = clampScroll(box.scrollTop, props.source.height * scale.value, height.value)
  scroll.value = box.scrollTop
  if (drag) updateCut()
}
async function checkScrollRange() {
  await nextTick()
  if (disposed) return
  const actual = spacer.value?.getBoundingClientRect().height ?? 0
  const requested = props.source.height * scale.value
  rangeMessage.value =
    actual > 0 && actual + 1 < requested
      ? `此瀏覽器的 CSS 捲動高度無法表示完整預覽（需要 ${requested}px，實際 ${actual}px）。請使用較小的來源圖片；輸出尺寸不受此預覽限制影響。`
      : ''
}
function measure() {
  const box = viewport.value
  if (!box) return
  const row = scroll.value / scale.value
  const style = getComputedStyle(box)
  width.value = Math.max(
    1,
    box.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0'),
  )
  height.value = Math.max(
    1,
    box.clientHeight - parseFloat(style.paddingTop || '0') - parseFloat(style.paddingBottom || '0'),
  )
  measured.value = true
  box.scrollTop = clampScroll(row * scale.value, props.source.height * scale.value, height.value)
  syncScroll()
  void checkScrollRange()
}
function contentTop() {
  const box = viewport.value!
  return (
    box.getBoundingClientRect().top +
    box.clientTop +
    parseFloat(getComputedStyle(box).paddingTop || '0')
  )
}
function updateCut() {
  if (drag && !props.disabled)
    emit('adjust', drag.index, sourceRow(drag.y, contentTop(), scroll.value, scale.value))
}
function stop() {
  const previous = drag
  drag = undefined
  cancelAnimationFrame(frame)
  frame = 0
  if (previous?.target.hasPointerCapture?.(previous.pointer))
    previous.target.releasePointerCapture(previous.pointer)
}
function tick(time: number) {
  if (!drag || !viewport.value) return
  const dt = Math.min(32, drag.time === undefined ? 16 : time - drag.time)
  drag.time = time
  const box = viewport.value
  box.scrollTop = clampScroll(
    box.scrollTop + (edgeVelocity(drag.y, contentTop(), height.value) * dt) / 1000,
    props.source.height * scale.value,
    height.value,
  )
  syncScroll()
  frame = requestAnimationFrame(tick)
}
function down(event: PointerEvent, index: number) {
  if (props.disabled || (event.pointerType === 'mouse' && event.button !== 0)) return
  stop()
  const target = event.currentTarget as HTMLElement
  target.focus({ preventScroll: true })
  target.setPointerCapture(event.pointerId)
  drag = { pointer: event.pointerId, index, y: event.clientY, target }
  event.preventDefault()
  frame = requestAnimationFrame(tick)
}
function move(event: PointerEvent) {
  if (drag?.pointer !== event.pointerId) return
  event.preventDefault()
  drag.y = event.clientY
  updateCut()
}
function end(event: PointerEvent) {
  if (drag?.pointer === event.pointerId) stop()
}
function key(event: KeyboardEvent, index: number) {
  const delta = event.shiftKey ? 10 : 1
  const values: Record<string, number> = {
    ArrowUp: props.source.cuts[index] - delta,
    ArrowDown: props.source.cuts[index] + delta,
    ArrowLeft: props.source.cuts[index] - delta,
    ArrowRight: props.source.cuts[index] + delta,
    Home: 0,
    End: props.source.height,
  }
  if (event.key in values) {
    event.preventDefault()
    emit('adjust', index, values[event.key])
  }
}
watch(
  () => props.source.id,
  () => {
    stop()
    focusIndex.value = undefined
    clear()
    revision++
    if (viewport.value) viewport.value.scrollTop = 0
    scroll.value = 0
  },
)
watch(
  () => props.disabled,
  (value) => {
    if (value) stop()
  },
)
watch(
  [tiles, scale, () => props.source.file],
  async () => {
    revision++
    // Release detached backing synchronously, including in-flight stale targets.
    const retained = new Set(tiles.value.map((tile) => tile.start))
    for (const [start, canvas] of canvases)
      if (!retained.has(start)) canvas.width = canvas.height = 0
    await nextTick()
    void render()
  },
  { flush: 'post', immediate: true },
)
watch(scale, clear, { flush: 'sync' })
watch([scale, () => props.source.height], checkScrollRange, { flush: 'post' })
onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined') {
    resize = new ResizeObserver(measure)
    resize.observe(viewport.value!)
  }
})
onBeforeUnmount(() => {
  disposed = true
  revision++
  stop()
  resize?.disconnect()
  clear()
  canvases.clear()
})
</script>

<template>
  <div
    ref="viewport"
    class="splitter-source"
    tabindex="0"
    aria-label="可捲動的原圖預覽"
    @scroll="syncScroll"
  >
    <div
      ref="spacer"
      class="splitter-source-spacer"
      :style="{ width: `${source.width * scale}px`, height: `${source.height * scale}px` }"
    >
      <canvas
        v-for="tile in tiles"
        :key="`${source.id}-${tile.start}`"
        :ref="(node) => canvasRef(tile.start, node)"
        class="splitter-source-tile"
        role="img"
        :aria-label="`原圖來源列 ${tile.start} 至 ${tile.end}`"
        :data-start="tile.start"
        :data-end="tile.end"
        :style="{
          top: `${tile.start * scale}px`,
          width: `${source.width * scale}px`,
          height: `${(tile.end - tile.start) * scale}px`,
        }"
      />
      <button
        v-for="index in lines"
        :key="`${source.id}-${index}`"
        class="splitter-cut"
        role="slider"
        aria-orientation="vertical"
        :aria-label="`切線 ${index + 1}（來源列）`"
        :aria-valuemin="(source.cuts[index - 1] ?? 0) + 1"
        :aria-valuemax="(source.cuts[index + 1] ?? source.height) - 1"
        :aria-valuenow="source.cuts[index]"
        :style="{ top: `${source.cuts[index] * scale}px` }"
        :disabled="disabled"
        @pointerdown="down($event, index)"
        @pointermove="move"
        @pointerup="end"
        @pointercancel="end"
        @lostpointercapture="end"
        @keydown="key($event, index)"
        @focus="focusIndex = index"
        @blur="focusIndex = undefined"
      >
        <span>{{ source.cuts[index] }}px ↕</span>
      </button>
    </div>
  </div>
  <p v-if="rangeMessage" role="alert">{{ rangeMessage }}</p>
  <p v-if="message" role="alert">{{ message }}</p>
</template>

<style scoped>
.splitter-source {
  height: 70vh;
  overflow: auto;
  overscroll-behavior: contain;
  position: relative;
  padding: 0;
  border: 1px solid var(--color-edge);
  margin: 24px 0;
  background: white;
}
.splitter-source-spacer {
  position: relative;
  margin: 0 auto;
}
.splitter-source-tile {
  position: absolute;
  left: 0;
  display: block;
  user-select: none;
  pointer-events: none;
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
</style>
