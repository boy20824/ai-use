// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { inflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import JSZip from 'jszip'
import { format } from 'prettier'
import {
  bandRows,
  batch,
  browserCrop,
  checkDimensions,
  cropBitmap,
  defaultCuts,
  DECODE_TIMEOUT,
  LIMITS,
  makeZip,
  nextZipLayout,
  readBand,
  readDimensions,
  type Source,
} from './core'

const evidence = 'evidence/splitter-long/'
mkdirSync(evidence, { recursive: true })
function fixture(id = 1, height = 50003): Source {
  return {
    id,
    file: new File(['synthetic'], `synthetic-${id}.png`),
    name: `synthetic-${id}.png`,
    width: 5,
    height,
    cuts: defaultCuts(height),
  }
}
function pixels(width: number, start: number, end: number, seed = 0) {
  return Uint8Array.from({ length: width * (end - start) * 4 }, (_, i) =>
    i % 4 === 3
      ? 255
      : (i + start * width * 4 + Math.floor(i / (width * 4)) * 13 + start * 13 + seed) % 256,
  )
}
function unpack(bytes: Uint8Array) {
  const png = Buffer.from(bytes),
    idat: Buffer[] = []
  const width = png.readUInt32BE(16),
    height = png.readUInt32BE(20)
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    let crc = 0xffffffff
    for (const byte of png.subarray(offset + 4, offset + 8 + size)) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    expect(png.readUInt32BE(offset + 8 + size)).toBe((crc ^ 0xffffffff) >>> 0)
    if (type === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + size))
    offset += size + 12
  }
  const raw = inflateSync(Buffer.concat(idat)),
    rgba: Buffer[] = []
  expect(raw.length).toBe((width * 4 + 1) * height)
  for (let row = 0; row < height; row++) {
    expect(raw[row * (width * 4 + 1)]).toBe(0)
    rgba.push(raw.subarray(row * (width * 4 + 1) + 1, (row + 1) * (width * 4 + 1)))
  }
  return { width, height, rgba: Buffer.concat(rgba) }
}
function raster() {
  const calls: number[][] = [],
    close = vi.fn()
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (file: File, x: number, y: number, width: number, height: number) => {
      calls.push([x, y, width, height])
      return {
        width,
        height,
        pixels: pixels(width, y, y + height, Number(file.name.match(/\d+/)?.[0] ?? 0)),
        close,
      }
    }),
  )
  const canvases: HTMLCanvasElement[] = []
  const backing: number[][] = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    canvases.push(this)
    backing.push([this.width, this.height])
    let bitmap: { pixels: Uint8Array }
    return {
      drawImage: (value: typeof bitmap) => {
        bitmap = value
      },
      getImageData: () => ({ data: bitmap.pixels }),
    } as unknown as CanvasRenderingContext2D
  })
  return { calls, close, canvases, backing }
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
describe('desktop long screenshot production path', () => {
  it.each([false, true])(
    'decodes real encoder output and stitches 50003 rows, giant adjusted slice=%s',
    async (giant) => {
      const { calls, close, canvases, backing } = raster()
      const image = fixture()
      if (giant) image.cuts = [40001]
      const entries: { path: string; width: number; height: number }[] = [],
        stitched: Buffer[] = []
      await batch(
        [image],
        () => true,
        async (path, blob) => {
          const bytes = new Uint8Array(await blob.arrayBuffer())
          const decoded = unpack(bytes)
          entries.push({ path, width: decoded.width, height: decoded.height })
          stitched.push(decoded.rgba)
          if (giant) writeFileSync(evidence + path.replace('/', '-'), bytes)
        },
      )
      expect(Buffer.concat(stitched)).toEqual(Buffer.from(pixels(image.width, 0, image.height, 1)))
      expect(calls).toEqual([
        [0, 0, 5, 16384],
        [0, 16384, 5, 16384],
        [0, 32768, 5, 16384],
        [0, 49152, 5, 851],
      ])
      expect(close).toHaveBeenCalledTimes(4)
      expect(backing.every(([, height]) => height <= 16384)).toBe(true)
      expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true)
      expect(entries.every((entry) => entry.width === 5)).toBe(true)
      if (giant) expect(entries.map((entry) => entry.height)).toEqual([40001, 10002])
      writeFileSync(
        evidence + (giant ? 'giant' : 'default') + '-manifest.json',
        await format(
          JSON.stringify(
            {
              syntheticOnly: true,
              decoderAndCanvasMocked: true,
              realEncoderAndIndependentPngDecode: true,
              pixelIdenticalStitch: true,
              crops: calls,
              entries,
            },
            null,
            2,
          ),
          { parser: 'json' },
        ),
      )
    },
  )
  it('keeps image/slice ZIP ordering across bands and skips unrelated slices for individual export', async () => {
    const { calls } = raster()
    const images = [fixture(2, 40000), fixture(1, 33000)]
    images[0].cuts = [16390, 32770]
    images[1].cuts = [33000 - 1]
    const bytes = await makeZip(images, () => true)
    const zip = await JSZip.loadAsync(bytes!, { checkCRC32: true })
    expect(Object.keys(zip.files)).toEqual([
      '001/001.png',
      '001/002.png',
      '001/003.png',
      '002/001.png',
      '002/002.png',
    ])
    for (const [index, image] of images.entries()) {
      const decoded = await Promise.all(
        Object.keys(zip.files)
          .filter((path) => path.startsWith(`00${index + 1}/`))
          .map(async (path) => unpack(await zip.file(path)!.async('uint8array'))),
      )
      expect(Buffer.concat(decoded.map((item) => item.rgba))).toEqual(
        Buffer.from(pixels(image.width, 0, image.height, image.id)),
      )
    }
    writeFileSync(evidence + 'synthetic-long.zip', bytes!)
    calls.length = 0
    const emit = vi.fn()
    await batch(images, () => true, emit, undefined, { imageIndex: 0, sliceIndex: 1 })
    expect(emit.mock.calls.map((call) => call[0])).toEqual(['001/002.png'])
    expect(calls).toEqual([[0, 16390, 5, 16380]])
  })
  it('bounds header reads, skips large JPEG metadata, and never calls whole-file arrayBuffer', async () => {
    const bytes = new Uint8Array(200000)
    bytes.set([255, 216, 255, 225, 255, 255], 0)
    bytes.set([255, 192, 0, 8, 8, 0x9c, 0x40, 0, 5, 0], 65539)
    const file = new NodeBlob([bytes]) as unknown as File
    const slice = vi.spyOn(file, 'slice'),
      entire = vi.spyOn(file, 'arrayBuffer')
    expect(await readDimensions(file)).toEqual({ width: 5, height: 40000 })
    expect(entire).not.toHaveBeenCalled()
    expect(slice.mock.calls.every(([start = 0, end = 0]) => end! - start! <= 24)).toBe(true)
    expect(slice.mock.calls).toContainEqual([65539, 65543])
    expect(LIMITS).toEqual({ fileBytes: 200 * 1024 ** 2 })
    expect(() => checkDimensions(20000, 100000)).not.toThrow()
    expect(bandRows(20000)).toBeLessThan(1000)
  })
  it('closes bitmaps and clears canvases on draw/read failures, cancellation and emit rejection', async () => {
    const { close, canvases } = raster()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementationOnce(
      () =>
        ({
          drawImage() {
            throw new Error('allocation failure')
          },
        }) as unknown as CanvasRenderingContext2D,
    )
    await expect(readBand(fixture(), 0, 10)).rejects.toThrow('allocation failure')
    expect(close).toHaveBeenCalledTimes(1)
    const emit = vi.fn()
    let active = true
    await batch(
      [fixture()],
      () => active,
      emit,
      async (image, start, end) => {
        active = false
        return pixels(image.width, start, end)
      },
    )
    expect(emit).not.toHaveBeenCalled()
    await expect(
      batch(
        [fixture()],
        () => true,
        async () => {
          throw new Error('save failure')
        },
      ),
    ).rejects.toThrow('save failure')
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true)
  })
  it('rejects unrepresentable ZIP32 output rather than silently wrapping fields; imposes no source total cap', () => {
    const empty = { entries: 0, local: 0, directory: 0 }
    expect(nextZipLayout(empty, '001/001.png', 100)).toEqual({
      entries: 1,
      local: 157,
      directory: 57,
    })
    expect(() => nextZipLayout(empty, '001/001.png', 0xffffffff)).toThrow('ZIP32')
    expect(() => nextZipLayout({ ...empty, entries: 65534 }, '001/001.png', 1)).toThrow('ZIP32')
    expect(() => nextZipLayout({ ...empty, local: 0xfffffff0 }, '001/001.png', 1)).toThrow('ZIP32')
    expect(() => nextZipLayout({ ...empty, directory: 0xfffffff0 }, '001/001.png', 1)).toThrow(
      'ZIP32',
    )
  })
  it('surfaces crop failures and timeout, serializes calls, and closes a late timed-out bitmap', async () => {
    const image = fixture()
    await expect(
      cropBitmap(image.file, 0, 5, 10, async () => {
        throw new Error('crop unsupported')
      }),
    ).rejects.toThrow('轉存 PNG')
    vi.useFakeTimers()
    let resolve!: (bitmap: ImageBitmap) => void
    const decode = vi.fn(
      () =>
        new Promise<ImageBitmap>((done) => {
          resolve = done
        }),
    )
    const first = cropBitmap(image.file, 0, 5, 10, decode)
    const rejected = expect(first).rejects.toThrow('30 秒')
    await vi.advanceTimersByTimeAsync(DECODE_TIMEOUT)
    await rejected
    const close = vi.fn()
    resolve({ width: 5, height: 10, close } as unknown as ImageBitmap)
    await Promise.resolve()
    await Promise.resolve()
    expect(close).toHaveBeenCalledTimes(1)
    expect(browserCrop).toBeTypeOf('function')
  })
})
