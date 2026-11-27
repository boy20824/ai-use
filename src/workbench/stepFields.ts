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
    if (!template || template.kind === 'pdf') return
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

/** Only explicit base definitions belong above the workflow. */
export function sharedFieldNames(
  category: Pick<CaseCategory, 'builtinFields' | 'fields'>,
): string[] {
  return [
    ...new Set([
      ...(category.builtinFields?.['姓名'] === true ? ['姓名'] : []),
      '日期',
      ...(category.fields ?? [])
        .filter((field) => field.scope === 'base' && field.key !== '案次編號')
        .map((field) => field.key),
    ]),
  ]
}

export const localFieldNames = (contexts: GenerationContext[], shared: string[]) =>
  inputFields(contexts).filter((key) => !shared.includes(key))
export const scopeKey = (context: GenerationContext) =>
  JSON.stringify(
    context.stepId === null ? ['temporary', context.templateId] : ['step', context.stepId],
  )

export function contextValues(
  context: GenerationContext,
  values: Record<string, string>,
  stepDateOverrides: Record<string, string> = {},
): Record<string, string> {
  const fields = valuesForFields(values, inputFields([context]))
  if (
    context.stepId !== null &&
    Object.hasOwn(stepDateOverrides, context.stepId) &&
    Object.hasOwn(fields, '日期')
  )
    fields['日期'] = stepDateOverrides[context.stepId]!
  return fields
}
export function missingContextFields(
  contexts: GenerationContext[],
  values: Record<string, string>,
  stepDateOverrides: Record<string, string> = {},
): string[] {
  return [
    ...new Set(
      contexts.flatMap((context) =>
        missingOverviewFields(
          inputFields([context]),
          contextValues(context, values, stepDateOverrides),
        ),
      ),
    ),
  ]
}
export function filledContext(
  context: GenerationContext,
  values: Record<string, string>,
  stepDateOverrides: Record<string, string> = {},
) {
  return applyRocDateFields(contextValues(context, values, stepDateOverrides))
}
