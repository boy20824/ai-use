export interface NavItem {
  to: string
  label: string
  mark: string
  sysadminOnly?: boolean
}

export const mainNav: NavItem[] = [
  { to: '/', label: '總覽', mark: '覽' },
  { to: '/categories', label: '案件類別', mark: '類' },
  { to: '/templates', label: '範本庫', mark: '範' },
  { to: '/feedback', label: '留言板', mark: '言' },
  { to: '/members', label: '會員管理', mark: '員', sysadminOnly: true },
]
