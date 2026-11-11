import { checkPhotoBytes, type BlockPhoto } from '../../shared/photoBlockRender'
import { dimensions } from '@/splitter/core'

/** Decode only local raster data. Re-encode a bounded canvas to strip metadata and
 * keep both memory and DOCX size predictable. No URL, network or persistence. */
export async function loadBlockPhoto(file: File): Promise<BlockPhoto> {
  if (file.size > 10 * 1024 * 1024) throw new Error('單張照片不可超過 10 MB。')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = file.type
  checkPhotoBytes(bytes, mime)
  const header = dimensions(bytes)
  if (header.width < 1 || header.height < 1 || header.width * header.height > 40_000_000)
    throw new Error('照片尺寸過大，請先縮小至 4,000 萬像素以內。')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('照片解碼失敗，請重新匯出為 PNG 或 JPEG 後再試。')
  }
  const canvas = document.createElement('canvas')
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('瀏覽器無法建立照片畫布。')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result ? resolve(result) : reject(new Error('照片轉換失敗，請換一張照片再試。')),
        mime,
        0.85,
      ),
    )
    return {
      id: crypto.randomUUID(),
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mime,
      width: canvas.width,
      height: canvas.height,
      description: '',
    }
  } finally {
    bitmap.close()
    canvas.width = canvas.height = 0
  }
}
