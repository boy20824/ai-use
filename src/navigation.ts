export interface NavItem {
  to: string
  label: string
  mark: string
}

export const mainNav: NavItem[] = [
  { to: '/', label: '總覽', mark: '覽' },
  { to: '/cases', label: '案件', mark: '案' },
  { to: '/personnel', label: '人員', mark: '員' },
  { to: '/access', label: '存取', mark: '權' },
]

export const loginNav: NavItem = { to: '/login', label: '登入', mark: '入' }
