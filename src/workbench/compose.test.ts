import { describe, expect, it } from 'vitest'
import type { CaseCategory, CategoryModule } from '@/types/domain'
import { composeSteps } from './compose'
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
