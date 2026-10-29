import type { MockUser } from '@/types/domain'

export const mockUsers: MockUser[] = [
  {
    username: 'clerk',
    password: 'clerk-demo',
    displayName: '示範承辦',
    role: 'clerk',
  },
  {
    username: 'admin',
    password: 'admin-demo',
    displayName: '示範管理員',
    role: 'admin',
  },
  {
    username: 'viewer',
    password: 'viewer-demo',
    displayName: '示範檢視',
    role: 'viewer',
  },
]
