import PizZip from 'pizzip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyRocDateFields, defaultRocDateSlash } from '@/utils/rocDate'
import { initialDraftValues } from '@/workbench/draft'
import { inputFields, manualFieldsFromPlaceholders } from '@/workbench/overview'
import { listPlaceholders, renderDocx } from './docxTemplates'
import { docxZipLimits, normalizeDocx, splitFormatNotice } from '../../server/src/docxXml'
import {
  buildDocx,
  differentRPr,
  kaiBoldRPr,
  paragraph,
  run,
  wordDocument,
  wordFooter,
  wordHeader,
} from '../../shared/docxFixture'

const runPattern = /<w:r(?=[\s>])[^>]*>[\s\S]*?<\/w:r>/g

function partText(data: Uint8Array, name: string): string {
  return new PizZip(data).file(name)?.asText() ?? ''
}

function plainText(xml: string): string {
  return [...xml.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((match) => match[1] ?? '').join('')
}

function runContaining(xml: string, text: string): string {
  const found = [...xml.matchAll(runPattern)].find((match) => match[0].includes(`>${text}</w:t>`))
  return found?.[0] ?? ''
}

describe('日期欄位與格式', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('沒有改日期時，年、月、日、日期都是台北今天', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-28T16:30:00.000Z'))
    expect(new Date().getUTCDate()).toBe(28)
    expect(defaultRocDateSlash()).toBe('115/10/29')

    const values = initialDraftValues()
    expect(values).toEqual({ 日期: '115/10/29' })
    const filled = applyRocDateFields(values)
    expect(filled).toMatchObject({
      年: '115',
      月: '10',
      日: '29',
      日期: '115年10月29日',
      日期_民國: '115/10/29',
    })

    const source = buildDocx({
      document: wordDocument(
        [
          paragraph(run('', '{{年}}')),
          paragraph(run('', '{{月}}')),
          paragraph(run('', '{{日}}')),
          paragraph(run('', '{{日期}}')),
          paragraph(run('', '{{年}}年{{月}}月{{日}}日（{{日期}}、{{日期_民國}}）')),
        ].join(''),
      ),
    })
    const xml = partText(renderDocx(source, filled!), 'word/document.xml')
    const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map((match) =>
      plainText(match[1] ?? ''),
    )
    expect(paragraphs).toEqual([
      '115',
      '10',
      '29',
      '115年10月29日',
      '115年10月29日（115年10月29日、115/10/29）',
    ])
  })

  it('{{年}} 沿用標楷體 16pt 粗體，不改表格', () => {
    const body = `<w:tbl><w:tr><w:tc><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${run(kaiBoldRPr, '{{年}}')}</w:p></w:tc></w:tr></w:tbl>`
    const source = buildDocx({ document: wordDocument(body) })
    const before = partText(source, 'word/document.xml')
    const xml = partText(renderDocx(source, { 年: '115' }), 'word/document.xml')
    const filled = runContaining(xml, '115')
    expect(filled).toContain('w:eastAsia="標楷體"')
    expect(filled).toContain('<w:sz w:val="32"/>')
    expect(filled).toContain('<w:b/>')
    expect(filled).toContain('<w:i/>')
    expect(filled).toContain('<w:u w:val="single"/>')
    expect(filled).toContain('w:val="1F4E79"')
    expect(xml.match(/<w:tbl\b/g)).toHaveLength(before.match(/<w:tbl\b/g)?.length ?? 0)
    expect(xml.match(/<w:tr\b/g)).toHaveLength(1)
    expect(xml.match(/<w:tc\b/g)).toHaveLength(1)
    expect(xml).toContain('<w:jc w:val="center"/>')
  })

  it('三個 run 且格式不同時，產生文件沿用第一個字的格式', () => {
    const split = paragraph(
      [
        run(kaiBoldRPr, '{{'),
        '<w:proofErr w:type="spellStart"/>',
        run(kaiBoldRPr, '年'),
        '<w:bookmarkStart w:id="1" w:name="_Ref"/>',
        run(differentRPr, '}}'),
        '<w:bookmarkEnd w:id="1"/>',
      ].join(''),
    )
    const source = buildDocx({
      document: wordDocument(split),
      header: wordHeader(paragraph(run(kaiBoldRPr, '{{地址}}'))),
      footer: wordFooter(paragraph(run('', '{{備註}}'))),
    })
    const rendered = partText(renderDocx(source, { 年: '115' }), 'word/document.xml')
    const filled = runContaining(rendered, '115')
    expect(filled).toContain('w:eastAsia="標楷體"')
    expect(filled).toContain('<w:sz w:val="32"/>')
    expect(filled).toContain('<w:b/>')
    expect(filled).not.toContain('新細明體')
    expect(rendered).toContain('w:proofErr')
    expect(rendered).toContain('w:bookmarkStart')
    expect(rendered.includes('<w:tbl')).toBe(false)
    expect(rendered.match(/<w:p\b/g)?.length).toBe(
      partText(source, 'word/document.xml').match(/<w:p\b/g)?.length,
    )
  })

  it('頁首頁尾的欄位會被找到，系統日期欄不進手動輸入', () => {
    const source = buildDocx({
      document: wordDocument(
        [
          paragraph(run('', '{{姓名}}{{年}}{{月}}{{日}}')),
          paragraph(run('', '{{日期}}')),
          paragraph(run('', '{{日期_民國}}')),
          paragraph(run('', '尾{{')),
          paragraph(run('', '假}}')),
        ].join(''),
      ),
      header: wordHeader(
        paragraph(
          [
            run(kaiBoldRPr, '{{'),
            '<w:proofErr w:type="spellStart"/>',
            run(differentRPr, '地址}}'),
          ].join(''),
        ),
      ),
      footer: wordFooter(paragraph(run('', '{{備註}}{{日}}'))),
    })
    expect(listPlaceholders(source)).toEqual([
      '姓名',
      '年',
      '月',
      '日',
      '日期',
      '日期_民國',
      '地址',
      '備註',
    ])
    const fields = inputFields([{ placeholders: listPlaceholders(source) }])
    expect(fields).toEqual(['姓名', '日期', '地址', '備註'])
    expect(fields).not.toContain('年')
    expect(fields).not.toContain('月')
    expect(fields).not.toContain('日')
    expect(fields).not.toContain('日期_民國')
    expect(fields).not.toContain('假')
    expect(manualFieldsFromPlaceholders(listPlaceholders(source), ['姓名', '日期'])).toEqual([
      '姓名',
      '日期',
      '地址',
      '備註',
    ])

    const normalized = normalizeDocx(source, docxZipLimits)
    expect(normalized.notices).toEqual(['地址'])
    const header = partText(normalized.data, 'word/header1.xml')
    const merged = runContaining(header, '{{地址}}')
    expect(merged).toContain('w:eastAsia="標楷體"')
    expect(merged).not.toContain('新細明體')
    expect(header).toContain('w:proofErr')
    expect(splitFormatNotice(normalized.notices)).toBe(
      '這些欄位在 Word 裡被拆成不同格式，已沿用第一個字的格式：地址。',
    )
  })
})
