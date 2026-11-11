import { deflateSync } from 'node:zlib'
import type { PhotoDraft } from './photoBlockRender.ts'

function pngChunk(type: string, payload: Uint8Array): Uint8Array {
  const result = new Uint8Array(payload.length + 12)
  const view = new DataView(result.buffer)
  view.setUint32(0, payload.length)
  result.set(new TextEncoder().encode(type), 4)
  result.set(payload, 8)
  let crc = 0xffffffff
  for (const byte of result.subarray(4, -4)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0)
  return result
}
function mockPng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr.set([8, 6], 8)
  const scanlines = new Uint8Array((width * 4 + 1) * height)
  for (let y = 0; y < height; y++)
    scanlines.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', new Uint8Array()),
  ]
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

export function mockPhotoDraft(count: number): PhotoDraft {
  return {
    common: { time: '115/11/11', location: 'Mock 市測試路 1 號', photographer: '王小明(Mock)' },
    photos: Array.from({ length: count }, (_, index) => {
      const width = index % 2 ? 120 : 240
      const height = index % 2 ? 240 : 120
      const rgba = new Uint8Array(width * height * 4)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const n = (y * width + x) * 4
          rgba[n] = x < width / 2 ? 40 + index * 20 : 210
          rgba[n + 1] = y < height / 2 ? 100 : 180
          rgba[n + 2] = 160
          rgba[n + 3] = 255
        }
      }
      return {
        id: `mock-${index + 1}`,
        mime: 'image/png' as const,
        width,
        height,
        bytes: mockPng(rgba, width, height),
        description:
          index === 0
            ? '<script>alert(1)</script> & <b> ' + `"' {{案由}}`
            : `Mock 幾何測試圖 ${index + 1}`,
        ...(index === 2 ? { overrides: { photographer: '李大華(Mock)' } } : {}),
      }
    }),
  }
}
export const mockPhotoFields = {
  年: '115',
  月: '11',
  警局: 'Mock 警局',
  分局: 'Mock 分局',
  案次編號: 'Mock001',
  案由: 'Mock 竊盜案',
}
