import { expect, it } from 'vitest'
import type { OverviewTemplate } from './overview'
import { fieldUsage } from './fieldUsage'

it('reports each tag by base definition and template placement, and keeps similar names separate', () => {
  const templates: OverviewTemplate[] = [
    { id: 'mock', fileName: 'Mock.docx', placeholders: ['姓名', '姓名', '地址'] },
    { id: 'other', fileName: 'Other.docx', placeholders: ['姓名', '員警姓名', '案發地址'] },
    { id: 'pdf', kind: 'pdf', fileName: 'Mock.pdf', placeholders: ['PDF'] },
  ]
  const usage = fieldUsage(
    {
      steps: [
        { id: 'base', body: '基本步驟', templateIds: ['mock', 'mock', 'pdf'] },
        { id: 'step', title: '模組步驟', body: 'Mock', templateIds: ['other', 'mock', 'missing'] },
        { id: 'unreferenced', body: '未引用', templateIds: ['mock'] },
      ],
      baseSteps: [{ stepId: 'base', sortOrder: 0 }],
      modules: [
        {
          id: 'm',
          name: 'Mock 模組',
          categoryId: 'c',
          sortOrder: 0,
          steps: [{ stepId: 'step', sortOrder: 0 }],
        },
      ],
    },
    ['姓名'],
    (id) => templates.find((template) => template.id === id),
  )
  expect(usage.fields).toEqual([
    {
      tag: '姓名',
      locations: [
        '基本 SOP',
        '基本 SOP－基本步驟－Mock.docx',
        'Mock 模組－模組步驟－Other.docx',
        'Mock 模組－模組步驟－Mock.docx',
      ],
      count: 4,
      shared: true,
    },
    {
      tag: '地址',
      locations: ['基本 SOP－基本步驟－Mock.docx', 'Mock 模組－模組步驟－Mock.docx'],
      count: 2,
      shared: true,
    },
    {
      tag: '員警姓名',
      locations: ['Mock 模組－模組步驟－Other.docx'],
      count: 1,
      shared: false,
    },
    {
      tag: '案發地址',
      locations: ['Mock 模組－模組步驟－Other.docx'],
      count: 1,
      shared: false,
    },
  ])
  expect(usage.possibleDuplicates).toEqual([
    ['姓名', '員警姓名'],
    ['地址', '案發地址'],
  ])
})

it('lists date family tags without comparing them for possible duplicates', () => {
  const tags = ['日期', '日期_民國', '年', '月', '日', '案發日期', '案發日期_民國', '年齡', '月份']
  const usage = fieldUsage({ steps: [] }, tags, () => undefined)

  expect(usage.fields.map(({ tag }) => tag)).toEqual(tags)
  expect(usage.possibleDuplicates).toEqual([['案發日期', '案發日期_民國']])
})
