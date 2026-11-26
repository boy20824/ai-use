// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
  vi.stubGlobal('IntersectionObserver', undefined)
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
  decodeBitmap = vi.fn(async (file: File, x: number, y: number, width: number, height: number) => {
    const src = synthetic.get(file)!
    const cropped = new Uint8Array(width * height * 4)
    for (let row = 0; row < height; row++) {
      const start = ((y + row) * src.width + x) * 4
      cropped.set(src.pixels.subarray(start, start + width * 4), row * width * 4)
    }
    return {
      width,
      height,
      pixels: cropped,
      close: closed,
    }
  })
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
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(4000)
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
  it('disables Word with a required-name hint until slices and a valid Mock name are available', async () => {
    const button = () =>
      [...host.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === '產出 Word',
      )!
    const input = host.querySelector<HTMLInputElement>('#splitter-victim-name')!
    expect(input.maxLength).toBe(50)
    expect(input.required).toBe(true)
    expect(button().disabled).toBe(true)
    expect(host.querySelector('#splitter-word-hint')?.textContent).toContain('必填')
    await upload([fixture('fake-word.png')])
    input.value = '   '
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(button().disabled).toBe(true)
    expect(host.querySelector('#splitter-word-hint')?.textContent).toContain('請填寫被害人姓名')
    input.value = '王小明(Mock)'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(button().disabled).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('updates the Word page count, grid and hint from the native radios without decoding images', async () => {
    const radio = (group: string, value: string) =>
      host.querySelector<HTMLInputElement>(`input[name="splitter-${group}"][value="${value}"]`)!
    const summary = () => host.querySelector('.splitter-word-summary')!.textContent
    expect(radio('per-page', '3').checked).toBe(true)
    expect(radio('orientation', 'landscape').checked).toBe(true)
    expect(radio('per-page', '3').closest('label')?.textContent).toContain('原版')
    await upload([fixture('fake-layout.png', 4, 6 * 1792 + 11)])
    const input = host.querySelector<HTMLInputElement>('#splitter-victim-name')!
    input.value = 'Mock'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(summary()).toContain('每頁 3 欄 × 1 列')
    expect(summary()).toContain('預計 3 頁（原版 3 頁，省 0 頁）')
    const usedDecodes = decodeBitmap.mock.calls.length
    radio('per-page', '4').click()
    radio('orientation', 'portrait').click()
    await nextTick()
    expect(summary()).toContain('每頁 4 欄 × 1 列')
    expect(summary()).toContain('預計 2 頁（原版 3 頁，省 1 頁）')
    expect(summary()).toContain('181 dpi')
    expect(summary()).toContain('建議把切片高度調整為約 21 px，可讓每張圖再放大約 89%')
    expect(host.querySelector('#splitter-word-hint')?.textContent).toContain(
      '每頁依序放置 4 張切片，使用 A4 直式',
    )
    radio('per-page', '6').click()
    await nextTick()
    expect(summary()).toContain('每頁 6 欄 × 1 列')
    expect(decodeBitmap).toHaveBeenCalledTimes(usedDecodes)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('edits both crop edges, updates thumbnails and Word sizing, and exports the clamped crop locally', async () => {
    const first = fixture('fake-crop-A.png', 60, 70)
    const second = fixture('fake-crop-B.png', 24, 70)
    await upload([first, second])
    host.querySelector<HTMLInputElement>('input[name="splitter-per-page"][value="4"]')!.click()
    await nextTick()
    const summary = () => host.querySelector('.splitter-word-summary')!.textContent
    expect(summary()).toContain('每頁 2 欄 × 2 列')
    expect(summary()).toContain('96 dpi')
    expect(summary()).toContain('文字可能偏小')
    expect(summary()).not.toContain('建議把切片高度調整為約')
    await click('下載 PNG（切片 1）')
    await idle()
    const previousUrl = [...blobs.keys()].at(-1)
    const left = () => host.querySelector<HTMLInputElement>('#splitter-cropLeft')!
    const right = () => host.querySelector<HTMLInputElement>('#splitter-cropRight')!
    const rightRange = host.querySelector<HTMLInputElement>(
      'input[type=range][aria-labelledby="splitter-label-cropRight"]',
    )!
    left().value = '12.3'
    left().dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    rightRange.value = '18'
    rightRange.dispatchEvent(new Event('input', { bubbles: true }))
    await idle()
    expect(left().value).toBe('12')
    expect(right().value).toBe('18')
    expect(revoked).toHaveBeenCalledWith(previousUrl)
    expect(summary()).toContain('每頁 4 欄 × 1 列')
    expect(host.querySelector('.splitter-slices')?.textContent).toContain('30 × 70px')
    expect(
      [...host.querySelectorAll<HTMLElement>('.splitter-crop-shade')].map((bar) => bar.style.width),
    ).toEqual(['20%', '30%'])
    expect(decodeBitmap).toHaveBeenCalledWith(first, 12, 0, 30, 70, expect.any(Object))
    const select = async (name: string) => {
      host.querySelector<HTMLButtonElement>(`[data-source="${name}"] .splitter-select`)!.click()
      await idle()
    }
    await select(second.name)
    expect(left().value).toBe('0')
    expect(right().value).toBe('0')
    await select(first.name)
    await click('套用到全部圖片')
    await select(second.name)
    expect(left().value).toBe('12')
    expect(right().value).toBe('9')
    expect(host.querySelector('.splitter-slices')?.textContent).toContain('3 × 70px')
    right().value = '999'
    right().dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    expect(right().value).toBe('9')
    await click('下載 PNG（切片 1）')
    await idle()
    expect(dimensions(new Uint8Array(await [...blobs.values()].at(-1)!.arrayBuffer()))).toEqual({
      width: 3,
      height: 70,
    })
    await click('依序下載 ZIP')
    expect(host.querySelector<HTMLFieldSetElement>('.splitter-crop')?.disabled).toBe(true)
    await idle()
    const zip = await JSZip.loadAsync(await [...blobs.values()].at(-1)!.arrayBuffer())
    expect(dimensions(await zip.file('001/001.png')!.async('uint8array'))).toEqual({
      width: 30,
      height: 70,
    })
    expect(dimensions(await zip.file('002/001.png')!.async('uint8array'))).toEqual({
      width: 3,
      height: 70,
    })
    await click('重設裁切')
    await idle()
    expect(left().value).toBe('0')
    expect(right().value).toBe('0')
    expect(
      [...host.querySelectorAll<HTMLElement>('.splitter-crop-shade')].map((bar) => bar.style.width),
    ).toEqual(['0%', '0%'])
    const name = host.querySelector<HTMLInputElement>('#splitter-victim-name')!
    name.value = 'Mock'
    name.dispatchEvent(new Event('input', { bubbles: true }))
    host
      .querySelector<HTMLInputElement>('input[name="splitter-orientation"][value="portrait"]')!
      .click()
    await nextTick()
    const template = Uint8Array.from(
      readFileSync('public/templates/scam-screenshots-template.docx'),
    ).buffer
    const fetchTemplate = vi.fn(async () => ({ ok: true, arrayBuffer: async () => template }))
    vi.stubGlobal('fetch', fetchTemplate)
    await click('產出 Word')
    await idle()
    const docx = await JSZip.loadAsync(await [...blobs.values()].at(-1)!.arrayBuffer())
    const xml = await docx.file('word/document.xml')!.async('string')
    expect(xml).toContain('w:orient="portrait"')
    expect(xml.match(/<w:tc>/g)).toHaveLength(4)
    expect(dimensions(await docx.file('word/media/screenshot-1.png')!.async('uint8array'))).toEqual(
      { width: 30, height: 70 },
    )
    expect(dimensions(await docx.file('word/media/screenshot-2.png')!.async('uint8array'))).toEqual(
      { width: 24, height: 70 },
    )
    expect(fetchTemplate.mock.calls).toEqual([
      ['/templates/scam-screenshots-template.docx', { mode: 'same-origin' }],
    ])
  })
  it('downloads Word from locally exported PNGs in source order and recovers after template failure', async () => {
    await upload([fixture('fake-word-A.png'), fixture('fake-word-B.png', 9, 1793)])
    const input = host.querySelector<HTMLInputElement>('#splitter-victim-name')!
    input.value = '王小明(Mock)'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    await click('產出 Word')
    await idle()
    expect(host.querySelector('[role=alert]')?.textContent).toContain('無法產出 Word')
    expect(clicks).toEqual([])
    const template = Uint8Array.from(
      readFileSync('public/templates/scam-screenshots-template.docx'),
    ).buffer
    const fetchTemplate = vi.fn(async () => ({ ok: true, arrayBuffer: async () => template }))
    vi.stubGlobal('fetch', fetchTemplate)
    await click('產出 Word')
    await idle()
    expect(clicks[0]).toMatch(/^詐騙對話截圖_王小明\(Mock\)_\d{7}\.docx$/)
    const blob = [...blobs.values()].find(
      (blob) =>
        blob.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )!
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(
      await Promise.all(
        [1, 2, 3, 4].map(async (i) =>
          dimensions(await zip.file(`word/media/screenshot-${i}.png`)!.async('uint8array')),
        ),
      ),
    ).toEqual([
      { width: 8, height: 1792 },
      { width: 8, height: 1792 },
      { width: 9, height: 1792 },
      { width: 9, height: 1 },
    ])
    expect(fetchTemplate.mock.calls).toEqual([
      ['/templates/scam-screenshots-template.docx', { mode: 'same-origin' }],
    ])
    expect(host.querySelector('[role=alert]')).toBeNull()
  })
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
    await click('下載 PNG（切片 1）')
    await idle()
    expect(clicks.at(-1)).toBe('002-001.png')
    expect(fetch).not.toHaveBeenCalled()
    const evidence = mkdtempSync('/tmp/ai-use-splitter-') + '/'
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
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('fake-A.png')
    expect(host.querySelectorAll('[data-source]')).toHaveLength(3)
    await click('取消')
    expect(host.querySelectorAll('[data-source]')).toHaveLength(3)
    await click('移除 fake-A.png')
    await click('確定')
    expect(revoked).toHaveBeenCalled()
    expect(host.querySelectorAll('[data-source]').length).toBe(2)
    expect(blobs.size).toBe(count)
    app!.unmount()
    app = undefined
    expect(new Set(revoked.mock.calls.map(([url]) => url))).toEqual(new Set(blobs.keys()))
    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(decodeBitmap.mock.calls.length))
  })
  it('renders full and slice canvases with the actual self-only imgSrc policy and no image URLs', async () => {
    const server = readFileSync('server/src/app.ts', 'utf8')
    const configured = server.match(/imgSrc:\s*(\[[^\]]*\])/)?.[1]
    expect(configured).toBeTruthy()
    expect(JSON.parse(configured!)).toEqual(["'self'"])
    await upload([fixture('fake-csp.png', 828, 4000)])
    expect(host.querySelectorAll('.splitter-source canvas')).toHaveLength(2)
    expect(host.querySelectorAll('.splitter-thumbnail canvas')).toHaveLength(3)
    expect(
      host.querySelectorAll('img, [src], [srcset], [poster], object, embed, image'),
    ).toHaveLength(0)
    expect(host.innerHTML).not.toMatch(/blob:|data:|url\(/)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    const canvases = [...host.querySelectorAll('canvas')]
    expect(canvases.every((canvas) => canvas.width > 0 && canvas.height > 0)).toBe(true)
    expect(host.querySelector('.splitter-source-spacer')?.getAttribute('style')).toContain(
      'width: 600px',
    )
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
    await click('確定')
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true)
    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(decodeBitmap.mock.calls.length))
    expect(fetch).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(host.querySelectorAll('canvas')).toHaveLength(0)
  })
  it('supports keyboard and touch/mouse pointer clamps with no empty slices', async () => {
    await upload([fixture('fake-tall.png', 8, 50003)])
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
      new PointerEvent('pointermove', {
        pointerId: 6,
        clientY: 2100,
        bubbles: true,
      }),
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
    expect(host.querySelectorAll('[data-source]')).toHaveLength(13)
    await upload([fixture('fake-valid.png', 1, 1)])
    expect(host.querySelectorAll('[data-source]').length).toBe(14)
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
    resolve({ width: 8, height: 2048, close: closed })
    await new Promise((done) => setTimeout(done, 10))
    expect(closed).toHaveBeenCalledTimes(1)
    expect(blobs.size).toBe(0)
  })
  it('enforces only the 200 MiB per-file cap and accepts aggregate bytes and pixels', async () => {
    const big = fixture('fake-big.png', 1, 1)
    Object.defineProperty(big, 'size', { value: 200 * 1024 ** 2 + 1 })
    await upload([big])
    expect(host.querySelector('[role=alert]')?.textContent).toContain('200 MiB')
    expect(decodeBitmap).not.toHaveBeenCalled()
    const files = Array.from({ length: 3 }, (_, i) => fixture(`fake-${i}.png`, 1, 1))
    for (const file of files) Object.defineProperty(file, 'size', { value: 200 * 1024 ** 2 })
    await upload(files)
    expect(host.querySelectorAll('[data-source]')).toHaveLength(3)
    expect(host.querySelector('[role=alert]')).toBeNull()
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
    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(decodeBitmap.mock.calls.length))
    expect(revoked).not.toHaveBeenCalled()
  })
  it('reports cropped decode failure, clears downloads and allows retry without stale output', async () => {
    await upload([fixture('fake-fail-export.png')])
    decodeBitmap.mockRejectedValueOnce(new Error('synthetic allocation failure'))
    await click('依序下載 ZIP')
    await vi.waitFor(() =>
      expect(host.querySelector('section')?.getAttribute('aria-busy')).toBe('false'),
    )
    expect(host.querySelector('[role=alert]')?.textContent).toContain('轉存 PNG')
    expect(clicks).toEqual([])
    await click('依序下載 ZIP')
    await idle()
    expect(clicks).toEqual(['詐騙訊息切割截圖.zip'])
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
