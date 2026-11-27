import type { CategoryStep } from '@/types/domain'
import { isDerivedDateTag } from '@/utils/rocDate'
import { inputFields } from './overview'
import type { GenerationContext } from './stepFields'

export interface FieldOwner {
  owner: string
  sharedIn: string[]
  source: 'base' | 'module'
}

export type FieldOwnership = Readonly<Partial<Record<string, FieldOwner>>>

export function fieldOwnership(
  visibleSteps: readonly Pick<CategoryStep, 'id'>[],
  contexts: readonly GenerationContext[],
  sharedFieldNames: readonly string[],
): FieldOwnership {
  const owners: Partial<Record<string, FieldOwner>> = Object.create(null)
  for (const name of sharedFieldNames) {
    if (name === '日期' || isDerivedDateTag(name)) continue
    owners[name] = { owner: 'base', sharedIn: [], source: 'base' }
  }
  for (const id of new Set(visibleSteps.map((step) => step.id))) {
    for (const name of inputFields(contexts.filter((context) => context.stepId === id))) {
      if (name === '日期') continue
      const existing = owners[name]
      if (existing) existing.sharedIn.push(id)
      else owners[name] = { owner: id, sharedIn: [], source: 'module' }
    }
  }
  return owners
}
