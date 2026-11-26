// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeSlice } from './core'
import { createDocx, DOCX_LAYOUT, docxFilename, replaceHeaderName, victimNameError } from './docx'
import type { Orientation, PerPage } from './layout'

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
      const [width, height] = sizes[i]
      const originalScale = Math.min(4652 / width, 9059 / height)
      expect([cx, cy]).toEqual([
        Math.floor(width * originalScale * 635),
        Math.floor(height * originalScale * 635),
      ])
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
  it.each<[PerPage, Orientation, number, number]>([
    [3, 'portrait', 1, 3],
    [4, 'landscape', 2, 2],
    [4, 'portrait', 2, 2],
    [6, 'landscape', 3, 2],
    [6, 'portrait', 2, 3],
  ])(
    'packs %i per %s page into fitted, fixed-height cells',
    async (perPage, orientation, cols, rows) => {
      const samples = [
        [480, 480],
        [520, 420],
        [390, 550],
        [120, 100],
      ].map(([width, height], i) => ({
        width,
        height,
        png: encodeSlice(new Uint8Array(width * height * 4).fill(i + 1), width, height, {
          start: 0,
          end: height,
        }),
      }))
      const ordered = [0, 1, 2, 3, 2, 1, 0].map((i) => samples[i])
      const output = await createDocx({
        name: 'Mock',
        total: ordered.length,
        template: template(),
        layout: { perPage, orientation },
        images: async (append) => {
          for (const { png } of ordered) await append(png)
        },
      })
      const zip = await JSZip.loadAsync(output, { checkCRC32: true })
      const doc = parse(await zip.file('word/document.xml')!.async('string'))
      const pageSize = doc.getElementsByTagName('w:pgSz')[0]
      const [pageWidth, pageHeight] = orientation === 'landscape' ? [16838, 11906] : [11906, 16838]
      expect(pageSize.getAttribute('w:orient')).toBe(orientation)
      expect(pageSize.getAttribute('w:w')).toBe(String(pageWidth))
      expect(pageSize.getAttribute('w:h')).toBe(String(pageHeight))
      const margins = doc.getElementsByTagName('w:pgMar')[0]
      for (const [edge, value] of Object.entries({
        top: 1500,
        right: 567,
        bottom: 567,
        left: 567,
        header: 851,
        footer: 284,
        gutter: 0,
      }))
        expect(margins.getAttribute(`w:${edge}`)).toBe(String(value))
      expect(doc.getElementsByTagName('w:headerReference')[0].getAttribute('r:id')).toBe('rId7')
      expect(doc.getElementsByTagName('w:footerReference')[0].getAttribute('r:id')).toBe('rId8')
      const tables = [...doc.getElementsByTagName('w:tbl')]
      const pages = Math.ceil(ordered.length / perPage)
      expect(tables).toHaveLength(pages)
      const spacers = [...doc.getElementsByTagName('w:body')[0].children].filter(
        (node) => node.tagName === 'w:p',
      )
      expect(spacers).toHaveLength(pages)
      for (const [index, spacer] of spacers.entries()) {
        const [properties, run] = spacer.children
        expect(properties.tagName).toBe('w:pPr')
        expect(run.tagName).toBe('w:r')
        const spacing = properties.getElementsByTagName('w:spacing')[0]
        expect(spacing.getAttribute('w:before')).toBe('0')
        expect(spacing.getAttribute('w:after')).toBe('0')
        expect(spacing.getAttribute('w:line')).toBe('20')
        expect(spacing.getAttribute('w:lineRule')).toBe('exact')
        expect(properties.getElementsByTagName('w:snapToGrid')[0].getAttribute('w:val')).toBe('0')
        for (const node of [properties, run]) {
          const rPr = node.getElementsByTagName('w:rPr')[0]
          expect(rPr.getElementsByTagName('w:sz')[0].getAttribute('w:val')).toBe('2')
        }
        expect(
          [...run.getElementsByTagName('w:br')].map((br) => br.getAttribute('w:type')),
        ).toEqual(index < pages - 1 ? ['page'] : [])
      }
      const columnWidth = Math.floor((pageWidth - 567 * 2) / cols)
      const rowHeight = Math.floor((pageHeight - 1500 - 567 - 450) / rows)
      for (const [pageIndex, table] of tables.entries()) {
        expect(table.getElementsByTagName('w:tblLayout')[0].getAttribute('w:type')).toBe('fixed')
        expect(
          [...table.getElementsByTagName('w:tblBorders')[0].children].map((node) =>
            node.getAttribute('w:val'),
          ),
        ).toEqual(Array(6).fill('nil'))
        expect(
          [...table.getElementsByTagName('w:tblCellMar')[0].children].map((node) =>
            node.getAttribute('w:w'),
          ),
        ).toEqual(Array(4).fill('0'))
        expect(
          [...table.getElementsByTagName('w:gridCol')].map((node) => node.getAttribute('w:w')),
        ).toEqual(Array(cols).fill(String(columnWidth)))
        const tableRows = [...table.getElementsByTagName('w:tr')]
        expect(tableRows).toHaveLength(rows)
        const totalRowHeight = tableRows.reduce(
          (total, row) =>
            total + Number(row.getElementsByTagName('w:trHeight')[0].getAttribute('w:val')),
          0,
        )
        expect(totalRowHeight + 450 + 1500 + 567).toBeLessThanOrEqual(pageHeight)
        for (const [rowIndex, row] of tableRows.entries()) {
          const rowSize = row.getElementsByTagName('w:trHeight')[0]
          expect(rowSize.getAttribute('w:hRule')).toBe('exact')
          expect(rowSize.getAttribute('w:val')).toBe(String(rowHeight))
          expect(row.getElementsByTagName('w:cantSplit')).toHaveLength(1)
          const cells = [...row.getElementsByTagName('w:tc')]
          expect(cells).toHaveLength(cols)
          for (const [colIndex, cell] of cells.entries()) {
            expect(cell.getElementsByTagName('w:tcW')[0].getAttribute('w:w')).toBe(
              String(columnWidth),
            )
            expect(cell.getElementsByTagName('w:vAlign')[0].getAttribute('w:val')).toBe('center')
            expect(cell.getElementsByTagName('w:jc')[0].getAttribute('w:val')).toBe('center')
            const index = pageIndex * perPage + rowIndex * cols + colIndex
            const extents = cell.getElementsByTagName('wp:extent')
            if (index >= ordered.length) {
              expect(extents).toHaveLength(0)
              continue
            }
            expect(extents).toHaveLength(1)
            const cx = Number(extents[0].getAttribute('cx'))
            const cy = Number(extents[0].getAttribute('cy'))
            const { width, height } = ordered[index]
            expect(cx).toBeLessThanOrEqual((columnWidth - 40) * 635)
            expect(cy).toBeLessThanOrEqual((rowHeight - 80) * 635)
            expect(cx / width).toBeLessThanOrEqual(15 * 635)
            expect(cy / height).toBeLessThanOrEqual(15 * 635)
            expect(cx / cy).toBeCloseTo(width / height, 5)
            expect(cell.getElementsByTagName('a:blip')[0].getAttribute('r:embed')).toBe(
              `splitterImage${index + 1}`,
            )
          }
        }
      }
      const rels = parse(await zip.file('word/_rels/document.xml.rels')!.async('string'))
      const imageRels = [...rels.getElementsByTagName('Relationship')].filter((node) =>
        node.getAttribute('Id')?.startsWith('splitterImage'),
      )
      expect(imageRels).toHaveLength(ordered.length)
      for (const [i, node] of imageRels.entries()) {
        expect(node.getAttribute('Id')).toBe(`splitterImage${i + 1}`)
        expect(node.getAttribute('Type')).toBe(
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
        )
        const target = `media/screenshot-${i + 1}.png`
        expect(node.getAttribute('Target')).toBe(target)
        const embedded = await zip.file(`word/${target}`)!.async('nodebuffer')
        expect(embedded.equals(ordered[i].png)).toBe(true)
      }
    },
  )
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
