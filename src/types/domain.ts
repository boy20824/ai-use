export type AppRole = 'admin' | 'clerk' | 'viewer'
export type PermissionKey =
  'browse' | 'editCategory' | 'deleteCategory' | 'upload' | 'remove' | 'access'
export type TemplateOrigin = 'sample' | 'upload'
export type StatusTone = 'neutral' | 'warn' | 'ok' | 'danger'

export interface PermissionRow {
  key: PermissionKey
  label: string
  roles: AppRole[]
}

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

export interface AccessRole {
  id: AppRole
  name: string
  summary: string
  members: number
  permissions: string[]
}
