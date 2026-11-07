import { describe, expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { format } from 'prettier'
import {
  batch,
  checkDimensions,
  defaultCuts,
  dimensions,
  encodeSlice,
  makeZip,
  moveCut,
  plan,
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
    const manifest = plan(sources)
    expect(Object.keys(zip.files)).toEqual(manifest.map((entry) => entry.path))
    for (const [imageIndex, image] of sources.entries()) {
      const reconstructed: Buffer[] = []
      const original = encodeSlice(
        pixels(image.width, image.height, image.id),
        image.width,
        image.height,
        { start: 0, end: image.height },
      )
      writeFileSync(new URL(`synthetic-source-${imageIndex + 1}.png`, evidence), original)
      for (const entry of manifest.filter((entry) => entry.imageIndex === imageIndex)) {
        const png = await zip.file(entry.path)!.async('uint8array')
        const decoded = decode(png)
        expect([decoded.width, decoded.height]).toEqual([image.width, entry.end - entry.start])
        reconstructed.push(decoded.pixels)
        mkdirSync(new URL(`${entry.path.split('/')[0]}/`, evidence), { recursive: true })
        writeFileSync(new URL(entry.path, evidence), png)
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
