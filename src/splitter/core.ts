import JSZip from 'jszip'

export const SLICE_HEIGHT = 1792
export const LIMITS = { fileBytes: 200 * 1024 ** 2 }
// Bound application-owned decode/canvas/RGBA buffers; browser codecs may decode more internally.
export const BAND_BYTES = 16 * 1024 ** 2
export function bandRows(width: number) {
  return Math.max(1, Math.min(16384, Math.floor(BAND_BYTES / (width * 4))))
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
    width > 0x7fffffff ||
    height > 0x7fffffff
  )
    throw new Error('圖片尺寸無效或超過 PNG 格式可表示的範圍。')
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
// Each PNG is encoded incrementally. Only encoded chunks are retained, never whole-slice RGBA.
export class PngRows {
  private parts: BlobPart[]
  private rows = 0
  private a = 1
  private b = 0
  constructor(
    private width: number,
    private height: number,
  ) {
    checkDimensions(width, height)
    const ihdr = new Uint8Array(13)
    const view = new DataView(ihdr.buffer)
    view.setUint32(0, width)
    view.setUint32(4, height)
    ihdr.set([8, 6, 0, 0, 0], 8)
    this.parts = [
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', new Uint8Array([0x78, 0x01])),
    ]
  }
  append(rgba: Uint8Array | Uint8ClampedArray) {
    const stride = this.width * 4
    const rows = rgba.length / stride
    if (!Number.isInteger(rows) || this.rows + rows > this.height)
      throw new Error('切片像素範圍無效。')
    // Split even an unusually wide row into bounded stored-DEFLATE blocks.
    let row = 0,
      column = 0
    while (row < rows) {
      const raw = new Uint8Array(Math.min(65535, (rows - row) * (stride + 1) - column))
      let pos = 0
      while (pos < raw.length) {
        if (column === 0) {
          raw[pos++] = 0
          column++
        }
        const count = Math.min(raw.length - pos, stride + 1 - column)
        raw.set(rgba.subarray(row * stride + column - 1, row * stride + column - 1 + count), pos)
        pos += count
        column += count
        if (column === stride + 1) {
          row++
          column = 0
        }
      }
      for (const byte of raw) {
        this.a = (this.a + byte) % 65521
        this.b = (this.b + this.a) % 65521
      }
      const block = new Uint8Array(raw.length + 5)
      block.set([
        0,
        raw.length & 255,
        raw.length >>> 8,
        ~raw.length & 255,
        (~raw.length >>> 8) & 255,
      ])
      block.set(raw, 5)
      this.parts.push(chunk('IDAT', block))
    }
    this.rows += rows
  }
  finish() {
    if (this.rows !== this.height) throw new Error('切片列數不完整。')
    const tail = new Uint8Array(9)
    tail.set([1, 0, 0, 255, 255])
    new DataView(tail.buffer).setUint32(5, ((this.b << 16) | this.a) >>> 0)
    this.parts.push(chunk('IDAT', tail), chunk('IEND', new Uint8Array()))
    const blob = new Blob(this.parts, { type: 'image/png' })
    this.parts = []
    return blob
  }
}
export const DECODE_TIMEOUT = 30000
export type CropDecoder = (
  file: File,
  x: number,
  y: number,
  width: number,
  height: number,
) => Promise<ImageBitmap>
export const browserCrop: CropDecoder = (file, x, y, width, height) =>
  createImageBitmap(file, x, y, width, height, {
    imageOrientation: 'none',
    premultiplyAlpha: 'none',
  })
