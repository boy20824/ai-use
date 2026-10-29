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

export interface CaseCategory {
  id: string
  code: string
  name: string
  summary: string
  updatedAt: string
  steps: string[]
  templateCount: number
}

export interface CategoryInput {
  name: string
  code: string
  summary: string
  steps: string[]
}

export interface AccessRole {
  id: AppRole
  name: string
  summary: string
  members: number
  permissions: string[]
}
