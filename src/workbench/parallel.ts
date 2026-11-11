import type { CategoryStep } from '@/types/domain'

/** Input is the final composition, including the saved combination order. */
export function parallelSteps(steps: readonly CategoryStep[]): CategoryStep[] {
  const seen = new Set<string>()
  return steps.filter((step) => {
    if (step.canRunInParallel !== true || seen.has(step.id)) return false
    seen.add(step.id)
    return true
  })
}
