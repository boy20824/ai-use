import { bandRows, cropBitmap, type CropDecoder, type Source } from './core'

export interface PreviewTarget {
  canvas: HTMLCanvasElement
  start: number
  end: number
  maxWidth: number
  maxHeight: number
}
type PreviewSource = Pick<Source, 'file' | 'width' | 'height'>
export type PreviewState = 'empty' | 'loading' | 'ready' | 'error'

// One cropped bitmap at a time, no retained decoder bitmap. Thumbnails outside
// the viewport have no backing store. The source overview has a fixed backing bound.
export function createPreviewRenderer(
  report: (state: PreviewState, message: string) => void,
  decode?: CropDecoder,
) {
  let source: PreviewSource | undefined
  let targets: PreviewTarget[] = []
  let revision = 0
  let loading = false
  let disposed = false
  const visible = new Set<HTMLCanvasElement>()
  const observer =
    typeof IntersectionObserver === 'undefined'
      ? undefined
      : new IntersectionObserver((entries) => {
          let changed = false
          for (const entry of entries) {
            const canvas = entry.target as HTMLCanvasElement
            if (entry.isIntersecting) {
              if (!visible.has(canvas)) {
                visible.add(canvas)
                changed = true
              }
            } else {
              visible.delete(canvas)
              canvas.width = canvas.height = 0
            }
          }
          if (changed) {
            revision++
            void load()
          }
        })
  function clear() {
    for (const { canvas } of targets) canvas.width = canvas.height = 0
  }
  async function load() {
    if (loading || disposed) return
    loading = true
    try {
      while (source && !disposed) {
        const token = revision
        const requested = source
        const selected = targets.filter(
          (target, index) => index === 0 || !observer || visible.has(target.canvas),
        )
        try {
          for (const { canvas, start, end, maxWidth, maxHeight } of selected) {
            if (start < 0 || end > requested.height || end <= start)
              throw new Error('預覽範圍無效。')
            const scale = Math.min(
              1,
              Math.min(600, maxWidth) / requested.width,
              Math.min(2048, maxHeight) / (end - start),
            )
            canvas.width = Math.max(1, Math.round(requested.width * scale))
            canvas.height = Math.max(1, Math.round((end - start) * scale))
          }
          for (let start = 0; start < requested.height; start += bandRows(requested.width)) {
            if (disposed || revision !== token) break
            const end = Math.min(requested.height, start + bandRows(requested.width))
            const intersecting = selected.filter(
              (target) => target.start < end && target.end > start,
            )
            if (!intersecting.length) continue
            const bitmap = await cropBitmap(
              requested.file,
              start,
              requested.width,
              end - start,
              decode,
            )
            try {
              if (disposed || revision !== token) break
              for (const { canvas, start: from, end: to } of intersecting) {
                const top = Math.max(start, from),
                  bottom = Math.min(end, to)
                const context = canvas.getContext('2d')
                if (!context) throw new Error('瀏覽器無法建立預覽畫布。')
                context.drawImage(
                  bitmap,
                  0,
                  top - start,
                  requested.width,
                  bottom - top,
                  0,
                  ((top - from) * canvas.height) / (to - from),
                  canvas.width,
                  ((bottom - top) * canvas.height) / (to - from),
                )
              }
            } finally {
              bitmap.close()
            }
          }
          if (!disposed && revision === token) {
            report('ready', '預覽已就緒；畫面縮小顯示，切線與下載仍使用來源像素。')
            return
          }
        } catch (cause) {
          if (!disposed && revision === token) {
            clear()
            report(
              'error',
              cause instanceof Error ? cause.message : '無法繪製預覽；請轉存 PNG 後重試。',
            )
            return
          }
        }
      }
    } finally {
      loading = false
    }
  }
  return {
    update(next: PreviewSource | undefined, nextTargets: PreviewTarget[]) {
      if (disposed) return
      revision++
      clear()
      observer?.disconnect()
      source = next
      targets = nextTargets
      clear()
      for (const canvas of visible) {
        if (!targets.some((target) => target.canvas === canvas)) visible.delete(canvas)
      }
      for (const target of targets.slice(1)) observer?.observe(target.canvas)
      if (!source) {
        report('empty', '')
        return
      }
      report('loading', '正在繪製本機預覽…')
      void load()
    },
    dispose() {
      disposed = true
      revision++
      source = undefined
      observer?.disconnect()
      visible.clear()
      clear()
      targets = []
    },
  }
}
