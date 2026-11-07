import { describe, expect, it } from 'vitest'
import PizZip from 'pizzip'
import JSZip from 'jszip'
import type { CaseCategory } from '@/types/domain'
import { composeSteps } from './compose'
import { checkedTemplates } from './overview'
import {
  generationContexts,
  sharedFieldNames,
  localFieldNames,
  scopeKey,
  contextValues,
  filledContext,
  missingContextFields,
} from './stepFields'
import { renderDocx, zipGeneratedFiles } from '@/services/docxTemplates'
import { buildDocx, kaiBoldRPr, paragraph, run, wordDocument } from '../../shared/docxFixture'

function fixture() {
  const category: CaseCategory = {
    id: 'c',
    name: 'Mock',
    summary: '',
    updatedAt: '',
    templateCount: 3,
    fields: [
      { id: 'x', key: 'X', name: 'Shared X', type: 'text' },
      { id: 'unused', key: 'Z', type: 'text' },
    ],
    steps: [
      { id: 'basic', body: 'Basic', templateIds: ['basic'] },
      { id: 'd', body: 'D', templateIds: ['same'] },
      { id: 'f', body: 'F', templateIds: ['same', 'other'] },
    ],
    baseSteps: [{ stepId: 'basic', sortOrder: 0 }],
    modules: [
      { id: 'm', categoryId: 'c', name: 'M', sortOrder: 0, steps: [{ stepId: 'd', sortOrder: 0 }] },
      { id: 'n', categoryId: 'c', name: 'N', sortOrder: 1, steps: [{ stepId: 'f', sortOrder: 0 }] },
    ],
  }
  const library = [
    { id: 'basic', fileName: 'basic.docx', placeholders: ['X', '未映射', '姓名', '日期'] },
    {
      id: 'same',
      fileName: 'same.docx',
      placeholders: ['X', 'Y', '未映射', '年', '月', '日', '日期_民國'],
    },
    { id: 'other', fileName: 'other.docx', placeholders: ['Z'] },
  ]
  const contexts = (selected = ['m', 'n'], temporary: string[] = []) =>
    generationContexts(composeSteps(category, selected), temporary, (id) =>
      library.find((t) => t.id === id),
    )
  return { category, library, contexts }
}

