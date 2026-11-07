export interface NavItem {
  to: string
  label: string
  mark: string
  sysadminOnly?: boolean
}

export const mainNav: NavItem[] = [
  { to: '/', label: '總覽', mark: 'overview' },
  { to: '/categories', label: '案件範本', mark: 'documents' },
  { to: '/templates', label: '範本庫', mark: 'folder' },
  { to: '/feedback', label: '留言板', mark: 'feedback' },
  { to: '/members', label: '會員管理', mark: 'members', sysadminOnly: true },
]
