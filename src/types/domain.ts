export type AppRole = 'sysadmin' | 'user'
export type TemplateOrigin = 'sample' | 'upload'
export type StatusTone = 'neutral' | 'warn' | 'ok' | 'danger'
export type FeedbackStatus = 'pending' | 'in_progress' | 'done'

export type CategoryGroup = 'criminal' | 'admin' | 'internal'
export interface Variant {
  id: string
  categoryId?: string
  name: string
}
export interface FieldDef {
  id: string
  categoryId?: string
  name?: string
  key: string
  type: 'text' | 'number'
}
export interface StepDetails {
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

export interface CaseCategory {
  group?: CategoryGroup
  variants?: Variant[]
  fields?: FieldDef[]
  id: string
  code?: string
  name: string
  summary: string
  updatedAt: string
  steps: CategoryStep[]
  templateCount: number
}

export interface CategoryStepInput extends StepDetails {
  id?: string
  body: string
  templateIds: string[]
}

export interface CategoryInput {
  group?: CategoryGroup
  variants?: Variant[]
  fields?: FieldDef[]
  name: string
  code?: string
  summary: string
  steps: CategoryStepInput[]
}

export interface FeedbackPost {
  id: string
  authorId: string
  authorNickname: string
  title: string
  content: string
  status: FeedbackStatus
  adminReply: string
  createdAt: string
  updatedAt: string
}

export interface MemberAccount {
  id: string
  username: string
  displayName: string
  nickname: string
  role: AppRole
  active: boolean
  canManageCategories: boolean
  createdAt: string
}
