import type { CaseCategory, StepRef } from '@/types/domain'
import { displayTemplateName } from '@/utils/fileName'
import { isDerivedDateTag } from '@/utils/rocDate'
import type { OverviewTemplate } from './overview'

export function fieldUsage(
  category: Pick<CaseCategory, 'steps' | 'baseSteps' | 'modules'>,
  baseFields: readonly string[],
  lookup: (id: string) => OverviewTemplate | undefined,
) {
  const locationsByTag = new Map<string, string[]>()
  const steps = new Map(category.steps.map((step) => [step.id, step]))

  function addLocation(tags: readonly string[], location: string) {
    for (const tag of new Set(tags.map((name) => name.trim()))) {
      if (!tag) continue
      const locations = locationsByTag.get(tag)
      if (locations) locations.push(location)
      else locationsByTag.set(tag, [location])
    }
  }

  function addStepLocations(scope: string, refs: StepRef[]) {
    for (const stepId of new Set(refs.map((ref) => ref.stepId))) {
      const step = steps.get(stepId)
      if (!step) continue
      for (const templateId of new Set(step.templateIds)) {
        const template = lookup(templateId)
        if (!template || template.kind === 'pdf') continue
        addLocation(
          template.placeholders,
          `${scope}－${step.title ?? step.body}－${displayTemplateName(template.fileName)}`,
        )
      }
    }
  }

  addLocation(baseFields, '基本 SOP')
  addStepLocations('基本 SOP', category.baseSteps ?? [])
  for (const module of category.modules ?? []) addStepLocations(module.name, module.steps)

  const fields = [...locationsByTag].map(([tag, locations]) => ({
    tag,
    locations,
    count: locations.length,
    shared: locations.length > 1,
  }))
  const comparableTags = [...locationsByTag.keys()].filter(
    (tag) => tag !== '日期' && !isDerivedDateTag(tag),
  )
  const possibleDuplicates: [string, string][] = []
  for (const [index, tag] of comparableTags.entries()) {
    for (let next = index + 1; next < comparableTags.length; next++) {
      const other = comparableTags[next]!
      if (tag.includes(other) || other.includes(tag)) possibleDuplicates.push([tag, other])
    }
  }
  return { fields, possibleDuplicates }
}
