import JSZip from 'jszip'

export const SLICE_HEIGHT = 1792
export const LIMITS = {
  images: 12,
  fileBytes: 20 * 1024 ** 2,
  totalBytes: 40 * 1024 ** 2,
  pixels: 12_000_000,
  width: 8192,
  height: 24000,
}
export interface Source {
  id: number
  name: string
  file: File
  width: number
  height: number
  cuts: number[]
}
export interface Slice {
  start: number
  end: number
}
export function defaultCuts(height: number) {
  return Array.from(
    { length: Math.floor((height - 1) / SLICE_HEIGHT) },
    (_, i) => (i + 1) * SLICE_HEIGHT,
  )
}
export function moveCut(cuts: number[], index: number, value: number, height: number) {
  const next = [...cuts]
  if (index < 0 || index >= cuts.length || !Number.isFinite(value)) return next
  next[index] = Math.max(
    (cuts[index - 1] ?? 0) + 1,
    Math.min((cuts[index + 1] ?? height) - 1, Math.round(value)),
  )
  return next
}
export function slices(height: number, cuts: number[]): Slice[] {
  const points = [0, ...cuts, height]
  if (
    !Number.isInteger(height) ||
    height < 1 ||
    points.some((p, i) => !Number.isInteger(p) || (i > 0 && p <= points[i - 1]))
  )
    throw new Error('切線必須依序排列且每片至少 1px。')
  return points.slice(0, -1).map((start, i) => ({ start, end: points[i + 1] }))
}
export const pad = (index: number) => String(index + 1).padStart(3, '0')
export function plan(images: Pick<Source, 'width' | 'height' | 'cuts'>[]) {
  return images.flatMap((image, imageIndex) =>
    slices(image.height, image.cuts).map((slice, sliceIndex) => ({
      ...slice,
      imageIndex,
      sliceIndex,
      width: image.width,
      path: `${pad(imageIndex)}/${pad(sliceIndex)}.png`,
    })),
  )
}
export function reorder<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length) return items
  const result = [...items]
  result.splice(to, 0, result.splice(from, 1)[0])
  return result
}
export function checkDimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > LIMITS.width ||
    height > LIMITS.height ||
    width * height > LIMITS.pixels
  )
    throw new Error('圖片超過限制：寬 8192、高 24000、總計 1200 萬像素。')
}
// Inspect raster headers before invoking the browser decoder. SVG is excluded.
export function dimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (
    bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b) &&
    view.getUint32(12) === 0x49484452
  )
    return { width: view.getUint32(16), height: view.getUint32(20) }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      if (marker === 0xda || marker === 0xd9) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 2 > bytes.length) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8)
        return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) }
      offset += length
    }
  }
  throw new Error('無法讀取圖片；僅支援有效的 PNG、JPEG。')
}
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff
  for (const byte of bytes) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, bytes: Uint8Array) {
  const result = new Uint8Array(bytes.length + 12)
  const view = new DataView(result.buffer)
  view.setUint32(0, bytes.length)
  result.set(new TextEncoder().encode(type), 4)
  result.set(bytes, 8)
  view.setUint32(result.length - 4, crc32(result.subarray(4, -4)))
  return result
}
// Lossless RGBA PNG: filter 0, stored DEFLATE blocks. No resizing, padding or canvas re-encoding.
export function encodeSlice(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  slice: Slice,
): Uint8Array<ArrayBuffer> {
  checkDimensions(width, height)
  if (
    rgba.length !== width * height * 4 ||
    !Number.isInteger(slice.start) ||
    !Number.isInteger(slice.end) ||
    slice.start < 0 ||
    slice.end > height ||
    slice.end <= slice.start
  )
    throw new Error('切片像素範圍無效。')
  const stride = width * 4
  const raw = new Uint8Array((stride + 1) * (slice.end - slice.start))
  for (let row = slice.start; row < slice.end; row++)
    raw.set(rgba.subarray(row * stride, (row + 1) * stride), (row - slice.start) * (stride + 1) + 1)
  const blocks = Math.ceil(raw.length / 65535)
  const zlib = new Uint8Array(2 + blocks * 5 + raw.length + 4)
  zlib.set([0x78, 0x01])
  let pos = 2
  let a = 1,
    b = 0
  for (let offset = 0; offset < raw.length; offset += 65535) {
    const size = Math.min(65535, raw.length - offset)
    zlib.set(
      [
        offset + size === raw.length ? 1 : 0,
        size & 255,
        size >>> 8,
        ~size & 255,
        (~size >>> 8) & 255,
      ],
      pos,
    )
    pos += 5
    zlib.set(raw.subarray(offset, offset + size), pos)
    pos += size
  }
  for (const byte of raw) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  new DataView(zlib.buffer).setUint32(pos, ((b << 16) | a) >>> 0)
  const ihdr = new Uint8Array(13)
  const header = new DataView(ihdr.buffer)
  header.setUint32(0, width)
  header.setUint32(4, slice.end - slice.start)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const chunks = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib),
    chunk('IEND', new Uint8Array()),
  ]
  const output = new Uint8Array(chunks.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of chunks) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}
export async function readPixels(source: Source) {
  const bitmap = await createImageBitmap(source.file)
  const canvas = document.createElement('canvas')
  try {
    if (bitmap.width !== source.width || bitmap.height !== source.height)
      throw new Error('圖片尺寸已變更，請重新加入。')
    canvas.width = source.width
    canvas.height = source.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('瀏覽器無法建立畫布。')
    context.drawImage(bitmap, 0, 0)
    return context.getImageData(0, 0, source.width, source.height).data
  } finally {
    bitmap.close()
    canvas.width = canvas.height = 0
  }
}
export async function batch(
  images: Source[],
  active: () => boolean,
  emit: (path: string, png: Uint8Array<ArrayBuffer>) => Promise<void>,
  decode: (source: Source) => Promise<Uint8Array | Uint8ClampedArray> = readPixels,
) {
  for (let imageIndex = 0; imageIndex < images.length; imageIndex++) {
    if (!active()) return
    const image = images[imageIndex]
    const rgba = await decode(image)
    for (const [sliceIndex, slice] of slices(image.height, image.cuts).entries()) {
      if (!active()) return
      await emit(
        `${pad(imageIndex)}/${pad(sliceIndex)}.png`,
        encodeSlice(rgba, image.width, image.height, slice),
      )
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }
}
export async function makeZip(
  images: Source[],
  active: () => boolean,
  decode: (source: Source) => Promise<Uint8Array | Uint8ClampedArray> = readPixels,
) {
  const zip = new JSZip()
  await batch(
    images,
    active,
    async (path, png) => {
      zip.file(path, png, { createFolders: false })
    },
    decode,
  )
  if (!active()) return null
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
}