describe('explicit sharing and stable step contexts', () => {
  it('shares exact basic category mappings; isolates same-name undeclared tags, even in base steps', () => {
    const { category, contexts } = fixture()
    const all = contexts()
    const shared = sharedFieldNames(category, all)
    expect(shared).toEqual(['姓名', '日期', 'X'])
    expect(
      localFieldNames(
        all.filter((c) => c.stepId === 'd'),
        shared,
      ),
    ).toEqual(['Y', '未映射'])
    expect(
      localFieldNames(
        all.filter((c) => c.stepId === 'f'),
        shared,
      ),
    ).toEqual(['Y', '未映射', 'Z'])
    const scoped = Object.fromEntries(
      all.map((c) => [scopeKey(c), { Y: c.stepId!, 未映射: c.stepId!, Z: 'only-f' }]),
    )
    const values = { X: 'common', 姓名: 'Mock', 日期: '115/11/7' }
    for (const c of all.filter((item) => item.placeholders.includes('X'))) {
      expect(contextValues(c, shared, values, scoped)).toMatchObject({ X: 'common' })
      expect(contextValues(c, shared, values, scoped)['未映射']).toBe(c.stepId)
    }
    category.steps.push({ id: 'basic2', body: 'Basic2', templateIds: ['basic'] })
    category.baseSteps!.push({ stepId: 'basic2', sortOrder: 1 })
    expect(
      new Set(
        contexts()
          .filter((c) => c.templateId === 'basic')
          .map(scopeKey),
      ).size,
    ).toBe(2)
  })

  it('deduplicates scanned step tags and gives explicit base sharing priority over stale local values', () => {
    const { category, contexts } = fixture()
    const all = contexts()
    const shared = sharedFieldNames(category, all)
    const f = all.find((context) => context.stepId === 'f')!
    expect(localFieldNames([f, f], shared)).toEqual(['Y', '未映射'])
    const scoped = { [scopeKey(f)]: { X: 'stale local X', Y: 'local Y' } }
    expect(contextValues(f, shared, { X: 'base X', Y: 'stray global Y' }, scoped)).toMatchObject({
      X: 'base X',
      Y: 'local Y',
    })
  })

  it('omits unselected modules from fields, validation and generation; selection is per context', () => {
    const { category, contexts } = fixture()
    const onlyM = contexts(['m'])
    const shared = sharedFieldNames(category, onlyM)
    const scoped = Object.fromEntries(onlyM.map((c) => [scopeKey(c), { Y: 'd', 未映射: 'local' }]))
    expect(onlyM.map((c) => c.stepId)).toEqual(['basic', 'd'])
    expect(localFieldNames(onlyM, shared)).not.toContain('Z')
    expect(
      missingContextFields(onlyM, shared, { X: 'x', 姓名: 'name', 日期: '115/11/7' }, scoped),
    ).toEqual([])
    const all = contexts()
    const d = all.find((c) => c.stepId === 'd')!
    const selected = checkedTemplates(all, { [d.id]: true })
    expect(selected.some((c) => c.stepId === 'f' && c.templateId === 'same')).toBe(true)
    expect(selected).not.toContain(d)
  })

  it('retains values after cross-source reordering and renders repeated templates with correct dates, format and ZIP names', async () => {
    const { category, contexts } = fixture()
    const all = contexts()
    const shared = sharedFieldNames(category, all)
    const scoped = Object.fromEntries(
      all.map((c) => [scopeKey(c), { Y: c.stepId!, 未映射: c.stepId!, Z: 'z' }]),
    )
    category.combinationOrders = [{ moduleIds: ['m', 'n'], stepIds: ['f', 'basic', 'd'] }]
    const ordered = contexts()
    expect(ordered.map((c) => c.stepId)).toEqual(['f', 'f', 'basic', 'd'])
    const source = buildDocx({
      document: wordDocument(
        paragraph(run(kaiBoldRPr, '{{X}}/{{Y}}/{{日期}}/{{日期_民國}}/{{年}}/{{月}}/{{日}}')),
      ),
    })
    const repeated = ordered.filter((c) => c.templateId === 'same')
    const files = repeated.map((c) => {
      const fields = filledContext(c, shared, { X: 'shared', 日期: '115/11/7' }, scoped)!
      // Include the canonical date tag too; manual derived tags still resolve from 日期.
      const data = renderDocx(source, fields)
      const xml = new PizZip(data).file('word/document.xml')!.asText()
      expect(xml).toContain(`shared/${c.stepId}/115年11月7日/115/11/7/115/11/7`)
      expect(xml).toContain('<w:b')
      return { name: 'same.docx', data }
    })
    const zip = await JSZip.loadAsync(await (await zipGeneratedFiles(files)).arrayBuffer())
    expect(Object.keys(zip.files)).toEqual(['same.docx', 'same-2.docx'])
    expect(
      new PizZip(await zip.file('same.docx')!.async('uint8array'))
        .file('word/document.xml')!
        .asText(),
    ).toContain('shared/f/')
    expect(
      new PizZip(await zip.file('same-2.docx')!.async('uint8array'))
        .file('word/document.xml')!
        .asText(),
    ).toContain('shared/d/')
  })

  it('keeps temporary templates in their own context and validates invalid dates', () => {
    const { category, contexts } = fixture()
    const all = contexts(['m'], ['other', 'other', 'same'])
    expect(all.filter((c) => c.stepId === null)).toHaveLength(1)
    const temporary = all.find((c) => c.stepId === null)!
    const shared = sharedFieldNames(category, all)
    expect(missingContextFields([temporary], shared, {}, {})).toEqual(['本次暫加：Z'])
    const basic = all[0]!
    expect(filledContext(basic, shared, { 日期: '115/2/30' }, {})).toBeNull()
  })
})
