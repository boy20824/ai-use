// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeSlice } from './core'
import { createDocx, DOCX_LAYOUT, docxFilename, replaceHeaderName, victimNameError } from './docx'

const template = () =>
  Uint8Array.from(readFileSync('public/templates/scam-screenshots-template.docx')).buffer
const sizes = [
  [8, 40],
  [40, 8],
  [9, 9],
  [5, 80],
  [80, 5],
  [3, 10],
  [7, 60],
]
const pngs = sizes.map(([width, height], i) =>
  encodeSlice(new Uint8Array(width * height * 4).fill(i + 1), width, height, {
    start: 0,
    end: height,
  }),
)
const images = async (append: (png: Uint8Array) => Promise<void>) => {
  for (const png of pngs) await append(png)
}
function parse(xml: string) {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  expect(document.getElementsByTagName('parsererror')).toHaveLength(0)
  return document
}
afterEach(() => vi.unstubAllGlobals())

describe('local screenshot Word addon with the supplied Mock template', () => {
  it('writes sizes in every local file header without data descriptors', async () => {
    const bytes = await createDocx({ name: '王小明', total: 7, images, template: template() })
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let offset = 0
    let entries = 0
    while (view.getUint32(offset, true) === 0x04034b50) {
      const flags = view.getUint16(offset + 6, true)
      const compressedSize = view.getUint32(offset + 18, true)
      expect(flags & 0x0008).toBe(0)
      expect(compressedSize).not.toBe(0xffffffff)
      const filenameLength = view.getUint16(offset + 26, true)
      const extraLength = view.getUint16(offset + 28, true)
      const filename = new TextDecoder().decode(
        bytes.subarray(offset + 30, offset + 30 + filenameLength),
      )
      // Directory entries have no payload; every actual file must have its size populated.
      if (!filename.endsWith('/')) expect(compressedSize).not.toBe(0)
      offset += 30 + filenameLength + extraLength + compressedSize
      entries++
    }
    expect(view.getUint32(offset, true)).toBe(0x02014b50)
    const zip = await JSZip.loadAsync(bytes)
    expect(entries).toBe(Object.keys(zip.files).length)
    expect(entries).toBeGreaterThan(0)
  })
  it('packs seven ordered PNGs into three borderless three-cell pages, preserving template parts and layout', async () => {
    const source = template()
    const onProgress = vi.fn()
    const zip = await JSZip.loadAsync(
      await createDocx({ name: ' 王小明(Mock) ', total: 7, images, template: source, onProgress }),
      { checkCRC32: true },
    )
    const original = await JSZip.loadAsync(source)
    const xml = await zip.file('word/document.xml')!.async('string')
    const doc = parse(xml)
    const tables = [...doc.getElementsByTagName('w:tbl')]
    expect(tables).toHaveLength(3)
    expect([...doc.getElementsByTagName('w:br')].map((br) => br.getAttribute('w:type'))).toEqual([
      'page',
      'page',
    ])
    for (const table of tables) {
      expect(table.getElementsByTagName('w:tr')).toHaveLength(1)
      expect(table.getElementsByTagName('w:tc')).toHaveLength(3)
      expect(
        [...table.getElementsByTagName('w:tblBorders')[0].children].every(
          (border) => border.getAttribute('w:val') === 'nil',
        ),
      ).toBe(true)
    }
    expect(
      [...tables[2].getElementsByTagName('w:tc')].map(
        (cell) => cell.getElementsByTagName('pic:pic').length,
      ),
    ).toEqual([1, 0, 0])
    expect(
      [...doc.getElementsByTagName('a:blip')].map((node) => node.getAttribute('r:embed')),
    ).toEqual(pngs.map((_, i) => `splitterImage${i + 1}`))
    const extents = [...doc.getElementsByTagName('wp:extent')]
    expect(extents).toHaveLength(7)
    for (const [i, extent] of extents.entries()) {
      const cx = Number(extent.getAttribute('cx'))
      const cy = Number(extent.getAttribute('cy'))
      expect(Math.abs(cx / cy / (sizes[i][0] / sizes[i][1]) - 1)).toBeLessThan(0.00001)
      expect(cx).toBeLessThanOrEqual(DOCX_LAYOUT.columnWidth * 635)
      expect(cy).toBeLessThanOrEqual(DOCX_LAYOUT.imageHeight * 635)
      expect(await zip.file(`word/media/screenshot-${i + 1}.png`)!.async('uint8array')).toEqual(
        pngs[i],
      )
    }
    const originalDocument = await original.file('word/document.xml')!.async('string')
    expect(xml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)?.[0]).toBe(
      originalDocument.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)?.[0],
    )
    expect(doc.getElementsByTagName('w:pgSz')[0].getAttribute('w:orient')).toBe('landscape')
    const header = await zip.file('word/header1.xml')!.async('string')
    expect(parse(header).documentElement.textContent).toContain(
      '被害人王小明(Mock)提供之遭詐騙對話、相關證據',
    )
    const run = [...parse(header).getElementsByTagName('w:r')].find(
      (run) => run.textContent === '王小明(Mock)',
    )!
    expect(run.getElementsByTagName('w:rFonts')[0].getAttribute('w:eastAsia')).toBe('標楷體')
    expect(run.getElementsByTagName('w:sz')[0].getAttribute('w:val')).toBe('32')
    expect(run.getElementsByTagName('w:b')).toHaveLength(1)
    for (const path of Object.keys(original.files)) {
      if (
        [
          'word/document.xml',
          'word/header1.xml',
          'word/_rels/document.xml.rels',
          '[Content_Types].xml',
        ].includes(path)
      )
        continue
      expect(await zip.file(path)!.async('uint8array')).toEqual(
        await original.file(path)!.async('uint8array'),
      )
    }
    expect(await zip.file('word/footer1.xml')!.async('string')).toContain('PAGE')
    const rels = parse(await zip.file('word/_rels/document.xml.rels')!.async('string'))
    const relations = [...rels.getElementsByTagName('Relationship')]
    for (let i = 1; i <= 7; i++)
      expect(
        relations
          .find((node) => node.getAttribute('Id') === `splitterImage${i}`)
          ?.getAttribute('Target'),
      ).toBe(`media/screenshot-${i}.png`)
    const types = parse(await zip.file('[Content_Types].xml')!.async('string'))
    expect(
      [...types.getElementsByTagName('Default')]
        .find((node) => node.getAttribute('Extension') === 'png')
        ?.getAttribute('ContentType'),
    ).toBe('image/png')
    expect(onProgress.mock.calls).toEqual(pngs.map((_, i) => [i + 1, 7]))
  })
  it('escapes every XML special character as plain text in the header', async () => {
    const name = `王小明(Mock)<script>&"'`
    const zip = await JSZip.loadAsync(
      await createDocx({ name, total: 7, images, template: template() }),
    )
    const header = await zip.file('word/header1.xml')!.async('string')
    expect(header).toContain('王小明(Mock)&lt;script&gt;&amp;&quot;&apos;')
    expect(header).not.toContain('<script>')
    expect(parse(header).documentElement.textContent).toContain(name)
  })
  it('replaces a placeholder split across styled runs, retaining run properties and surrounding text', async () => {
    const zip = await JSZip.loadAsync(template())
    const header = await zip.file('word/header1.xml')!.async('string')
    const split = header.replace(
      '<w:t>{{被害人姓名}}</w:t>',
      '<w:t>{{被害</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>人姓名}}</w:t>',
    )
    const result = replaceHeaderName(split, '王小明(Mock)')
    expect(parse(result).documentElement.textContent).toBe(
      '被害人王小明(Mock)提供之遭詐騙對話、相關證據',
    )
    expect(result.match(/<w:rPr>[\s\S]*?<\/w:rPr>/g)).toEqual(
      split.match(/<w:rPr>[\s\S]*?<\/w:rPr>/g),
    )
  })
  it('validates names and builds a sanitized ROC date filename', () => {
    expect(victimNameError('   ')).toContain('必填')
    expect(victimNameError('王'.repeat(51))).toContain('50')
    expect(victimNameError('王'.repeat(50))).toBe('')
    for (const control of ['\n', '\t', '\0', '\u007f', '\u0085'])
      expect(victimNameError(`王小明${control}`)).toContain('控制字元')
    expect(docxFilename(' 王小明(Mock) ', new Date(2026, 10, 9))).toBe(
      '詐騙對話截圖_王小明(Mock)_1151109.docx',
    )
    expect(docxFilename('王小明\\/:*?"<>|', new Date(2026, 0, 2))).toBe(
      '詐騙對話截圖_王小明__________1150102.docx',
    )
    expect(() => docxFilename(' ')).toThrow('必填')
  })
  it('fetches only the same-origin template and handles missing templates, invalid names and cancellation', async () => {
    const fetchTemplate = vi.fn(async () => ({ ok: true, arrayBuffer: async () => template() }))
    vi.stubGlobal('fetch', fetchTemplate)
    await createDocx({ name: '王小明', total: 7, images })
    expect(fetchTemplate.mock.calls).toEqual([
      ['/templates/scam-screenshots-template.docx', { mode: 'same-origin' }],
    ])
    fetchTemplate.mockRejectedValueOnce(new Error('offline'))
    await expect(createDocx({ name: '王小明', total: 7, images })).rejects.toThrow(
      '無法讀取 Word 範本',
    )
    await expect(createDocx({ name: ' ', total: 7, images })).rejects.toThrow('必填')
    await expect(
      createDocx({ name: '王小明', total: 7, images, active: () => false }),
    ).rejects.toThrow('已取消')
    await expect(
      createDocx({ name: '王小明', total: 8, images, template: template() }),
    ).rejects.toThrow('切片數量不符')
  })
})
