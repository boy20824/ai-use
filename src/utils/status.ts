import type { CaseStatus, PersonnelStatus, StatusTone } from '@/types/records'

export function caseTone(status: CaseStatus): StatusTone {
  switch (status) {
    case '審核中':
      return 'warn'
    case '已核准':
      return 'ok'
    case '已退回':
      return 'danger'
    case '草稿':
      return 'neutral'
  }
}

export function personnelTone(status: PersonnelStatus): StatusTone {
  switch (status) {
    case '在職':
      return 'ok'
    case '留停':
      return 'neutral'
  }
}
