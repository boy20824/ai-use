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
    label: '建立與編輯案件類別',
    roles: ['clerk', 'admin'],
  },
  {
    key: 'deleteCategory',
    label: '刪除案件類別',
    roles: ['admin'],
  },
  {
    key: 'upload',
    label: '上傳範本文件',
    roles: ['clerk', 'admin'],
  },
  {
    key: 'remove',
    label: '移除範本文件',
    roles: ['admin'],
  },
  {
    key: 'access',
    label: '檢視角色與權限對照',
    roles: ['viewer', 'clerk', 'admin'],
  },
]

const roleSummaries: Record<AppRole, string> = {
  viewer: '可閱讀類別、填寫步驟與範本庫，也能在本機產生文件。不能建立類別或變更範本。',
  clerk: '可建立與編輯案件類別、上傳範本並調整連結。不能刪除類別或範本檔。',
  admin: '可建立、編輯與刪除案件類別，也可上傳與移除範本。刪除類別不會刪除範本檔。',
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
