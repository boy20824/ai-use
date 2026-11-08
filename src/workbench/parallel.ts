import type { CategoryStep } from '@/types/domain'
import type { ScopedValues } from './stepFields'

/** Input is the final composition, including the saved combination order. */
export function parallelSteps(steps: readonly CategoryStep[]): CategoryStep[] {
  const seen = new Set<string>()
  return steps.filter((step) => {
    if (step.canRunInParallel !== true || seen.has(step.id)) return false
    seen.add(step.id)
    return true
  })
}

/** Keep temporary-document scopes; remove values for steps leaving the composition. */
export function retainStepValues(
  values: ScopedValues,
  steps: readonly CategoryStep[],
): ScopedValues {
  const active = new Set(steps.map((step) => JSON.stringify(['step', step.id])))
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => !key.startsWith('["step",') || active.has(key)),
  )
}
