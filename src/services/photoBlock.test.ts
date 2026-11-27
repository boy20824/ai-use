import { readFileSync } from 'node:fs'
import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'
import { buildDeliveryPhotoTemplate } from '../../shared/deliveryPhotoTemplateFixture'
import { buildPhotoTemplate } from '../../shared/photoTemplateFixture'
import { buildDocx, paragraph, run, wordDocument, wordHeader } from '../../shared/docxFixture'
import { mockPhotoDraft, mockPhotoFields } from '../../shared/photoMock'
import {
  checkPhotoBytes,
  effectivePhotoValues,
  fitPhoto,
  maxPhotoBytes,
  movePhoto,
  photoNumber,
  photoPageCount,
  renderPhotoDocx,
  renderTemplatePhotos,
} from '../../shared/photoBlockRender'
import { renderDocx } from '../../shared/docxRender'
import {
  assertSafeZip,
  decodeXml,
  docxZipLimits,
  listPlaceholders,
  normalizeDocx,
  readPhotoBlock,
  readSafeZip,
} from '../../server/src/docxXml'
import { parsePhotoBlock } from '../../server/src/photoBlocks'

const template = buildPhotoTemplate()
function xmlOf(bytes: Uint8Array) {
  return new PizZip(bytes).file('word/document.xml')!.asText()
}
function text(xml: string) {
  return [...xml.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((m) => decodeXml(m[1]!)).join('')
}
function changeXml(change: (xml: string) => string) {
  const zip = new PizZip(template)
  zip.file('word/document.xml', change(xmlOf(template)))
  return zip.generate({ type: 'uint8array' })
}

describe('動態照片區塊', () => {
  it('Mock 成品可重建，作者為 Mock，通過既有安全與上傳欄位驗證', () => {
    const checkedIn = new Uint8Array(
      readFileSync(new URL('../../public/templates/scene-photos-template.docx', import.meta.url)),
    )
    expect(xmlOf(checkedIn)).toBe(xmlOf(template))
    expect(new PizZip(checkedIn).file('docProps/core.xml')!.asText()).toContain(
      '<dc:creator>Mock</dc:creator>',
    )
    expect(() => assertSafeZip(checkedIn, docxZipLimits)).not.toThrow()
    expect(() => normalizeDocx(checkedIn, docxZipLimits)).not.toThrow()
    expect(listPlaceholders(checkedIn)).toEqual(['年', '月', '警局', '分局', '案次編號', '案由'])
    expect(readPhotoBlock(checkedIn)?.photoCellsPerPage).toBe(2)
  })
  it.each([
    [2, 1],
    [5, 3],
    [7, 4],
    [0, 0],
  ])('%i 張 → %i 頁、連續編號、表頭重複與安全檢查', (count, pages) => {
    expect(photoPageCount(count, 2)).toBe(pages)
    const output = renderPhotoDocx(template, mockPhotoFields, mockPhotoDraft(count))
    const xml = xmlOf(output)
    const plain = text(xml)
    expect(xml.match(/<w:tbl>/g) ?? []).toHaveLength(pages)
    expect(xml.match(/<w:pageBreakBefore\/>/g) ?? []).toHaveLength(Math.max(0, pages - 1))
    expect(xml.match(/<wp:inline\b/g) ?? []).toHaveLength(count)
    expect(plain.match(/Mock 竊盜案/g) ?? []).toHaveLength(pages)
    expect([...plain.matchAll(/編號（(\d+)）/g)].map((m) => Number(m[1]))).toEqual(
      Array.from({ length: count }, (_, i) => i + 1),
    )
    expect(() => readSafeZip(output, docxZipLimits)).not.toThrow()
    expect(() => assertSafeZip(output, docxZipLimits)).not.toThrow()
    expect(() => normalizeDocx(output, docxZipLimits)).not.toThrow()
    if (!count) expect(xml).not.toMatch(/Mock 現場照片|<w:br|pageBreakBefore|照片頁/)
  })
  it('5 張最後一格保留 4 列、框線、標題，所有內容空白', () => {
    const xml = xmlOf(renderPhotoDocx(template, mockPhotoFields, mockPhotoDraft(5)))
    const tables = [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map((m) => m[0])
    const last = tables[2]!
    const rows = [...last.matchAll(/<w:tr>[\s\S]*?<\/w:tr>/g)].map((m) => m[0])
    expect(rows).toHaveLength(10)
    expect(last).toContain('<w:insideH w:val="single" w:sz="4"')
    const blank = rows.slice(-4).join('')
    expect(text(blank)).toBe('編號攝影時間攝影地點攝影人說明')
    expect(blank).not.toMatch(/wp:inline|Mock|（6）|\{\{/)
    expect(blank).toContain('<w:trHeight w:val="4300"')
    expect(blank).toContain('w:eastAsia="標楷體"')
  })
  it('共用值套用、單張攝影人覆寫、明確空字串覆寫', () => {
    const draft = mockPhotoDraft(5)
    const plain = text(xmlOf(renderPhotoDocx(template, mockPhotoFields, draft)))
    const cells = plain.split(/編號(?=（)/).slice(1)
    expect(cells[2]).toContain('李大華(Mock)')
    expect(cells.filter((c) => c.includes('王小明(Mock)'))).toHaveLength(4)
    expect(plain.match(/Mock 市測試路 1 號/g)).toHaveLength(5)
    expect(
      effectivePhotoValues(draft.common, { ...draft.photos[0]!, overrides: { location: '' } })
        .location,
    ).toBe('')
  })
  it('第4張移到最前變（1），編號隨排序重算', () => {
    const draft = mockPhotoDraft(5)
    const fourth = draft.photos[3]!
    draft.photos = movePhoto(draft.photos, 3, 0)
    expect(draft.photos[0]!.id).toBe(fourth.id)
    expect(photoNumber(0)).toBe('（1）')
    const plain = text(xmlOf(renderPhotoDocx(template, mockPhotoFields, draft)))
    expect(plain.split(/編號(?=（)/)[1]).toContain('（1）')
    expect(plain.split(/編號(?=（)/)[1]).toContain(fourth.description)
    expect(plain.match(/編號（\d+）/g)).toEqual([
      '編號（1）',
      '編號（2）',
      '編號（3）',
      '編號（4）',
      '編號（5）',
    ])
  })
  it('說明 XML 字元跳脫，雙大括號不會再被當成標記', () => {
    const draft = mockPhotoDraft(1)
    const xml = xmlOf(renderPhotoDocx(template, mockPhotoFields, draft))
    expect(text(xml)).toContain(draft.photos[0]!.description)
    expect(xml).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;')
    expect(xml).not.toContain('<script>')
    expect(() =>
      normalizeDocx(
        new PizZip(renderPhotoDocx(template, mockPhotoFields, draft)).generate({
          type: 'uint8array',
        }),
        docxZipLimits,
      ),
    ).not.toThrow()
  })
  it('一般範本輸出與既有 renderDocx 完全相同', () => {
    const ordinary = buildDocx({
      document: wordDocument(paragraph(run('', '{{案由}} {{攝影人}}'))),
    })
    expect(listPlaceholders(ordinary)).toEqual(['案由', '攝影人'])
    const fields = { ...mockPhotoFields, 攝影人: 'Mock 文字欄位' }
    expect(renderPhotoDocx(ordinary, fields, mockPhotoDraft(5))).toEqual(
      renderDocx(ordinary, fields),
    )
  })
  it('圖片關係、media、ContentType 與 docPr id 唯一，範本已有 rId 時不衝突', () => {
    const zip = new PizZip(renderPhotoDocx(template, mockPhotoFields, mockPhotoDraft(7)))
    const xml = zip.file('word/document.xml')!.asText()
    const ids = [...xml.matchAll(/<wp:docPr id="(\d+)"/g)].map((m) => m[1])
    expect(new Set(ids).size).toBe(7)
    const rels = zip.file('word/_rels/document.xml.rels')!.asText()
    const relationIds = [...rels.matchAll(/\bId="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(relationIds).size).toBe(relationIds.length)
    for (const m of rels.matchAll(/Target="(media\/[^"]+)"/g))
      expect(zip.file(`word/${m[1]}`)).not.toBeNull()
    expect(zip.file('[Content_Types].xml')!.asText()).toContain(
      'Extension="png" ContentType="image/png"',
    )
  })
  it('寬圖、高圖等比例縮放且不超出範本格子', () => {
    expect(fitPhoto(2000, 1000, 100, 100)).toEqual({ width: 100, height: 50 })
    expect(fitPhoto(1000, 2000, 100, 100)).toEqual({ width: 50, height: 100 })
    const block = readPhotoBlock(template)!
    expect(block.cells[0]!.height).toBe((4300 - 300) * 635)
    const xml = xmlOf(renderPhotoDocx(template, mockPhotoFields, mockPhotoDraft(2)))
    const imageParagraphs = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)]
      .map((m) => m[0])
      .filter((p) => p.includes('<wp:inline'))
    expect(imageParagraphs).toHaveLength(2)
    for (const p of imageParagraphs) expect(p).toContain('<w:jc w:val="center"/>')
    const sizes = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)]
    for (let i = 0; i < sizes.length; i++) {
      const width = Number(sizes[i]![1]),
        height = Number(sizes[i]![2])
      expect(width).toBeLessThanOrEqual(block.cells[i]!.width)
      expect(height).toBeLessThanOrEqual(block.cells[i]!.height)
      expect(width / height).toBeCloseTo(i ? 0.5 : 2, 5)
    }
    expect(Number(sizes[1]![2])).toBe((4300 - 300) * 635)
  })
  it.each([
    ['w:before="100" w:after="200" w:line="480"', 800, 300],
    ['w:before="100" w:after="200" w:line="700" w:lineRule="exact"', 700, 300],
    ['w:before="100" w:after="200" w:line="200" w:lineRule="atLeast"', 480, 300],
    ['', 480, 240],
  ])('圖片高度扣除行高、段距與上下邊界：%s', (spacing, line, paragraphSpace) => {
    const modified = changeXml((xml) =>
      xml
        .replace(
          /<w:p><w:pPr><w:spacing w:before="0" w:after="0"\/><w:jc w:val="center"\/>[\s\S]*?<\/w:p>/g,
          (p) =>
            p
              .replace(
                '<w:spacing w:before="0" w:after="0"/>',
                spacing ? `<w:spacing ${spacing}/>` : '',
              )
              .replace('<w:sz w:val="20"/>', '<w:sz w:val="40"/>'),
        )
        .replaceAll('<w:tcMar>', '<w:tcMar><w:top w:w="80"/><w:bottom w:w="90"/>'),
    )
    const block = readPhotoBlock(modified)!
    expect(block.cells[0]!.height).toBe((4300 - 80 - 90 - line - paragraphSpace) * 635)
  })
  it('兩個範本的照片以 id 隔離，未選照片範本輸出 0 頁', () => {
    const a = mockPhotoDraft(2),
      b = mockPhotoDraft(5)
    b.common.photographer = 'Mock 第二份'
    const drafts = { a, b }
    const aXml = xmlOf(renderTemplatePhotos('a', template, mockPhotoFields, drafts))
    const bXml = xmlOf(renderTemplatePhotos('b', template, mockPhotoFields, drafts))
    expect(aXml.match(/<wp:inline/g)).toHaveLength(2)
    expect(bXml.match(/<wp:inline/g)).toHaveLength(5)
    expect(text(aXml)).not.toContain('Mock 第二份')
    expect(text(bXml)).toContain('Mock 第二份')
    expect(xmlOf(renderTemplatePhotos('c', template, mockPhotoFields, drafts))).not.toContain(
      '<w:tbl>',
    )
  })
  it('限制圖片 MIME、魔數、大小與張數', () => {
    const png = mockPhotoDraft(1).photos[0]!.bytes
    expect(() => checkPhotoBytes(png, 'image/png')).not.toThrow()
    expect(() => checkPhotoBytes(png, 'image/jpeg')).toThrow('PNG / JPEG')
    expect(() => checkPhotoBytes(new Uint8Array([255, 216, 255]), 'image/jpeg')).not.toThrow()
    expect(() => checkPhotoBytes(new Uint8Array(maxPhotoBytes + 1), 'image/png')).toThrow('10 MB')
    expect(() => checkPhotoBytes(new TextEncoder().encode('<svg/>'), 'image/svg+xml')).toThrow(
      'PNG / JPEG',
    )
    expect(() => renderPhotoDocx(template, {}, mockPhotoDraft(31))).toThrow('30 張')
  })
  it.each([
    ['缺頁結尾', (x: string) => x.replace('{{/照片頁}}', ''), '照片頁缺少結尾'],
    ['缺格結尾', (x: string) => x.replace('{{/照片格}}', ''), '不能巢狀'],
    ['格在頁外', (x: string) => x.replace('{{#照片頁}}', ''), '必須放在照片頁內'],
    [
      '只有頁結尾',
      (x: string) =>
        x
          .replace('{{#照片頁}}', '')
          .replace(
            /\{\{[#/]照片格\}\}|\{\{(?:照片|照片編號|攝影時間|攝影地點|攝影人|照片說明)\}\}/g,
            '',
          ),
      '沒有對應',
    ],
    [
      '空照片頁',
      (x: string) =>
        x.replace(
          /\{\{[#/]照片格\}\}|\{\{(?:照片|照片編號|攝影時間|攝影地點|攝影人|照片說明)\}\}/g,
          '',
        ),
      '至少需要',
    ],
    ['巢狀頁', (x: string) => x.replace('{{#照片格}}', '{{#照片頁}}'), '只能有一個'],
    ['巢狀格', (x: string) => x.replace('{{照片}}', '{{#照片格}}'), '不能巢狀'],
    ['只有格結尾', (x: string) => x.replace('{{#照片格}}', ''), '必須放在照片格內'],
    [
      '重複照片頁',
      (x: string) => x.replace('</w:body>', paragraph(run('', '{{#照片頁}}')) + '</w:body>'),
      '只能有一個',
    ],
  ])('%s：上傳擋下並回報標記與段落位置', (_, change, expected) => {
    expect(() => listPlaceholders(changeXml(change))).toThrow(expected)
    expect(() => listPlaceholders(changeXml(change))).toThrow(/第 \d+ 個標記，第 \d+ 段：「.+」/)
  })
  it('Word 拆分標記的 runs 仍可解析，頁首照片標記會被拒絕', () => {
    const split = changeXml((x) => x.replace('{{#照片頁}}', '{{#照片</w:t></w:r><w:r><w:t>頁}}'))
    expect(readPhotoBlock(split)?.photoCellsPerPage).toBe(2)
    expect(renderPhotoDocx(split, {}, mockPhotoDraft(2))).toBeInstanceOf(Uint8Array)
    const header = buildDocx({
      document: wordDocument('<w:p/>'),
      header: wordHeader(paragraph(run('', '{{#照片頁}}'))),
    })
    expect(() => listPlaceholders(header)).toThrow('頁首或頁尾')
    expect(parsePhotoBlock(wordDocument('<w:p/>'))).toBeNull()
  })
})

describe('Mock 送達證書黏貼單', () => {
  const delivery = new Uint8Array(
    readFileSync(
      new URL('../../public/templates/delivery-certificate-photos-template.docx', import.meta.url),
    ),
  )
  const title = 'Mock 送達證書黏貼單'

  it('可逐位元組重建、只含內部關聯，且只列出應受送達人', () => {
    const rebuilt = buildDeliveryPhotoTemplate()
    expect(Buffer.compare(delivery, rebuilt)).toBe(0)
    const parts = readSafeZip(delivery, docxZipLimits)
    for (const [name, content] of parts) {
      if (name.endsWith('.rels')) {
        expect(new TextDecoder().decode(content)).not.toMatch(/TargetMode\s*=\s*["']External/i)
      }
    }
    expect(listPlaceholders(delivery)).toEqual(['應受送達人'])
  })

  it('A4 直式單欄表格以標題段落起始，兩個照片格各占一列', () => {
    const xml = xmlOf(delivery)
    const block = parsePhotoBlock(xml)!
    expect(readPhotoBlock(delivery)?.photoCellsPerPage).toBe(2)
    expect(xml).toContain('<w:pgSz w:w="11906" w:h="16838" w:orient="portrait"/>')
    expect(xml).toContain('<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1418"')
    expect(xml).toContain('<w:tblW w:w="9490" w:type="dxa"/>')
    expect(xml.match(/<w:gridCol w:w="9490"\/>/g)).toHaveLength(1)
    expect(xml).toContain('<w:tblLayout w:type="fixed"/>')
    expect(xml.match(/<w:tbl>/g)).toHaveLength(1)
    expect(xml).toContain('<w:trHeight w:val="770" w:hRule="exact"/>')
    expect(xml).toContain('<w:trHeight w:val="513"')
    const heading = xml.slice(block.contentStart, xml.indexOf('<w:tbl>'))
    expect(text(heading)).toBe(title)
    expect(heading).toContain('<w:outlineLvl w:val="0"/>')
    expect(block.cells.map(({ width, height }) => [width, height])).toEqual(
      [6627, 6175].map((rowHeight) => [(9490 - 56) * 635, (rowHeight - 800) * 635]),
    )
    for (const cell of block.cells) {
      const row = xml.slice(cell.start, cell.end)
      expect(row.match(/<w:tr>/g)).toHaveLength(1)
      expect(row).toContain('<w:tcW w:w="9490" w:type="dxa"/>')
      expect(row).toContain('<w:vAlign w:val="center"/>')
      expect([...row.matchAll(/<w:p>[\s\S]*?<\/w:p>/g)].map((match) => text(match[0]))).toEqual([
        '{{#照片格}}編號{{照片編號}}',
        '{{照片}}',
        '{{照片說明}}{{/照片格}}',
      ])
      expect(xml.slice(cell.imageStart, cell.imageEnd)).toContain('<w:jc w:val="center"/>')
    }
  })

  it.each([
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 2],
    [5, 3],
  ])('%i 張 → %i 頁，保留表頭、跳脫值並通過 ZIP 檢查', (count, pages) => {
    const draft = mockPhotoDraft(count)
    if (count >= 2) {
      // 12 × 24 JPEG with two solid color bands.
      draft.photos[1] = {
        ...draft.photos[1]!,
        mime: 'image/jpeg',
        width: 12,
        height: 24,
        bytes: Buffer.from(
          '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAYAAwDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAQG/8QAGBABAAMBAAAAAAAAAAAAAAAAABVjouH/xAAWAQEBAQAAAAAAAAAAAAAAAAAFAgP/xAAXEQEAAwAAAAAAAAAAAAAAAAAAAhES/9oADAMBAAIRAxEAPwDGC2Ptz0j7c9NWExJaAlu//9k=',
          'base64',
        ),
      }
    }
    const recipient = 'Mock <收件人> & 測試'
    const output = renderPhotoDocx(delivery, { 應受送達人: recipient }, draft)
    const parts = readSafeZip(output, docxZipLimits)
    const xml = xmlOf(output)
    const tables = [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map((match) => match[0])
    expect(tables).toHaveLength(pages)
    expect(xml.match(/<w:pageBreakBefore\/>/g) ?? []).toHaveLength(Math.max(0, pages - 1))
    expect(xml.match(/<wp:inline\b/g) ?? []).toHaveLength(count)
    expect(xml).not.toMatch(/\{\{[#/]照片[頁格]\}\}|\{\{應受送達人\}\}/)
    expect([...parts.keys()].filter((name) => name.startsWith('word/media/'))).toHaveLength(count)
    for (const table of tables) {
      expect(text(table)).toContain(title + '應受送達人：' + recipient)
      expect(table).toContain('Mock &lt;收件人&gt; &amp; 測試')
      expect(table.match(/<w:tr>/g)).toHaveLength(4)
    }
    for (const photo of draft.photos) expect(text(xml)).toContain(photo.description)
    if (count >= 1) {
      expect(parts.has('word/media/photo-1.png')).toBe(true)
      expect(xml).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;')
    }
    if (count >= 2) expect(parts.has('word/media/photo-2.jpeg')).toBe(true)
    if (count % 2) {
      const lastRow = [...tables.at(-1)!.matchAll(/<w:tr>[\s\S]*?<\/w:tr>/g)].at(-1)![0]
      expect(text(lastRow)).toBe('編號')
      expect(lastRow).toContain('<w:trHeight w:val="6175"')
      expect(lastRow).not.toMatch(/<wp:inline|\{\{/)
    }
    if (count === 0) expect(text(xml)).toBe('')
  })
})
