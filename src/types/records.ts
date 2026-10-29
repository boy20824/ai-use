export type CaseStatus = '草稿' | '審核中' | '已核准' | '已退回'
export type PersonnelStatus = '在職' | '留停'
export type StatusTone = 'neutral' | 'warn' | 'ok' | 'danger'

export interface CaseRecord {
  id: string
  title: string
  applicant: string
  department: string
  status: CaseStatus
  updatedAt: string
}

export interface PersonnelRecord {
  id: string
  name: string
  department: string
  title: string
  status: PersonnelStatus
}

export interface AccessRole {
  id: string
  name: string
  members: number
  scope: string
}
