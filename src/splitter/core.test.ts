import { describe, expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { format } from 'prettier'
import {
  batch,
  checkDimensions,
  clampCrop,
  cropLimit,
  cropWidth,
  defaultCuts,
  dimensions,
  encodeSlice,
  makeZip,
  moveCrop,
  moveCut,
  reorder,
  slices,
  type Source,
} from './core'

const evidence = new URL('../../evidence/splitter-long/', import.meta.url)
mkdirSync(evidence, { recursive: true })
// Independent decoder verifies the PNG wire format, CRCs and zlib checksum.
function decode(png: Uint8Array) {
  const buffer = Buffer.from(png)
  expect([...buffer.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  let offset = 8
  let width = 0,
    height = 0
  const data: Buffer[] = []
  const types: string[] = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const body = buffer.subarray(offset + 8, offset + 8 + length)
    let crc = 0xffffffff
    for (const byte of buffer.subarray(offset + 4, offset + 8 + length)) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    expect(buffer.readUInt32BE(offset + 8 + length)).toBe((crc ^ 0xffffffff) >>> 0)
    types.push(type)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      expect([...body.subarray(8)]).toEqual([8, 6, 0, 0, 0])
    }
    if (type === 'IDAT') data.push(body)
    offset += length + 12
  }
  expect(types[0]).toBe('IHDR')
  expect(types.at(-1)).toBe('IEND')
  expect(types.slice(1, -1).every((type) => type === 'IDAT')).toBe(true)
  const raw = inflateSync(Buffer.concat(data))
  expect(raw.length).toBe((width * 4 + 1) * height)
  const pixels = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    expect(raw[y * (width * 4 + 1)]).toBe(0)
    raw.copy(pixels, y * width * 4, y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1))
  }
  return { width, height, pixels }
}
function pixels(width: number, height: number, seed = 0) {
  return Uint8Array.from(
    { length: width * height * 4 },
    (_, i) => (i * 37 + Math.floor(i / (width * 4)) * 13 + seed) % 256,
  )
}
function source(width: number, height: number, id: number): Source {
  return {
    id,
    name: `synthetic-${id}.png`,
    width,
    height,
    cuts: defaultCuts(height),
    file: {} as File,
  }
}
describe('source row splitting and real PNG pipeline', () => {
  it.each([
    [10000, [1792, 1792, 1792, 1792, 1792, 1040]],
    [3584, [1792, 1792]],
    [1792, [1792]],
    [1791, [1791]],
    [1, [1]],
  ])('decodes and stitches height %i without losing or duplicating any rows', (height, sizes) => {
    const h = height as number
    const width = 17
    const original = pixels(width, h)
    const segments = slices(h, defaultCuts(h))
    const decoded = segments.map((slice) => decode(encodeSlice(original, width, h, slice)))
    expect(decoded.map((image) => image.height)).toEqual(sizes)
    expect(decoded.every((image) => image.width === width)).toBe(true)
    expect(Buffer.concat(decoded.map((image) => image.pixels)).equals(Buffer.from(original))).toBe(
      true,
    )
  })
  it('clamps both edges, prevents crossing/empty slices and ignores nonfinite values', () => {
    const cuts = [1792, 3584, 5376]
    expect(moveCut(cuts, 0, -100, 6000)).toEqual([1, 3584, 5376])
    expect(moveCut(cuts, 0, 99999, 6000)).toEqual([3583, 3584, 5376])
    expect(moveCut(cuts, 1, 0, 6000)).toEqual([1792, 1793, 5376])
    expect(moveCut(cuts, 1, 6000, 6000)).toEqual([1792, 5375, 5376])
    expect(moveCut(cuts, 2, Infinity, 6000)).toEqual(cuts)
    expect(moveCut(cuts, 2, 10000, 6000)).toEqual([1792, 3584, 5999])
    expect(moveCut(cuts, -1, 10, 6000)).toEqual(cuts)
    expect(() => slices(10, [0])).toThrow()
    expect(() => slices(10, [5, 5])).toThrow()
    expect(() => slices(10, [11])).toThrow()
    expect(() => slices(10, [6, 3])).toThrow()
    expect(() => encodeSlice(new Uint8Array(40), 1, 10, { start: 3, end: 3 })).toThrow()
    let adjusted = cuts
    for (let i = 0; i < 24; i++) {
      adjusted = moveCut(adjusted, i % 3, ((i * 7919) % 10000) - 2000, 6000)
      const ranges = slices(6000, adjusted)
      expect(ranges.reduce((n, slice) => n + slice.end - slice.start, 0)).toBe(6000)
      const original = pixels(3, 6000)
      expect(
        Buffer.concat(
          ranges.map((slice) => decode(encodeSlice(original, 3, 6000, slice)).pixels),
        ).equals(Buffer.from(original)),
      ).toBe(true)
    }
  })
  it('rejects unsupported headers and excessive dimensions', () => {
    expect(() => dimensions(new TextEncoder().encode('<svg/>'))).toThrow()
    expect(() => checkDimensions(8193, 10)).not.toThrow()
    expect(() => checkDimensions(1, 24001)).not.toThrow()
    expect(() => checkDimensions(4000, 4000)).not.toThrow()
    const fixture = encodeSlice(pixels(3, 10), 3, 10, { start: 0, end: 10 })
    expect(dimensions(fixture)).toEqual({ width: 3, height: 10 })
  })
  it('clamps crop offsets to integer pixels and preserves at least 10% of the source', () => {
    expect(cropWidth({ width: 17 })).toBe(17)
    expect(clampCrop({ width: 100, cropLeft: -2, cropRight: 19.6 })).toEqual({
      cropLeft: 0,
      cropRight: 20,
    })
    const image = { width: 101, cropLeft: 20, cropRight: 10 }
    expect(cropLimit(image, 'cropRight')).toBe(70)
    const crop = moveCrop(image, 'cropRight', 1000)
    expect(crop).toEqual({ cropLeft: 20, cropRight: 70 })
    expect(cropWidth({ ...image, ...crop })).toBe(11)
    expect(moveCrop(image, 'cropLeft', 4.6)).toEqual({ cropLeft: 5, cropRight: 10 })
    expect(moveCrop(image, 'cropLeft', Infinity)).toEqual({ cropLeft: 20, cropRight: 10 })
    expect(clampCrop({ width: 3, cropLeft: 1, cropRight: 6 })).toEqual({
      cropLeft: 1,
      cropRight: 1,
    })
    expect(cropWidth({ width: 1, cropLeft: 5, cropRight: 9 })).toBe(1)
  })
  it('batches and packages cropped pixels in the original row and slice order', async () => {
    const image = { ...source(17, 5, 1), cuts: [2], cropLeft: 3, cropRight: 5 }
    const original = pixels(image.width, image.height)
    const croppedRow = (y: number) => original.slice((y * 17 + 3) * 4, (y * 17 + 12) * 4)
    const read = async (_source: Source, start: number, end: number) =>
      Buffer.concat(Array.from({ length: end - start }, (_, i) => croppedRow(start + i)))
    expect(clampCrop(image).cropLeft).toBe(3)
    const zip = await JSZip.loadAsync((await makeZip([image], () => true, read))!, {
      checkCRC32: true,
    })
    const entries = [
      { path: '001/001.png', start: 0, end: 2 },
      { path: '001/002.png', start: 2, end: 5 },
    ]
    expect(Object.keys(zip.files)).toEqual(entries.map(({ path }) => path))
    for (const { path, start, end } of entries) {
      const png = decode(await zip.file(path)!.async('uint8array'))
      expect(png).toEqual({ width: 9, height: end - start, pixels: await read(image, start, end) })
    }
    const single: string[] = []
    await batch(
      [image],
      () => true,
      async (path, png) => {
        single.push(path)
        expect(decode(new Uint8Array(await png.arrayBuffer()))).toEqual({
          width: 9,
          height: 3,
          pixels: await read(image, 2, 5),
        })
      },
      read,
      { imageIndex: 0, sliceIndex: 1 },
    )
    expect(single).toEqual(['001/002.png'])
  })
  it('runs decode sequentially in reordered image order; ZIP paths, dimensions and pixels match the actual batch', async () => {
    const sources = reorder([source(17, 10000, 1), source(23, 3584, 2)], 1, 0)
    sources[0].cuts = moveCut(sources[0].cuts, 0, 13, sources[0].height)
    const calls: number[] = []
    const decodeSource = async (image: Source, start: number, end: number) => {
      calls.push(image.id)
      return pixels(image.width, image.height, image.id).subarray(
        start * image.width * 4,
        end * image.width * 4,
      )
    }
    const zipBytes = await makeZip(sources, () => true, decodeSource)
    expect(calls).toEqual([2, 1])
    const zip = await JSZip.loadAsync(zipBytes!, { checkCRC32: true })
    const paths = [
      ['001/001.png', '001/002.png'],
      ['002/001.png', '002/002.png', '002/003.png', '002/004.png', '002/005.png', '002/006.png'],
    ]
    expect(Object.keys(zip.files)).toEqual(paths.flat())
    const manifest = []
    for (const [imageIndex, image] of sources.entries()) {
      const reconstructed: Buffer[] = []
      const original = encodeSlice(
        pixels(image.width, image.height, image.id),
        image.width,
        image.height,
        { start: 0, end: image.height },
      )
      writeFileSync(new URL(`synthetic-source-${imageIndex + 1}.png`, evidence), original)
      for (const [sliceIndex, { start, end }] of slices(image.height, image.cuts).entries()) {
        const path = paths[imageIndex][sliceIndex]
        const png = await zip.file(path)!.async('uint8array')
        const decoded = decode(png)
        expect([decoded.width, decoded.height]).toEqual([image.width, end - start])
        reconstructed.push(decoded.pixels)
        manifest.push({ start, end, imageIndex, sliceIndex, x: 0, width: image.width, path })
        mkdirSync(new URL(`${path.split('/')[0]}/`, evidence), { recursive: true })
        writeFileSync(new URL(path, evidence), png)
      }
      expect(
        Buffer.concat(reconstructed).equals(
          Buffer.from(pixels(image.width, image.height, image.id)),
        ),
      ).toBe(true)
    }
    writeFileSync(new URL('synthetic-batch.zip', evidence), zipBytes!)
    writeFileSync(
      new URL('manifest.json', evidence),
      await format(
        JSON.stringify(
          {
            syntheticOnly: true,
            encoding: 'RGBA8, filter 0, stored DEFLATE',
            sourceOrder: sources.map((s) => s.name),
            entries: manifest,
            zipSHA256: createHash('sha256').update(zipBytes!).digest('hex'),
            decodedStitchPixelIdentical: true,
          },
          null,
          2,
        ),
        { parser: 'json' },
      ),
    )
  })
  it('stops stale work after async decoding and between slices', async () => {
    let active = true
    const emitted: string[] = []
    await batch(
      [source(2, 3584, 1), source(2, 1792, 2)],
      () => active,
      async (path) => {
        emitted.push(path)
        active = false
      },
      async (image) => pixels(image.width, image.height),
    )
    expect(emitted).toEqual(['001/001.png'])
    active = true
    await batch(
      [source(2, 100, 1)],
      () => active,
      async () => {
        throw new Error('stale emit')
      },
      async () => {
        active = false
        return pixels(2, 100)
      },
    )
  })
})
