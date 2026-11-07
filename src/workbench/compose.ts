import type { CaseCategory, CategoryStep, StepRef } from '@/types/domain'
const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const refOrder = (a: StepRef, b: StepRef) =>
  a.sortOrder - b.sortOrder || compareId(a.stepId, b.stepId)
export function composeSteps(category: CaseCategory, selected: readonly string[]): CategoryStep[] {
  const steps = new Map(category.steps.map((step) => [step.id, step]))
  const seen = new Set<string>()
  const result: CategoryStep[] = []
  const append = (refs: StepRef[]) => {
    for (const ref of [...refs].sort(refOrder)) {
      const step = steps.get(ref.stepId)
      if (!step || seen.has(step.id)) continue
      seen.add(step.id)
      result.push(step)
    }
  }
  append(category.baseSteps ?? [])
  for (const module of [...(category.modules ?? [])]
    .filter((m) => m.categoryId === category.id && selected.includes(m.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || compareId(a.id, b.id)))
    append(module.steps)
  return result
}
