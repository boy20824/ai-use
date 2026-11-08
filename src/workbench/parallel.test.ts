import { describe, expect, it } from 'vitest'
import type { CaseCategory } from '@/types/domain'
import { composeSteps } from './compose'
import { parallelSteps, retainStepValues } from './parallel'

const refs = (ids: string) => [...ids].map((stepId, sortOrder) => ({ stepId, sortOrder }))
const category: CaseCategory = {
  id: 'mock',
  name: 'Mock',
  summary: '',
  updatedAt: '',
  templateCount: 0,
  steps: [...'ABCDJ'].map((id) => ({
    id,
    body: id,
    templateIds: [],
    canRunInParallel: 'DJ'.includes(id),
  })),
  baseSteps: refs('ABC'),
  modules: [
    { id: 'alcohol', categoryId: 'mock', name: '酒駕', sortOrder: 0, steps: refs('D') },
    { id: 'arrest', categoryId: 'mock', name: '現行犯', sortOrder: 1, steps: refs('DJ') },
  ],
  combinationOrders: [
    { moduleIds: ['alcohol', 'arrest'], stepIds: [...'ADB CJ'.replace(' ', '')] },
  ],
}

describe('parallel work from final composition (acceptance 1–4)', () => {
  it.each([
    [
      ['alcohol', 'arrest'],
      ['D', 'J'],
    ],
    [
      ['arrest', 'alcohol'],
      ['D', 'J'],
    ],
    [['alcohol'], ['D']],
    [[], []],
  ])('filters selected modules with stable saved ordering: %j', (selected, expected) => {
    expect(parallelSteps(composeSteps(category, selected)).map((step) => step.id)).toEqual(expected)
  })
  it('deduplicates by ID rather than title, retaining the first parallel occurrence', () => {
    const d = category.steps.find((step) => step.id === 'D')!
    const j = { ...d, id: 'J' }
    expect(parallelSteps([d, j, { ...d }])).toEqual([d, j])
    const reversed = {
      ...category,
      combinationOrders: [{ moduleIds: ['alcohol', 'arrest'], stepIds: [...'JADBC'] }],
    }
    expect(parallelSteps(composeSteps(reversed, ['alcohol', 'arrest'])).map((s) => s.id)).toEqual([
      'J',
      'D',
    ])
  })
})
it('removes only exited step scopes, preserving active and temporary scopes (acceptance 8)', () => {
  const values = {
    '["step","D"]': { X: 'D' },
    '["step","J"]': { X: 'J' },
    '["temporary","file"]': { X: 'temporary' },
  }
  const retained = retainStepValues(values, composeSteps(category, ['alcohol']))
  expect(retained).toEqual({
    '["step","D"]': { X: 'D' },
    '["temporary","file"]': { X: 'temporary' },
  })
  expect(retainStepValues(retained, composeSteps(category, ['alcohol', 'arrest']))).toEqual(
    retained,
  )
  expect(values['["step","J"]']).toEqual({ X: 'J' })
})
