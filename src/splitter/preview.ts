import type { Source } from './core'

export interface PreviewTarget {
  canvas: HTMLCanvasElement
  start: number
  end: number
  maxWidth: number
  maxHeight: number
}
type PreviewSource = Pick<Source, 'file' | 'width' | 'height'>
export type PreviewState = 'empty' | 'loading' | 'ready' | 'error'

// Files go directly to the raster decoder: no URL, IMG, network or storage path.
// One retained bitmap and at most one pending decode, even during rapid selection changes.
export function createPreviewRenderer(
  report: (state: PreviewState, message: string) => void,
  decode: (file: File) => Promise<ImageBitmap> = (file) => createImageBitmap(file),
) {
  let source: PreviewSource | undefined
  let targets: PreviewTarget[] = []
  let bitmap: ImageBitmap | undefined
  let decodedFile: File | undefined
  let loading = false
  let disposed = false
  function clear() {
    for (const { canvas } of targets) canvas.width = canvas.height = 0
  }
  function close() {
    bitmap?.close()
    bitmap = undefined
    decodedFile = undefined
  }
  function draw() {
    if (!source || !bitmap || disposed) return
    try {
      for (const { canvas, start, end, maxWidth, maxHeight } of targets) {
        const height = end - start
        if (start < 0 || end > source.height || height <= 0) throw new Error('預覽範圍無效。')
        const scale = Math.min(1, maxWidth / source.width, maxHeight / height)
        canvas.width = Math.max(1, Math.round(source.width * scale))
        canvas.height = Math.max(1, Math.round(height * scale))
        const context = canvas.getContext('2d')
        if (!context) throw new Error('瀏覽器無法建立預覽畫布。')
        context.drawImage(bitmap, 0, start, source.width, height, 0, 0, canvas.width, canvas.height)
      }
      report('ready', '預覽已就緒；畫面縮小顯示，切線與下載仍使用來源像素。')
    } catch (cause) {
      clear()
      close()
      report('error', cause instanceof Error ? cause.message : '無法繪製預覽。')
    }
  }
  async function load() {
    if (loading || disposed) return
    loading = true
    try {
      while (source && !disposed) {
        const requested = source
        let result: ImageBitmap | undefined
        try {
          result = await decode(requested.file)
          if (disposed || source?.file !== requested.file) continue
          if (result.width !== source.width || result.height !== source.height)
            throw new Error('預覽圖片尺寸不一致，請重新加入。')
          bitmap = result
          decodedFile = requested.file
          result = undefined
          draw()
          return
        } catch (cause) {
          if (!disposed && source?.file === requested.file) {
            clear()
            report('error', cause instanceof Error ? cause.message : '無法解碼預覽。')
            return
          }
        } finally {
          result?.close()
        }
      }
    } finally {
      loading = false
    }
  }
  return {
    update(next: PreviewSource | undefined, nextTargets: PreviewTarget[]) {
      if (disposed) return
      clear()
      const changed = source?.file !== next?.file
      source = next
      targets = nextTargets
      if (changed) close()
      if (!source) {
        report('empty', '')
        return
      }
      if (bitmap && decodedFile === source.file) {
        draw()
        return
      }
      report('loading', '正在繪製本機預覽…')
      void load()
    },
    dispose() {
      disposed = true
      source = undefined
      clear()
      targets = []
      close()
    },
  }
}
