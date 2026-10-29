export interface NavItem {
  to: string
  label: string
  mark: string
}

export const mainNav: NavItem[] = [
  { to: '/', label: '總覽', mark: '覽' },
  { to: '/categories', label: '案件類別', mark: '類' },
  { to: '/drafts', label: '我的草稿', mark: '稿' },
  { to: '/access', label: '存取權限', mark: '權' },
]
