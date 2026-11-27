import { expect, it } from 'vitest'
import type { CaseCategory } from '@/types/domain'
import { composeSteps } from './compose'
import { fieldOwnership } from './fieldOwnership'
import { filledContext, generationContexts, sharedFieldNames } from './stepFields'

const category: CaseCategory = {
  id: 'mock',
  name: 'Mock',
  summary: '',
  updatedAt: '',
  templateCount: 4,
  builtinFields: { 姓名: true },
  baseSteps: [],
  steps: [
    { id: 'D', body: 'Mock D', templateIds: ['d', 'another'] },
    { id: 'F', body: 'Mock F', templateIds: ['f'] },
    { id: 'G', body: 'Mock G', templateIds: ['g'] },
    { id: 'H', body: 'Mock H', templateIds: ['hidden'] },
  ],
  modules: ['D', 'F', 'G', 'H'].map((stepId, sortOrder) => ({
    id: `module-${stepId}`,
    name: `Mock ${stepId}`,
    categoryId: 'mock',
    sortOrder,
    steps: [{ stepId, sortOrder: 0 }],
  })),
}
const selected = ['module-D', 'module-F', 'module-G']
const dates = ['日期', '日期_民國', '年', '月', '日']
const templates = [
  { id: 'd', fileName: 'D.docx', placeholders: ['姓名', '車牌', '車牌', ...dates] },
  { id: 'another', fileName: 'Another.docx', placeholders: ['車牌'] },
  { id: 'f', fileName: 'F.docx', placeholders: ['姓名', '車牌', '年'] },
  { id: 'g', fileName: 'G.docx', placeholders: ['車牌'] },
  { id: 'hidden', fileName: 'Hidden.docx', placeholders: ['車牌', '隱藏欄位'] },
]
const lookup = (id: string) => templates.find((template) => template.id === id)

it('gives base fields priority and assigns the other tags by visible combination order', () => {
  const visible = composeSteps(category, selected)
  const contexts = generationContexts(category.steps, [], lookup).reverse()
  const ownership = fieldOwnership(visible, contexts, [...sharedFieldNames(category), ...dates])
  expect(ownership).toEqual({
    姓名: { owner: 'base', source: 'base', sharedIn: ['D', 'F'] },
    車牌: { owner: 'D', source: 'module', sharedIn: ['F', 'G'] },
  })
  expect(ownership['隱藏欄位']).toBeUndefined()
  expect(dates.every((name) => !Object.hasOwn(ownership, name))).toBe(true)
})

it('reassigns ownership on reorder without affecting existing values, date overrides or filled context', () => {
  const before = composeSteps(category, selected)
  const after = composeSteps(
    { ...category, combinationOrders: [{ moduleIds: selected, stepIds: ['F', 'D', 'G'] }] },
    selected,
  )
  const values = Object.freeze({
    姓名: '王小明',
    車牌: 'MOCK-123',
    日期: '115/11/27',
    隱藏欄位: 'Mock',
  })
  const overrides = Object.freeze({ F: '115/10/1' })
  const beforeContexts = generationContexts(before, [], lookup)
  const afterContexts = generationContexts(after, [], lookup)
  const base = sharedFieldNames(category)

  expect(fieldOwnership(before, beforeContexts, base)['車牌']?.owner).toBe('D')
  expect(fieldOwnership(after, afterContexts, base)['車牌']).toEqual({
    owner: 'F',
    source: 'module',
    sharedIn: ['D', 'G'],
  })
  for (const context of afterContexts) {
    const beforeContext = beforeContexts.find((item) => item.id === context.id)!
    expect(filledContext(context, values, overrides)).toEqual(
      filledContext(beforeContext, values, overrides),
    )
  }
  expect(filledContext(afterContexts[0]!, values, overrides)).toEqual({
    姓名: '王小明',
    車牌: 'MOCK-123',
    日期: '115年10月1日',
    日期_民國: '115/10/1',
    年: '115',
    月: '10',
    日: '1',
  })
  expect(filledContext(afterContexts[1]!, values, overrides)?.['日期_民國']).toBe('115/11/27')
  expect(values).toEqual({ 姓名: '王小明', 車牌: 'MOCK-123', 日期: '115/11/27', 隱藏欄位: 'Mock' })
  expect(overrides).toEqual({ F: '115/10/1' })
})
