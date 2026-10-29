export type AppRole = 'sysadmin' | 'user'
export type TemplateOrigin = 'sample' | 'upload'
export type StatusTone = 'neutral' | 'warn' | 'ok' | 'danger'
export type FeedbackStatus = 'pending' | 'in_progress' | 'done'

export interface CategoryStep {
  id: string
  body: string
  templateIds: string[]
}

export interface CaseCategory {
  id: string
  code: string
  name: string
  summary: string
  updatedAt: string
  steps: CategoryStep[]
  templateCount: number
}

export interface CategoryStepInput {
  id?: string
  body: string
  templateIds: string[]
}

export interface CategoryInput {
  name: string
  code: string
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
