import type { CaseCategory, CategoryStep } from '@/types/domain'
import { applyRocDateFields } from '@/utils/rocDate'
import {
  inputFields,
  missingOverviewFields,
  valuesForFields,
  type OverviewTemplate,
} from './overview'

export interface GenerationContext extends OverviewTemplate {
  templateId: string
  stepId: string | null
  stepTitle: string
  canRunInParallel: boolean
}
export const contextKey = (stepId: string | null, templateId: string) =>
  JSON.stringify([stepId, templateId])

export function generationContexts(
  steps: CategoryStep[],
  temporaryIds: string[],
  lookup: (id: string) => OverviewTemplate | undefined,
): GenerationContext[] {
  const linked = new Set(steps.flatMap((step) => step.templateIds))
  const result: GenerationContext[] = []
  const append = (step: CategoryStep | null, templateId: string) => {
    const template = lookup(templateId)
    if (!template) return
    result.push({
      ...template,
      id: contextKey(step?.id ?? null, templateId),
      templateId,
      stepId: step?.id ?? null,
      stepTitle: step?.title ?? step?.body ?? '本次暫加',
      canRunInParallel: step?.canRunInParallel === true,
    })
  }
  for (const step of steps) for (const id of new Set(step.templateIds)) append(step, id)
  for (const id of new Set(temporaryIds)) if (!linked.has(id)) append(null, id)
  return result
}

/** Standalone base definitions are shared independently of template usage.
 * Legacy definitions share only when used by the base SOP.
 * The built-in name/date mapping is the existing application contract.
 * Undeclared identical tags remain independent even between basic steps.
 */
export function sharedFieldNames(category: CaseCategory, contexts: GenerationContext[]): string[] {
  const baseIds = new Set(category.baseSteps?.map((ref) => ref.stepId) ?? [])
  const used = inputFields(
    contexts.filter((context) => context.stepId && baseIds.has(context.stepId)),
  )
  const declared = new Set(category.fields?.map((field) => field.key) ?? [])
  return [
    '姓名',
    '日期',
    ...new Set(
      [
        ...(category.fields ?? [])
          .filter((field) => field.scope === 'base')
          .map((field) => field.key),
        ...used.filter((key) => declared.has(key)),
      ].filter((key) => key !== '姓名' && key !== '日期'),
    ),
  ]
}
export const localFieldNames = (contexts: GenerationContext[], shared: string[]) =>
  inputFields(contexts).filter((key) => !shared.includes(key))
export const scopeKey = (context: GenerationContext) =>
  JSON.stringify(
    context.stepId === null ? ['temporary', context.templateId] : ['step', context.stepId],
  )
export type ScopedValues = Record<string, Record<string, string>>

export function contextValues(
  context: GenerationContext,
  shared: string[],
  values: Record<string, string>,
  scoped: ScopedValues,
): Record<string, string> {
  const local = scoped[scopeKey(context)] ?? {}
  return valuesForFields({ ...local, ...valuesForFields(values, shared) }, inputFields([context]))
}
export function missingContextFields(
  contexts: GenerationContext[],
  shared: string[],
  values: Record<string, string>,
  scoped: ScopedValues,
): string[] {
  return contexts.flatMap((context) =>
    missingOverviewFields(
      inputFields([context]),
      contextValues(context, shared, values, scoped),
    ).map((key) => `${context.stepTitle}：${key}`),
  )
}
export function filledContext(
  context: GenerationContext,
  shared: string[],
  values: Record<string, string>,
  scoped: ScopedValues,
) {
  return applyRocDateFields(contextValues(context, shared, values, scoped))
}
