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
  sharedFieldLabels,
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
    builtinFields: { 姓名: false },
    fields: [{ id: 'manual', key: '承辦單位', type: 'text', scope: 'base' }],
    steps: [
      { id: 's1', body: '一', templateIds: [] },
      { id: 's2', body: '二', templateIds: ['a', 'extra'] },
      { id: 's3', body: '三', templateIds: [] },
      { id: 's4', body: '四', templateIds: [] },
      { id: 's5', body: '五', templateIds: ['b'], canRunInParallel: true },
      { id: 'hidden', body: '隱藏', templateIds: ['hidden'] },
    ],
    baseSteps: ['s1', 's2', 's3', 's4', 's5'].map((stepId, sortOrder) => ({ stepId, sortOrder })),
    modules: [
      {
        id: 'm',
        categoryId: 'c',
        name: 'Mock 模組',
        sortOrder: 0,
        steps: [{ stepId: 'hidden', sortOrder: 0 }],
      },
    ],
  }
  const library = [
    {
      id: 'a',
      fileName: 'a.docx',
      placeholders: ['被害人姓名', '案由', '案由', '日期_民國', '承辦單位'],
    },
    {
      id: 'extra',
      fileName: 'extra.docx',
      placeholders: ['案由', '姓名', '被害人姓名', '#照片頁', '@照片', '攝影人', '照片說明'],
    },
    { id: 'b', fileName: 'b.docx', placeholders: ['案由', '年', '月', '日'] },
    { id: 'hidden', fileName: 'hidden.docx', placeholders: ['隱藏必填'] },
    { id: 'temp', fileName: 'temp.docx', placeholders: ['案由'] },
  ]
  const steps = composeSteps(category, [])
  const contexts = generationContexts(steps, ['temp'], (id) => library.find((t) => t.id === id))
  return { category, library, steps, contexts }
}
const values = {
  日期: '115/11/11',
  案由: '詐欺（Mock）',
  被害人姓名: '王小明（Mock）',
  姓名: 'Mock',
  承辦單位: 'Mock 單位',
}

describe('step field placement acceptance', () => {
  it('shows only date and explicit manual base fields above; template victim/name fields stay in their step (1,4,5,6)', () => {
    const { category, contexts } = fixture()
    const base = sharedFieldNames(category)
    expect(base).toEqual(['日期', '承辦單位'])
    expect(
      localFieldNames(
        contexts.filter((c) => c.stepId === 's2'),
        base,
      ),
    ).toEqual(['被害人姓名', '案由', '姓名'])
    expect(
      localFieldNames(
        contexts.filter((c) => c.stepId === 's5'),
        base,
      ),
    ).toEqual(['案由'])
    expect(sharedFieldNames({ ...category, fields: [] })).toEqual(['日期'])
    category.fields!.push({ id: 'name', key: '姓名', type: 'text', scope: 'base' })
    expect(sharedFieldNames(category)).toContain('姓名')
    expect(localFieldNames(contexts, sharedFieldNames(category))).not.toContain('姓名')
  })
  it('restores the historical name above when enabled without duplicating it in steps', () => {
    const { category, contexts } = fixture()
    category.builtinFields = { 姓名: true }
    expect(sharedFieldNames(category)).toEqual(['姓名', '日期', '承辦單位'])
    expect(localFieldNames(contexts, sharedFieldNames(category))).not.toContain('姓名')
  })
  it('deduplicates tags in first appearance order and omits photo-specific markers (2)', () => {
    const { contexts } = fixture()
    expect(localFieldNames(contexts, ['日期', '承辦單位'])).toEqual(['被害人姓名', '案由', '姓名'])
  })
  it('labels only visible steps with current composition numbers and counts each step once (3,7)', () => {
    const { steps, contexts } = fixture()
    expect(sharedFieldLabels(steps, contexts)['案由']).toBe('共用：步驟 2、5')
    expect(sharedFieldLabels(steps, contexts)['被害人姓名']).toBeUndefined()
    const reversed = [...steps].reverse()
    expect(sharedFieldLabels(reversed, contexts)['案由']).toBe('共用：步驟 1、4')
  })
  it('shares exact same-name values across steps and temporary templates (3,9)', () => {
    const { contexts } = fixture()
    const draft = { ...values }
    for (const context of contexts.filter((c) => c.placeholders.includes('案由'))) {
      expect(contextValues(context, draft)['案由']).toBe('詐欺（Mock）')
    }
    draft['案由'] = '更新（Mock）'
    expect(
      contexts
        .filter((c) => c.placeholders.includes('案由'))
        .every((c) => contextValues(c, draft)['案由'] === '更新（Mock）'),
    ).toBe(true)
    expect(contextValues(contexts[0]!, draft)['被害人姓名']).toBe('王小明（Mock）')
  })
  it('omits unselected modules from validation and preserves per-document selection (7)', () => {
    const { contexts } = fixture()
    expect(contexts.map((c) => c.stepId)).not.toContain('hidden')
    expect(missingContextFields(contexts, values)).toEqual([])
    const selected = checkedTemplates(contexts, { [contexts[0]!.id]: true })
    expect(selected.some((c) => c.stepId === 's5')).toBe(true)
    expect(selected).not.toContain(contexts[0])
  })
  it('reports each missing key only once across templates and steps, including invalid dates (8)', () => {
    const { contexts } = fixture()
    expect(missingContextFields(contexts, { ...values, 案由: '' })).toEqual(['案由'])
    expect(missingContextFields(contexts, { ...values, 日期: '115/2/30' })).toEqual(['日期格式'])
    expect(filledContext(contexts[0]!, { ...values, 日期: '115/2/30' })).toBeNull()
  })
  it('renders both documents from shared mock data, retains styling and generates collision-safe ZIP entries (3,9)', async () => {
    const { contexts } = fixture()
    const source = buildDocx({
      document: wordDocument(
        paragraph(run(kaiBoldRPr, '{{案由}}/{{日期}}/{{日期_民國}}/{{年}}/{{月}}/{{日}}')),
      ),
    })
    const files = contexts
      .filter((c) => ['a', 'b'].includes(c.templateId))
      .map((context) => {
        const data = renderDocx(source, filledContext(context, values)!)
        const xml = new PizZip(data).file('word/document.xml')!.asText()
        expect(xml).toContain('詐欺（Mock）/115年11月11日/115/11/11/115/11/11')
        expect(xml).toContain('<w:b')
        return { name: 'Mock.docx', data }
      })
    const zip = await JSZip.loadAsync(await (await zipGeneratedFiles(files)).arrayBuffer())
    expect(Object.keys(zip.files)).toEqual(['Mock.docx', 'Mock-2.docx'])
    for (const file of Object.values(zip.files))
      expect(
        new PizZip(await file.async('uint8array')).file('word/document.xml')!.asText(),
      ).toContain('詐欺（Mock）')
  })
})

it('omits 案次編號 from base fields, context values and missing prompts', () => {
  const { category } = fixture()
  category.fields!.push({ id: 'old', key: '案次編號', type: 'text', scope: 'base' })
  expect(sharedFieldNames(category)).not.toContain('案次編號')
  const contexts = generationContexts(
    [{ id: 's', body: 'Mock', templateIds: ['photo'] }],
    [],
    () => ({ id: 'photo', fileName: 'Mock.docx', placeholders: ['案次編號'] }),
  )
  expect(missingContextFields(contexts, { 案次編號: '' })).toEqual([])
  expect(contextValues(contexts[0]!, { 案次編號: '舊值（Mock）' })).toEqual({})
})