// A timed-out browser operation cannot be aborted. Close its late result and do not start
// another decode in this operation; callers surface an actionable error instead of hanging.
const decodeQueues = new WeakMap<CropDecoder, Promise<void>>()
export async function cropBitmap(
  file: File,
  y: number,
  width: number,
  height: number,
  decode: CropDecoder = browserCrop,
  active: () => boolean = () => true,
) {
  let expired = false
  const previous = decodeQueues.get(decode) ?? Promise.resolve()
  const pending = previous.then(() => {
    if (expired) throw new Error('等待裁切解碼逾時；請重新載入頁面後重試。')
    if (!active()) throw new Error('已取消預覽裁切。')
    return decode(file, 0, y, width, height)
  })
  decodeQueues.set(
    decode,
    pending.then(
      () => {},
      () => {},
    ),
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      pending.then((bitmap) => {
        if (expired) {
          bitmap.close()
          throw new Error('解碼已逾時。')
        }
        if (bitmap.width !== width || bitmap.height !== height) {
          bitmap.close()
          throw new Error('瀏覽器未能解碼指定裁切範圍；請轉存為 PNG 後重試。')
        }
        return bitmap
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true
          reject(
            new Error(
              '本機圖片裁切解碼逾時（30 秒）。請重新載入頁面，將圖片轉存為 PNG 或分成較小檔案後重試。',
            ),
          )
        }, DECODE_TIMEOUT)
      }),
    ])
  } catch (cause) {
    throw new Error(
      `無法處理圖片裁切；瀏覽器可能不支援此尺寸或記憶體不足。請轉存 PNG 或分成較小檔案後重試。${cause instanceof Error ? cause.message : ''}`,
    )
  } finally {
    clearTimeout(timer)
  }
}
export async function readBand(source: Source, start: number, end: number) {
  const bitmap = await cropBitmap(source.file, start, source.width, end - start)
  const canvas = document.createElement('canvas')
  try {
    canvas.width = source.width
    canvas.height = end - start
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('瀏覽器無法建立畫布；請縮小圖片寬度後重試。')
    context.drawImage(bitmap, 0, 0)
    return context.getImageData(0, 0, source.width, end - start).data
  } finally {
    bitmap.close()
    canvas.width = canvas.height = 0
  }
}
export type BandReader = (
  source: Source,
  start: number,
  end: number,
) => Promise<Uint8Array | Uint8ClampedArray>
export async function batch(
  images: Source[],
  active: () => boolean,
  emit: (path: string, png: Blob) => Promise<void>,
  decode: BandReader = readBand,
  only?: { imageIndex: number; sliceIndex: number },
) {
  for (let imageIndex = 0; imageIndex < images.length; imageIndex++) {
    if (!active()) return
    if (only && imageIndex !== only.imageIndex) continue
    const image = images[imageIndex]
    checkDimensions(image.width, image.height)
    const ranges = slices(image.height, image.cuts)
    const first = only ? only.sliceIndex : 0
    const last = only ? only.sliceIndex + 1 : ranges.length
    if (!ranges[first]) throw new Error('切片不存在。')
    let sliceIndex = first
    let encoder = new PngRows(image.width, ranges[first].end - ranges[first].start)
    const stride = image.width * 4
    const stop = ranges[last - 1].end
    for (let start = ranges[first].start; start < stop; start += bandRows(image.width)) {
      if (!active()) return
      const end = Math.min(stop, start + bandRows(image.width))
      const rgba = await decode(image, start, end)
      if (!active()) return
      if (rgba.length !== (end - start) * stride)
        throw new Error('裁切解碼列數不完整；請轉存 PNG 後重試。')
      let row = start
      while (row < end) {
        const next = Math.min(end, ranges[sliceIndex].end)
        encoder.append(rgba.subarray((row - start) * stride, (next - start) * stride))
        row = next
        if (row === ranges[sliceIndex].end) {
          if (!active()) return
          await emit(`${pad(imageIndex)}/${pad(sliceIndex)}.png`, encoder.finish())
          sliceIndex++
          if (!active()) return
          if (sliceIndex < last)
            encoder = new PngRows(image.width, ranges[sliceIndex].end - ranges[sliceIndex].start)
        }
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }
}
// JSZip's writer emits classic ZIP fields (no ZIP64 generation). Validate actual
// output representation, not source totals; PNG exports remain unrestricted.
export function nextZipLayout(
  previous: { entries: number; local: number; directory: number },
  path: string,
  bytes: number,
) {
  const length = new TextEncoder().encode(path).length
  const next = {
    entries: previous.entries + 1,
    local: previous.local + 30 + length + bytes + 16,
    directory: previous.directory + 46 + length,
  }
  if (
    bytes >= 0xffffffff ||
    next.entries >= 0xffff ||
    next.local >= 0xffffffff ||
    next.directory >= 0xffffffff
  )
    throw new Error(
      '輸出超過此 ZIP 編碼器的 ZIP32 格式範圍；請改用逐片 PNG 或將圖片分批下載 ZIP。圖片匯入與 PNG 處理沒有合計容量限制。',
    )
  return next
}
export async function makeZip(
  images: Source[],
  active: () => boolean,
  decode: BandReader = readBand,
) {
  const zip = new JSZip()
  let layout = { entries: 0, local: 0, directory: 0 }
  await batch(
    images,
    active,
    async (path, png) => {
      // JSZip retains all encoded entries and buffers the final archive. No artificial total cap.
      layout = nextZipLayout(layout, path, png.size)
      zip.file(path, await png.arrayBuffer(), { createFolders: false })
    },
    decode,
  )
  if (!active()) return null
  const bytes = await zip.generateAsync(
    { type: 'uint8array', compression: 'STORE', streamFiles: true },
    () => {
      if (!active()) throw new Error('已取消 ZIP。')
    },
  )
  return active() ? bytes : null
}

// Read PNG's fixed header or walk JPEG segments with tiny reads, skipping payloads.
// No full-file arrayBuffer or bitmap probe, even when a JPEG has large APP segments.
export async function readDimensions(file: File) {
  const deadline = Date.now() + DECODE_TIMEOUT
  const read = async (offset: number, length: number) => {
    if (Date.now() > deadline) throw new Error('讀取圖片標頭逾時；請將圖片轉存為 PNG 後重試。')
    return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer())
  }
  const head = await read(0, 24)
  if (head[0] !== 255 || head[1] !== 216) return dimensions(head)
  let offset = 2
  while (offset + 4 <= file.size) {
    const marker = await read(offset, 4)
    if (marker[0] !== 255) break
    if (marker[1] === 255) {
      offset++
      continue
    }
    const code = marker[1]
    if (code === 0xda || code === 0xd9) break
    if (code === 0x01 || (code >= 0xd0 && code <= 0xd7)) {
      offset += 2
      continue
    }
    const length = (marker[2] << 8) | marker[3]
    if (length < 2 || offset + 2 + length > file.size) break
    if ([0xc0, 0xc1, 0xc2].includes(code) && length >= 8) {
      const size = await read(offset + 4, 5)
      return { width: (size[3] << 8) | size[4], height: (size[1] << 8) | size[2] }
    }
    offset += length + 2
  }
  throw new Error('無法讀取圖片；僅支援有效的 PNG、JPEG。')
}
