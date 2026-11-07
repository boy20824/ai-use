// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { format } from 'prettier'
import { createPreviewRenderer, type PreviewTarget } from './preview'

const file = (name: string) => new File(['synthetic'], name)
function target(start = 0, end = 10000, maxWidth = 600, maxHeight = 8192): PreviewTarget {
  return { canvas: document.createElement('canvas'), start, end, maxWidth, maxHeight }
}
function bitmap(width = 828, height = 10000) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap & {
    close: ReturnType<typeof vi.fn>
  }
}
function drawing() {
  const draw = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage: draw }) as unknown as CanvasRenderingContext2D,
  )
  return draw
}
function pending<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
afterEach(() => {
  vi.restoreAllMocks()
})
describe('CSP-compatible local canvas preview lifecycle', () => {
  it('draws exact source rectangles, bounds backing dimensions, redraws adjusted slices without decoding again and releases every canvas', async () => {
    const draw = drawing()
    const image = bitmap()
    const decode = vi.fn(async () => image)
    const report = vi.fn()
    const renderer = createPreviewRenderer(report, decode)
    const source = { file: file('fake.png'), width: 828, height: 10000 }
    const full = target()
    const first = target(0, 1792, 100, 320)
    const last = target(8960, 10000, 100, 320)
    renderer.update(source, [full, first, last])
    await vi.waitFor(() => expect(report).toHaveBeenLastCalledWith('ready', expect.any(String)))
    expect(decode).toHaveBeenCalledExactlyOnceWith(source.file)
    expect(draw.mock.calls).toEqual([
      [image, 0, 0, 828, 10000, 0, 0, 600, 7246],
      [image, 0, 0, 828, 1792, 0, 0, 100, 216],
      [image, 0, 8960, 828, 1040, 0, 0, 100, 126],
    ])
    const adjusted = target(1, 10000, 100, 320)
    renderer.update(source, [full, adjusted])
    expect(decode).toHaveBeenCalledTimes(1)
    expect(draw).toHaveBeenLastCalledWith(image, 0, 1, 828, 9999, 0, 0, 26, 320)
    expect([
      first.canvas.width,
      first.canvas.height,
      last.canvas.width,
      last.canvas.height,
    ]).toEqual([0, 0, 0, 0])
    renderer.dispose()
    expect(image.close).toHaveBeenCalledTimes(1)
    expect([
      full.canvas.width,
      full.canvas.height,
      adjusted.canvas.width,
      adjusted.canvas.height,
    ]).toEqual([0, 0, 0, 0])
    renderer.dispose()
    expect(image.close).toHaveBeenCalledTimes(1)
    mkdirSync('evidence/splitter', { recursive: true })
    writeFileSync(
      'evidence/splitter/preview-draw-manifest.json',
      await format(
        JSON.stringify({
          syntheticOnly: true,
          source: { width: source.width, height: source.height },
          drawImageArgumentsWithoutBitmap: draw.mock.calls.map((call) => call.slice(1)),
          originalPixelCoordinates: true,
          repeatedDecodeForCutAdjustment: false,
          bitmapClosedExactlyOnce: true,
          canvasBackingStoresZeroAfterDispose: true,
          note: 'DOM canvas context and browser image decoder are mocked; these are actual production renderer calls, not a browser screenshot or proof of browser CSP enforcement.',
        }),
        { parser: 'json', printWidth: 100 },
      ),
    )
  })
  it('serializes pending decoding, skips superseded selections, closes stale results and draws only the latest targets', async () => {
    const draw = drawing()
    const first = pending<ImageBitmap>()
    const latest = pending<ImageBitmap>()
    const decode = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise)
    const renderer = createPreviewRenderer(vi.fn(), decode)
    const a = { file: file('fake-A.png'), width: 828, height: 10000 }
    const b = { ...a, file: file('fake-B.png') }
    const c = { ...a, file: file('fake-C.png') }
    const staleTarget = target()
    const latestTarget = target()
    renderer.update(a, [staleTarget])
    renderer.update(b, [target()])
    renderer.update(c, [latestTarget])
    expect(decode).toHaveBeenCalledTimes(1)
    const stale = bitmap()
    first.resolve(stale)
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2))
    expect(decode.mock.calls.map(([f]) => f)).toEqual([a.file, c.file])
    expect(stale.close).toHaveBeenCalledTimes(1)
    expect(draw).not.toHaveBeenCalled()
    const good = bitmap()
    latest.resolve(good)
    await vi.waitFor(() => expect(draw).toHaveBeenCalledTimes(1))
    expect(draw.mock.calls[0][0]).toBe(good)
    expect(staleTarget.canvas.width).toBe(0)
    renderer.update(undefined, [])
    expect(good.close).toHaveBeenCalledTimes(1)
    expect(latestTarget.canvas.width).toBe(0)
    renderer.dispose()
  })
  it('does not draw or report after unmount; closes the pending bitmap', async () => {
    const draw = drawing()
    const wait = pending<ImageBitmap>()
    const report = vi.fn()
    const renderer = createPreviewRenderer(report, async () => wait.promise)
    const canvas = target()
    renderer.update({ file: file('fake.png'), width: 828, height: 10000 }, [canvas])
    renderer.dispose()
    report.mockClear()
    const image = bitmap()
    wait.resolve(image)
    await vi.waitFor(() => expect(image.close).toHaveBeenCalledTimes(1))
    expect(draw).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
    expect(canvas.canvas.width).toBe(0)
  })
  it('reports decode and canvas failures, closes bitmaps and permits another selection', async () => {
    const draw = drawing()
    const image = bitmap()
    const decode = vi
      .fn()
      .mockRejectedValueOnce(new Error('synthetic decode error'))
      .mockResolvedValue(image)
    const report = vi.fn()
    const renderer = createPreviewRenderer(report, decode)
    const source = { file: file('fake.png'), width: 828, height: 10000 }
    const full = target()
    renderer.update(source, [full])
    await vi.waitFor(() =>
      expect(report).toHaveBeenLastCalledWith('error', 'synthetic decode error'),
    )
    draw.mockImplementation(() => {
      throw new Error('synthetic draw error')
    })
    renderer.update({ ...source, file: file('fake-next.png') }, [full])
    await vi.waitFor(() => expect(report).toHaveBeenLastCalledWith('error', 'synthetic draw error'))
    expect(image.close).toHaveBeenCalledTimes(1)
    expect(full.canvas.width).toBe(0)
    renderer.dispose()
  })
})
