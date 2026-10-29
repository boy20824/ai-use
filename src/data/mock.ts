import type { AccessRole, AppRole, PermissionKey, PermissionRow } from '@/types/domain'

export const roleLabels: Record<AppRole, string> = {
  admin: '系統管理員',
  clerk: '類別承辦',
  viewer: '唯讀檢視',
}

export const roleOrder: AppRole[] = ['viewer', 'clerk', 'admin']

export const permissionRows: PermissionRow[] = [
  {
    key: 'browse',
    label: '瀏覽類別、步驟與範本',
    roles: ['viewer', 'clerk', 'admin'],
  },
  {
    key: 'editCategory',
    label: '建立與編輯案件類別（含步驟與範本連結）',
    roles: ['admin'],
  },
  {
    key: 'deleteCategory',
    label: '刪除案件類別',
    roles: ['admin'],
  },
  {
    key: 'upload',
    label: '上傳範本文件',
    roles: ['admin'],
  },
  {
    key: 'remove',
    label: '刪除範本文件',
    roles: ['admin'],
  },
  {
    key: 'access',
    label: '檢視角色與權限對照',
    roles: ['viewer', 'clerk', 'admin'],
  },
]

const roleSummaries: Record<AppRole, string> = {
  viewer: '可閱讀類別、填寫步驟與範本，也能在工作台產生文件。不能建立類別或變更範本。',
  clerk:
    '可閱讀類別、填寫步驟與範本，並在工作台產生文件。不能建立、編輯或刪除類別，也不能上傳或刪除範本。',
  admin:
    '可建立、編輯與刪除案件類別（含步驟與範本連結），也可上傳與刪除範本。刪除類別不會刪除範本檔。',
}

const roleMembers: Record<AppRole, number> = {
  viewer: 5,
  clerk: 8,
  admin: 2,
}

export function roleAllows(role: AppRole, key: PermissionKey): boolean {
  const row = permissionRows.find((item) => item.key === key)
  return row ? row.roles.includes(role) : false
}

export function permissionsFor(role: AppRole): string[] {
  return permissionRows.filter((row) => row.roles.includes(role)).map((row) => row.label)
}

export const accessRoles: AccessRole[] = roleOrder.map((id) => ({
  id,
  name: roleLabels[id],
  summary: roleSummaries[id],
  members: roleMembers[id],
  permissions: permissionsFor(id),
}))
