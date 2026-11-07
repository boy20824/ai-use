// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPreviewRenderer, type PreviewTarget } from './preview'

const source = () => ({ file: new File(['synthetic'], 'fake.png'), width: 17, height: 50001 })
const target = (start = 0, end = 50001): PreviewTarget => ({
  canvas: document.createElement('canvas'),
  start,
  end,
  maxWidth: 600,
  maxHeight: 8192,
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function drawing() {
  const draw = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage: draw }) as unknown as CanvasRenderingContext2D,
  )
  return draw
}
describe('cropped local preview', () => {
  it('uses only sequential cropped bitmaps, bounded backing stores and source row coordinates', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const draw = drawing(),
      report = vi.fn(),
      closed = vi.fn()
    const decode = vi.fn(
      async (_file: File, _x: number, _y: number, width: number, height: number) =>
        ({ width, height, close: closed }) as unknown as ImageBitmap,
    )
    const renderer = createPreviewRenderer(report, decode)
    const image = source(),
      full = target(),
      crossing = target(16000, 18000)
    renderer.update(image, [full, crossing])
    await vi.waitFor(() => expect(report).toHaveBeenLastCalledWith('ready', expect.any(String)))
    expect(decode.mock.calls.map((call) => call.slice(1))).toEqual(
      Array.from({ length: Math.ceil(50001 / 2048) }, (_, i) => [
        0,
        i * 2048,
        17,
        Math.min(2048, 50001 - i * 2048),
      ]),
    )
    expect(full.canvas.height).toBe(2048)
    expect(draw.mock.calls.some((call) => call[2] === 1664 && call[4] === 384)).toBe(true)
    expect(draw.mock.calls.some((call) => call[2] === 0 && call[4] === 1616)).toBe(true)
    expect(closed).toHaveBeenCalledTimes(25)
    renderer.dispose()
    expect(full.canvas.width).toBe(0)
    expect(crossing.canvas.height).toBe(0)
  })
  it('allocates thumbnail backing only while it intersects the viewport', async () => {
    drawing()
    let notify!: (entries: { target: HTMLCanvasElement; isIntersecting: boolean }[]) => void
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: typeof notify) {
          notify = callback
        }
        observe() {}
        disconnect() {}
      },
    )
    const report = vi.fn()
    const renderer = createPreviewRenderer(
      report,
      async (_f, _x, _y, width, height) => ({ width, height, close() {} }) as ImageBitmap,
    )
    const full = target(),
      thumb = target(16000, 18000)
    renderer.update(source(), [full, thumb])
    await vi.waitFor(() => expect(report).toHaveBeenLastCalledWith('ready', expect.any(String)))
    expect(thumb.canvas.width).toBe(0)
    report.mockClear()
    notify([{ target: thumb.canvas, isIntersecting: true }])
    await vi.waitFor(() => expect(report).toHaveBeenLastCalledWith('ready', expect.any(String)))
    expect(thumb.canvas.height).toBeGreaterThan(0)
    notify([{ target: thumb.canvas, isIntersecting: false }])
    expect(thumb.canvas.height).toBe(0)
    renderer.dispose()
  })
  it('closes stale pending results, serializes selection changes and cleans up on disposal', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const draw = drawing(),
      report = vi.fn(),
      close = vi.fn()
    let resolve!: (bitmap: ImageBitmap) => void
    const decode = vi.fn(
      () =>
        new Promise<ImageBitmap>((done) => {
          resolve = done
        }),
    )
    const renderer = createPreviewRenderer(report, decode)
    const a = source(),
      b = source(),
      canvas = target()
    renderer.update(a, [canvas])
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1))
    renderer.update(b, [target()])
    resolve({ width: 17, height: 2048, close } as unknown as ImageBitmap)
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2))
    expect(draw).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
    renderer.dispose()
    report.mockClear()
    resolve({ width: 17, height: 2048, close } as unknown as ImageBitmap)
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(2))
    expect(report).not.toHaveBeenCalled()
    expect(canvas.canvas.width).toBe(0)
  })
  it('surfaces decoder and canvas failures and releases bitmaps', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const draw = drawing(),
      report = vi.fn(),
      close = vi.fn()
    const decode = vi
      .fn()
      .mockRejectedValueOnce(new Error('synthetic decode error'))
      .mockImplementation(async (_f, _x, _y, width, height) => ({ width, height, close }))
    const renderer = createPreviewRenderer(report, decode),
      canvas = target()
    renderer.update(source(), [canvas])
    await vi.waitFor(() =>
      expect(report).toHaveBeenLastCalledWith(
        'error',
        expect.stringContaining('synthetic decode error'),
      ),
    )
    draw.mockImplementation(() => {
      throw new Error('synthetic draw error')
    })
    renderer.update(source(), [canvas])
    await vi.waitFor(() => expect(report).toHaveBeenLastCalledWith('error', 'synthetic draw error'))
    expect(close).toHaveBeenCalledTimes(1)
    expect(canvas.canvas.width).toBe(0)
    renderer.dispose()
  })
})
