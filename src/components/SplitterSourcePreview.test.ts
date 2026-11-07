// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, shallowRef, type App, type ShallowRef } from 'vue'
import { mkdirSync, writeFileSync } from 'node:fs'
import { format } from 'prettier'
import Preview from './SplitterSourcePreview.vue'
import { defaultCuts, moveCut, type Source } from '@/splitter/core'

const source = (id = 1, width = 800): Source => ({
  id,
  width,
  height: 50003,
  name: `synthetic-${id}.png`,
  file: new File(['synthetic decoder fixture'], `synthetic-${id}.png`),
  cuts: defaultCuts(50003),
})
let app: App, host: HTMLElement
let available = 1000,
  viewportHeight = 700
let resize!: () => void
let disconnect: ReturnType<typeof vi.fn>
let frames: Map<number, FrameRequestCallback>, frameId: number
let current: ShallowRef<Source>
let decode: ReturnType<typeof vi.fn>,
  close: ReturnType<typeof vi.fn>,
  draw: ReturnType<typeof vi.fn>
let captures: Set<number>, release: ReturnType<typeof vi.fn>
const flush = async () => {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}
function box() {
  return host.querySelector<HTMLElement>('.splitter-source')!
}
function line() {
  return host.querySelector<HTMLElement>('[role=slider]')!
}
function scrollTo(value: number) {
  box().scrollTop = value
  box().dispatchEvent(new Event('scroll'))
}
function pointer(type: string, y: number, pointerType = 'touch', target = line()) {
  const event = new PointerEvent(type, {
    pointerId: 7,
    pointerType,
    button: 0,
    clientY: y,
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  return event
}
async function frame(time: number) {
  const pending = [...frames.values()]
  frames.clear()
  pending.forEach((callback) => callback(time))
  await flush()
}
beforeEach(() => {
  available = 1000
  viewportHeight = 700
  frames = new Map()
  frameId = 0
  captures = new Set()
  close = vi.fn()
  draw = vi.fn()
  disconnect = vi.fn()
  release = vi.fn((id: number) => captures.delete(id))
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => available)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => viewportHeight)
  vi.spyOn(HTMLElement.prototype, 'clientTop', 'get').mockReturnValue(3)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return {
      top: 100,
      height: this.classList.contains('splitter-source-spacer')
        ? parseFloat(this.style.height)
        : 706,
    } as DOMRect
  })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: (id: number) => captures.add(id),
  })
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: (id: number) => captures.has(id),
  })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: release,
  })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback)
    return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe() {}
      disconnect = disconnect
    },
  )
  decode = vi.fn(async (_file: File, _x: number, _y: number, width: number, height: number) => ({
    width,
    height,
    close,
  }))
  vi.stubGlobal('createImageBitmap', decode)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: draw,
  } as unknown as CanvasRenderingContext2D)
  current = shallowRef(source())
  host = document.createElement('div')
  document.body.append(host)
  app = createApp({
    render: () =>
      h(Preview, {
        source: current.value,
        disabled: false,
        onAdjust: (index: number, row: number) => {
          current.value = {
            ...current.value,
            cuts: moveCut(current.value.cuts, index, row, current.value.height),
          }
        },
      }),
  })
  app.mount(host)
})
afterEach(async () => {
  app.unmount()
  await flush()
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('mounted scrolling source preview', () => {
  it('keeps source spacer at native/fit width, bounds backing and lines, releases scrolled canvases and records synthetic crops/DOM', async () => {
    await flush()
    expect(host.querySelector<HTMLElement>('.splitter-source-spacer')!.style.height).toBe('50003px')
    const old = [...host.querySelectorAll('canvas')]
    expect(old.length).toBeLessThanOrEqual(3)
    scrollTo(24000)
    await flush()
    expect(old.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true)
    expect(host.querySelectorAll('canvas').length).toBeLessThanOrEqual(4)
    expect(host.querySelectorAll('[role=slider]').length).toBeLessThanOrEqual(2)
    expect(decode.mock.calls.every((call) => call[4] <= 2048 && call[4] < 50003)).toBe(true)
    expect(host.querySelectorAll('img,[src]')).toHaveLength(0)
    available = 400
    resize()
    await flush()
    expect(host.querySelector<HTMLElement>('.splitter-source-spacer')!.style.height).toBe(
      '25001.5px',
    )
    expect(box().scrollTop).toBe(12000)
    expect([...host.querySelectorAll('canvas')].every((canvas) => canvas.height <= 2048)).toBe(true)
    mkdirSync('evidence/splitter-scroll', { recursive: true })
    writeFileSync(
      'evidence/splitter-scroll/synthetic-dom.html',
      await format(
        '<!doctype html>\n<!-- Synthetic mounted DOM, not a browser screenshot. -->\n' +
          host.innerHTML,
        { parser: 'html' },
      ),
    )
    writeFileSync(
      'evidence/splitter-scroll/crops.json',
      JSON.stringify(
        decode.mock.calls.map(([file, x, y, width, height]) => ({
          file: file.name,
          x,
          y,
          width,
          height,
        })),
        null,
        2,
      ) + '\n',
    )
    expect(close).toHaveBeenCalledTimes(decode.mock.calls.length)
  })
  it.each(['mouse', 'touch'])(
    'maps %s at scrolled native and fit widths with border/padding, retains keyboard clamps',
    async (pointerType) => {
      await flush()
      box().style.padding = '7px 10px'
      resize()
      scrollTo(1600)
      await flush()
      let target = line()
      expect(pointer('pointerdown', 300, pointerType, target).defaultPrevented).toBe(true)
      pointer('pointermove', 310, pointerType, target)
      await flush()
      expect(current.value.cuts[0]).toBe(1800) // 310 - (100+3+7) + 1600
      pointer('pointerup', 310, pointerType, target)
      available = 420
      resize()
      scrollTo(800)
      await flush()
      target = line()
      pointer('pointerdown', 300, pointerType, target)
      pointer('pointermove', 310, pointerType, target)
      await flush()
      expect(current.value.cuts[0]).toBe(2000)
      pointer('pointercancel', 310, pointerType, target)
      expect(frames.size).toBe(0)
      expect(captures.size).toBe(0)
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
      await flush()
      expect(current.value.cuts[0]).toBe(1)
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }),
      )
      await flush()
      expect(current.value.cuts[0]).toBe(11)
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
      await flush()
      expect(current.value.cuts[0]).toBe(3583)
    },
  )
  it('auto-scrolls with a stationary pointer, recalculates source cuts and clamps both scroll ends; lost capture/source switch/unmount cancel RAF', async () => {
    await flush()
    scrollTo(1200)
    await flush()
    let target = line()
    pointer('pointerdown', 802, 'touch', target)
    await frame(0)
    const first = current.value.cuts[0],
      firstScroll = box().scrollTop
    await frame(16)
    expect(box().scrollTop).toBeGreaterThan(firstScroll)
    expect(current.value.cuts[0]).toBeGreaterThan(first)
    scrollTo(1e9)
    await frame(32)
    expect(box().scrollTop).toBe(49303)
    expect(current.value.cuts[0]).toBe(3583)
    pointer('pointermove', -100, 'touch', target)
    scrollTo(0)
    await frame(48)
    expect(box().scrollTop).toBe(0)
    expect(current.value.cuts[0]).toBe(1)
    pointer('lostpointercapture', 0, 'touch', target)
    expect(frames.size).toBe(0)
    scrollTo(1200)
    await flush()
    target = line()
    pointer('pointerdown', 800, 'touch', target)
    current.value = source(2, 1600)
    await flush()
    expect(frames.size).toBe(0)
    expect(captures.size).toBe(0)
    expect(box().scrollTop).toBe(0)
    scrollTo(800)
    await flush()
    target = line()
    pointer('pointerdown', 800, 'touch', target)
    app.unmount()
    expect(frames.size).toBe(0)
    expect(captures.size).toBe(0)
    expect(disconnect).toHaveBeenCalled()
  })
  it('releases a late bitmap after scrolling away on the same source and does not redraw retained tiles for tiny scroll changes', async () => {
    await flush()
    const initial = decode.mock.calls.length
    scrollTo(10)
    await flush()
    expect(decode).toHaveBeenCalledTimes(initial)
    let resolve!: (bitmap: ImageBitmap) => void
    decode.mockImplementationOnce(
      () =>
        new Promise<ImageBitmap>((done) => {
          resolve = done
        }),
    )
    scrollTo(24000)
    await flush()
    const old = [...host.querySelectorAll('canvas')]
    scrollTo(40000)
    await flush()
    const lateClose = vi.fn()
    resolve({ width: 800, height: 2048, close: lateClose } as unknown as ImageBitmap)
    await flush()
    expect(lateClose).toHaveBeenCalledTimes(1)
    expect(old.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true)
    expect(host.querySelectorAll('canvas').length).toBeLessThanOrEqual(4)
  })
  it('reports a measured browser CSS height clamp instead of silently implying the complete image is reachable', async () => {
    await flush()
    vi.spyOn(
      host.querySelector<HTMLElement>('.splitter-source-spacer')!,
      'getBoundingClientRect',
    ).mockReturnValue({ height: 32000 } as DOMRect)
    resize()
    await flush()
    expect(host.querySelector('[role=alert]')?.textContent).toContain('需要 50003px，實際 32000px')
  })
  it('closes late offscreen/source-switch results without drawing or retaining backing', async () => {
    await flush()
    let resolve!: (bitmap: ImageBitmap) => void
    decode.mockImplementationOnce(
      () =>
        new Promise<ImageBitmap>((done) => {
          resolve = done
        }),
    )
    scrollTo(24000)
    await flush()
    expect(resolve).toBeTypeOf('function')
    const old = [...host.querySelectorAll('canvas')]
    const draws = draw.mock.calls.length
    current.value = source(2)
    await flush()
    const lateClose = vi.fn()
    resolve({ width: 800, height: 2048, close: lateClose } as unknown as ImageBitmap)
    await flush()
    expect(lateClose).toHaveBeenCalledTimes(1)
    expect(old.every((canvas) => canvas.width === 0)).toBe(true)
    expect(draw.mock.calls.length - draws).toBeLessThanOrEqual(2)
    expect(host.querySelector('[role=alert]')).toBeNull()
  })
})
