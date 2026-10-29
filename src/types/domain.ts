export type AppRole = 'admin' | 'clerk' | 'viewer'
export type PermissionKey = 'browse' | 'upload' | 'access'
export type DocumentKind = '說明' | '表單' | '檢核'
export type DraftSource = '示範' | '本機'
export type StatusTone = 'neutral' | 'warn' | 'ok' | 'danger'

export interface DemoAccount {
  id: string
  displayName: string
  role: AppRole
  hint: string
}

export interface PermissionRow {
  key: PermissionKey
  label: string
  roles: AppRole[]
}

export interface CategoryDocument {
  id: string
  title: string
  kind: DocumentKind
  summary: string
  updatedAt: string
  points: string[]
}

export interface CategoryStep {
  id: string
  title: string
  detail: string
}

export interface CaseCategory {
  id: string
  code: string
  name: string
  summary: string
  audience: string
  updatedAt: string
  caution: string
  documents: CategoryDocument[]
  steps: CategoryStep[]
}

export interface DraftFile {
  id: string
  categoryId: string
  fileName: string
  sizeBytes: number
  mimeType: string
  addedAt: string
  source: DraftSource
}

export interface AccessRole {
  id: AppRole
  name: string
  summary: string
  members: number
  permissions: string[]
}
