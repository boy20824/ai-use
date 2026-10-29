import type { FeedbackStatus, StatusTone } from '@/types/domain'

export function feedbackStatusLabel(status: FeedbackStatus): string {
  switch (status) {
    case 'pending':
      return '待處理'
    case 'in_progress':
      return '處理中'
    case 'done':
      return '已完成'
  }
}

export function feedbackStatusTone(status: FeedbackStatus): StatusTone {
  switch (status) {
    case 'pending':
      return 'warn'
    case 'in_progress':
      return 'neutral'
    case 'done':
      return 'ok'
  }
}
