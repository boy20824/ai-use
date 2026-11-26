export type CategoryGroup = 'criminal' | 'admin' | 'internal'

export interface StepDetails {
  canRunInParallel?: boolean
  categoryId?: string
  order?: number
  title?: string
  items?: string[]
  note?: string
  variantIds?: string[]
}

export interface CategoryStep extends StepDetails {
  id: string
  body: string
  templateIds: string[]
}

export interface StepRef {
  stepId: string
  sortOrder: number
}

export interface CategoryModule {
  id: string
  categoryId: string
  name: string
  sortOrder: number
  steps: StepRef[]
}
