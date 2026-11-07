import { describe, expect, it } from 'vitest'
import type { CaseCategory, CategoryModule } from '@/types/domain'
import { composeSteps, resolveCombination } from './compose'
const refs = (ids: string) => [...ids].map((stepId, sortOrder) => ({ stepId, sortOrder }))
const module = (id: string, sortOrder: number, ids: string): CategoryModule => ({
  id,
  categoryId: 'mock',
  name: id,
  sortOrder,
  steps: refs(ids),
})
const category: CaseCategory = {
  id: 'mock',
  name: 'Mock',
  summary: '',
  updatedAt: '',
  templateCount: 0,
  steps: [...'ABCDFGJX'].map((id) => ({ id, body: id === 'X' ? 'J' : id, templateIds: [] })),
  baseSteps: refs('ABC'),
  modules: [module('alcohol', 0, 'D'), module('drug', 1, 'FG'), module('arrest', 2, 'J')],
}
const compose = (selected: string[], config = category) =>
  composeSteps(config, selected)
    .map((s) => s.id)
    .join('')
describe('base SOP and module union', () => {
  it.each([
    [['alcohol', 'arrest'], 'ABCDJ'],
    [['drug', 'arrest'], 'ABCFGJ'],
    [[], 'ABC'],
  ])('%j => %s', (selected, expected) => {
    expect(compose(selected as string[])).toBe(expected)
  })
  it('dedupes shared J and a base ID, keeping distinct IDs with the same name', () => {
    expect(
      compose(['one', 'two'], {
        ...category,
        modules: [module('one', 0, 'AJ'), module('two', 1, 'JX')],
      }),
    ).toBe('ABCJX')
  })
  it('ignores click order, uses stable IDs for tied sort orders, and ignores cross-category modules', () => {
    const config = {
      ...category,
      baseSteps: [...refs('CBA')].map((r) => ({ ...r, sortOrder: 1 })),
      modules: [
        module('b', 1, 'JG'),
        module('a', 1, 'FD'),
        { ...module('foreign', 0, 'X'), categoryId: 'other' },
      ],
    }
    config.modules[1]!.steps = refs('FD').map((r) => ({ ...r, sortOrder: 0 }))
    expect(compose(['b', 'foreign', 'a'], config)).toBe('ABCDFJG')
    expect(compose(['a', 'b'], config)).toBe('ABCDFJG')
  })
})

it('applies saved A/D/B/J/C on reload and reversed selection, isolates combinations and source orders', () => {
  const before = JSON.stringify(category)
  const config: CaseCategory = {
    ...category,
    combinationOrders: [
      { moduleIds: ['alcohol', 'arrest'], stepIds: [...'ADBJC'] },
      { moduleIds: [], stepIds: [...'CBA'] },
    ],
  }
  expect(compose(['alcohol', 'arrest'], config)).toBe('ADBJC')
  const reloaded = JSON.parse(JSON.stringify(config)) as CaseCategory
  expect(compose(['arrest', 'alcohol', 'arrest'], reloaded)).toBe('ADBJC')
  expect(compose(['alcohol'], reloaded)).toBe('ABCD')
  expect(compose(['drug', 'arrest'], reloaded)).toBe('ABCFGJ')
  expect(compose([], reloaded)).toBe('CBA')
  expect(JSON.stringify(category)).toBe(before)
  expect(reloaded.baseSteps).toEqual(category.baseSteps)
  expect(reloaded.modules).toEqual(category.modules)
})
it('ignores removed/deleted IDs, appends new steps in original merged order, and warns maintainers', () => {
  const config: CaseCategory = {
    ...category,
    combinationOrders: [{ moduleIds: ['alcohol', 'arrest'], stepIds: [...'ADBJC'] }],
  }
  expect(resolveCombination(config, ['arrest', 'alcohol']).stale).toBe(false)
  config.steps = category.steps.filter((s) => s.id !== 'D')
  config.baseSteps = refs('ABCF')
  config.modules = [module('alcohol', 0, 'DG'), module('arrest', 1, 'J')]
  expect(compose(['arrest', 'alcohol'], config)).toBe('ABJCFG')
  expect(resolveCombination(config, ['arrest', 'alcohol']).stale).toBe(true)
  // An existing entity moved out of this combination is also ignored.
  config.baseSteps = refs('ACF')
  expect(compose(['arrest', 'alcohol'], config)).toBe('AJCFG')
})
