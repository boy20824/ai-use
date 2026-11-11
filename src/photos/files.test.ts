// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { loadBlockPhoto } from './files'
import { mockPhotoDraft } from '../../shared/photoMock'

const photo = mockPhotoDraft(1).photos[0]!
function pngFile() {
  return new File([new Uint8Array(photo.bytes)], 'mock.png', { type: 'image/png' })
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it('本機圖片縮至1600像素、保留比例並釋放解碼及畫布，不建立 URL', async () => {
  const close = vi.fn(),
    draw = vi.fn()
  const urls = vi.spyOn(URL, 'createObjectURL')
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 3200, height: 1600, close })),
  )
  const context = { drawImage: draw } as unknown as CanvasRenderingContext2D
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
    callback(new Blob([new Uint8Array(photo.bytes)], { type: 'image/png' })),
  )
  const result = await loadBlockPhoto(pngFile())
  expect(result).toMatchObject({ mime: 'image/png', width: 1600, height: 800, description: '' })
  expect(draw.mock.calls[0]!.slice(1)).toEqual([0, 0, 1600, 800])
  expect(close).toHaveBeenCalledOnce()
  expect(urls).not.toHaveBeenCalled()
})
it('解碼失敗給繁中錯誤，格式與大小檢查在解碼之前執行', async () => {
  const decode = vi.fn(async () => {
    throw new Error('codec')
  })
  vi.stubGlobal('createImageBitmap', decode)
  await expect(loadBlockPhoto(pngFile())).rejects.toThrow('照片解碼失敗')
  await expect(
    loadBlockPhoto(new File(['<svg/>'], 'bad.png', { type: 'image/png' })),
  ).rejects.toThrow('PNG / JPEG')
  const large = pngFile()
  Object.defineProperty(large, 'size', { value: 11 * 1024 * 1024 })
  await expect(loadBlockPhoto(large)).rejects.toThrow('10 MB')
  expect(decode).toHaveBeenCalledOnce()
})
it('畫布失敗仍釋放解碼資源，轉換失敗亦回報友善訊息', async () => {
  const close = vi.fn()
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 240, height: 120, close })),
  )
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  await expect(loadBlockPhoto(pngFile())).rejects.toThrow('照片畫布')
  context.mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(null))
  await expect(loadBlockPhoto(pngFile())).rejects.toThrow('照片轉換失敗')
  expect(close).toHaveBeenCalledTimes(2)
})
