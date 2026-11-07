// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Blob as NodeBlob } from 'node:buffer'
import JSZip from 'jszip'
import { format } from 'prettier'
import ImageSplitterView from './ImageSplitterView.vue'
import { dimensions, encodeSlice } from '@/splitter/core'
import { mainNav } from '@/navigation'
import { router } from '@/router'

const session = vi.hoisted(() => ({
  authenticated: false,
  restore: vi.fn(async () => {}),
  canEditCategory: false,
  isSysadmin: false,
}))
vi.mock('@/stores/session', () => ({ useSessionStore: () => session }))
let app: App | undefined
let host: HTMLDivElement
let nextUrl = 0
let blobs: Map<string, Blob>
let closed: ReturnType<typeof vi.fn<() => void>>
let revoked: ReturnType<typeof vi.fn<(url: string) => void>>
let decodeBitmap: ReturnType<typeof vi.fn>
let clicks: string[]
const synthetic = new Map<File, { width: number; height: number; pixels: Uint8Array }>()
function fixture(name: string, width = 8, height = 3584) {
  const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (i * 17) % 256,
  )
  const bytes = encodeSlice(pixels, width, height, { start: 0, end: height })
  const file = new File([bytes], name, { type: 'image/png' })
  Object.defineProperty(file, 'arrayBuffer', {
    configurable: true,
    value: async () => bytes.buffer,
  })
  synthetic.set(file, { width, height, pixels })
  return file
}
function mount() {
  host = document.createElement('div')
  document.body.append(host)
  app = createApp(ImageSplitterView)
  app.mount(host)
}
async function idle() {
  await vi.waitFor(() =>
    expect(host.querySelector('section')?.getAttribute('aria-busy')).toBe('false'),
  )
  await nextTick()
  if (host.querySelector('.splitter-preview-status'))
    await vi.waitFor(() =>
      expect(host.querySelector('.splitter-preview-status')?.getAttribute('data-state')).toBe(
        'ready',
      ),
    )
}
async function upload(files: File[], viaDrop = false) {
  if (viaDrop) {
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { files } })
    host.querySelector('.splitter-upload')!.dispatchEvent(event)
  } else {
    const input = host.querySelector<HTMLInputElement>('input[type=file]')!
    Object.defineProperty(input, 'files', { configurable: true, value: files })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  await nextTick()
  await idle()
}
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(
    (button) => button.getAttribute('aria-label') === label || button.textContent?.trim() === label,
  )!
  expect(button, label).toBeTruthy()
  button.click()
  await nextTick()
}
beforeEach(() => {
  blobs = new Map()
  clicks = []
  closed = vi.fn()
  revoked = vi.fn()
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Images must stay local')
    }),
  )
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    const url = `blob:synthetic-${++nextUrl}`
    blobs.set(url, blob as Blob)
    return url
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoked)
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicks.push(this.download)
  })
  decodeBitmap = vi.fn(async (file: File) => ({ ...synthetic.get(file)!, close: closed }))
  vi.stubGlobal('createImageBitmap', decodeBitmap)
  let drawn: { pixels: Uint8Array } | undefined
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        drawImage: (bitmap: { pixels: Uint8Array }) => {
          drawn = bitmap
        },
        getImageData: () => ({ data: drawn!.pixels }),
      }) as unknown as CanvasRenderingContext2D,
  )
  mount()
})
afterEach(() => {
  app?.unmount()
  app = undefined
  host.remove()
  synthetic.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('local multi-image splitter DOM', () => {
  it('adds multiple picker and dropped images, reorders, exports batch/ZIP in current order, and saves synthetic DOM evidence', async () => {
    await upload([fixture('fake-A.png'), fixture('fake-B.png', 9, 1793)])
    await upload([fixture('fake-C.png', 10, 4)], true)
    expect(host.querySelectorAll('[data-source]').length).toBe(3)
    await click('上移 fake-B.png')
    expect(
      [...host.querySelectorAll('[data-source]')].map((li) => li.getAttribute('data-source')),
    ).toEqual(['fake-B.png', 'fake-A.png', 'fake-C.png'])
    const exportStart = decodeBitmap.mock.calls.length
    await click('依序下載所有 PNG')
    await idle()
    expect(decodeBitmap.mock.calls.slice(exportStart).map(([file]) => file.name)).toEqual([
      'fake-B.png',
      'fake-A.png',
      'fake-C.png',
    ])
    expect(clicks).toEqual([
      '001-001.png',
      '001-002.png',
      '002-001.png',
      '002-002.png',
      '003-001.png',
    ])
    await click('依序下載 ZIP')
    await idle()
    const blob = [...blobs.values()].find((blob) => blob.type === 'application/zip')!
    const zip = await JSZip.loadAsync(await blob.arrayBuffer(), { checkCRC32: true })
    expect(Object.keys(zip.files)).toEqual([
      '001/001.png',
      '001/002.png',
      '002/001.png',
      '002/002.png',
      '003/001.png',
    ])
    expect(dimensions(await zip.file('001/002.png')!.async('uint8array'))).toEqual({
      width: 9,
      height: 1,
    })
    expect(dimensions(await zip.file('003/001.png')!.async('uint8array'))).toEqual({
      width: 10,
      height: 4,
    })
    await click('下載切片 1 PNG')
    await idle()
    expect(clicks.at(-1)).toBe('002-001.png')
    expect(fetch).not.toHaveBeenCalled()
    const evidence = 'evidence/splitter/'
    mkdirSync(evidence, { recursive: true })
    writeFileSync(
      evidence + 'synthetic-dom.html',
      await format(
        '<!doctype html>\n<meta charset="utf-8">\n<!-- Synthetic fixtures only. Canvas DOM snapshot; no image URLs or embedded images. Not a browser screenshot. -->\n' +
          host.innerHTML +
          '\n',
        { parser: 'html', printWidth: 100 },
      ),
    )
    const count = blobs.size
    await click('移除 fake-A.png')
    expect(revoked).toHaveBeenCalled()
    expect(host.querySelectorAll('[data-source]').length).toBe(2)
    expect(blobs.size).toBe(count)
    app!.unmount()
    app = undefined
    expect(new Set(revoked.mock.calls.map(([url]) => url))).toEqual(new Set(blobs.keys()))
    expect(closed).toHaveBeenCalledTimes(decodeBitmap.mock.calls.length)
  })
  it('renders full and slice canvases with the actual self-only imgSrc policy and no image URLs', async () => {
    const server = readFileSync('server/src/app.ts', 'utf8')
    const configured = server.match(/imgSrc:\s*(\[[^\]]*\])/)?.[1]
    expect(configured).toBeTruthy()
    expect(JSON.parse(configured!)).toEqual(["'self'"])
    await upload([fixture('fake-csp.png', 828, 4000)])
    expect(host.querySelectorAll('.splitter-source canvas')).toHaveLength(1)
    expect(host.querySelectorAll('.splitter-thumbnail canvas')).toHaveLength(3)
    expect(
      host.querySelectorAll('img, [src], [srcset], [poster], object, embed, image'),
    ).toHaveLength(0)
    expect(host.innerHTML).not.toMatch(/blob:|data:|url\(/)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    const canvases = [...host.querySelectorAll('canvas')]
    expect(canvases.every((canvas) => canvas.width > 0 && canvas.height > 0)).toBe(true)
    expect(host.querySelector('.splitter-source')?.getAttribute('style')).toContain('828 / 4000')
    expect(
      [...host.querySelectorAll('.splitter-thumbnail canvas')].map((canvas) => [
        canvas.getAttribute('data-start'),
        canvas.getAttribute('data-end'),
      ]),
    ).toEqual([
      ['0', '1792'],
      ['1792', '3584'],
      ['3584', '4000'],
    ])
    await click('移除 fake-csp.png')
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true)
    expect(closed).toHaveBeenCalledTimes(2)
    expect(fetch).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(host.querySelectorAll('canvas')).toHaveLength(0)
  })
  it('supports keyboard and touch/mouse pointer clamps with no empty slices', async () => {
    await upload([fixture('fake-tall.png', 8, 6000)])
    const cut = () => host.querySelector<HTMLElement>('[role=slider]')!
    cut().dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    await nextTick()
    expect(cut().getAttribute('aria-valuenow')).toBe('1')
    cut().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }),
    )
    await nextTick()
    expect(cut().getAttribute('aria-valuenow')).toBe('11')
    cut().dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    await nextTick()
    expect(cut().getAttribute('aria-valuenow')).toBe('3583')
    const source = host.querySelector<HTMLElement>('.splitter-source')!
    vi.spyOn(source, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 600 } as DOMRect)
    Object.defineProperty(cut(), 'setPointerCapture', { value: vi.fn(), configurable: true })
    cut().dispatchEvent(
      new PointerEvent('pointerdown', { pointerId: 5, pointerType: 'touch', bubbles: true }),
    )
    cut().dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 5, clientY: -100, bubbles: true }),
    )
    await nextTick()
    expect(cut().getAttribute('aria-valuenow')).toBe('1')
    cut().dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 5, clientY: 9000, bubbles: true }),
    )
    await nextTick()
    expect(cut().getAttribute('aria-valuenow')).toBe('3583')
    cut().dispatchEvent(new PointerEvent('pointercancel', { pointerId: 5, bubbles: true }))
    cut().dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 5, clientY: 100, bubbles: true }),
    )
    await nextTick()
    expect(cut().getAttribute('aria-valuenow')).toBe('3583')
    cut().dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 6,
        pointerType: 'mouse',
        button: 0,
        bubbles: true,
      }),
    )
    cut().dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 6, clientY: 300, bubbles: true }),
    )
    await nextTick()
    expect(cut().getAttribute('aria-valuenow')).toBe('2000')
    cut().dispatchEvent(new PointerEvent('pointerup', { pointerId: 6, bubbles: true }))
    await click('重設為 1792px')
    expect(cut().getAttribute('aria-valuenow')).toBe('1792')
  })
  it('reports invalid formats and limits, then allows valid images', async () => {
    const bad = new File(['bad'], 'fake.svg', { type: 'image/svg+xml' })
    Object.defineProperty(bad, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('bad').buffer,
    })
    await upload([bad])
    expect(host.querySelector('[role=alert]')?.textContent).toContain('僅支援')
    expect(decodeBitmap).not.toHaveBeenCalled()
    await upload(Array.from({ length: 13 }, () => fixture('fake.png', 1, 1)))
    expect(host.querySelector('[role=alert]')?.textContent).toContain('12 張')
    await upload([fixture('fake-valid.png', 1, 1)])
    expect(host.querySelectorAll('[data-source]').length).toBe(1)
  })
  it('closes a bitmap resolved after unmount without creating URLs or stale UI', async () => {
    let resolve!: (bitmap: { width: number; height: number; close: () => void }) => void
    decodeBitmap.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const file = fixture('fake-pending.png')
    const input = host.querySelector<HTMLInputElement>('input[type=file]')!
    Object.defineProperty(input, 'files', { value: [file] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    app!.unmount()
    app = undefined
    resolve({ width: 8, height: 3584, close: closed })
    await new Promise((done) => setTimeout(done, 10))
    expect(closed).toHaveBeenCalledTimes(1)
    expect(blobs.size).toBe(0)
  })
  it('enforces file byte and aggregate pixel limits before decoding', async () => {
    const big = fixture('fake-big.png', 1, 1)
    Object.defineProperty(big, 'size', { value: 21 * 1024 ** 2 })
    await upload([big])
    expect(host.querySelector('[role=alert]')?.textContent).toContain('20 MiB')
    expect(decodeBitmap).not.toHaveBeenCalled()
    const files = Array.from({ length: 3 }, (_, i) => fixture(`fake-${i}.png`, 1, 1))
    for (const file of files) Object.defineProperty(file, 'size', { value: 15 * 1024 ** 2 })
    await upload(files)
    expect(host.querySelector('[role=alert]')?.textContent).toContain('40 MiB')
    expect(decodeBitmap).not.toHaveBeenCalled()
    const headerOnly = fixture('fake-over-pixels.png', 1, 1)
    const header = encodeSlice(new Uint8Array(4), 1, 1, { start: 0, end: 1 })
    const view = new DataView(header.buffer)
    view.setUint32(16, 4000)
    view.setUint32(20, 4000)
    Object.defineProperty(headerOnly, 'arrayBuffer', {
      configurable: true,
      value: async () => header.buffer,
    })
    await upload([headerOnly])
    expect(host.querySelector('[role=alert]')?.textContent).toContain('1200 萬像素')
    expect(decodeBitmap).not.toHaveBeenCalled()
  })
  it('does not download a pending export after unmount and closes its bitmap', async () => {
    await upload([fixture('fake-export.png')])
    let resolve!: (bitmap: {
      width: number
      height: number
      pixels: Uint8Array
      close: () => void
    }) => void
    decodeBitmap.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    await click('依序下載 ZIP')
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true)
    app!.unmount()
    app = undefined
    resolve({ width: 8, height: 3584, pixels: new Uint8Array(8 * 3584 * 4), close: closed })
    await new Promise((done) => setTimeout(done, 20))
    expect(clicks).toEqual([])
    expect(closed).toHaveBeenCalledTimes(3)
    expect(revoked).not.toHaveBeenCalled()
  })
  it('adds the sidebar route under the existing auth guard', async () => {
    expect(mainNav.find((item) => item.to === '/image-splitter')?.label).toBe('詐騙訊息切割截圖')
    const route = router.resolve('/image-splitter')
    expect(route.matched.some((record) => record.meta.requiresAuth)).toBe(true)
    await router.push('/image-splitter')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/image-splitter')
  })
})
