import type { FeedbackStatus, StatusTone, TemplateOrigin } from '@/types/domain'

export function templateTone(origin: TemplateOrigin): StatusTone {
  switch (origin) {
    case 'sample':
      return 'neutral'
    case 'upload':
      return 'ok'
  }
}

export function templateOriginLabel(origin: TemplateOrigin): string {
  switch (origin) {
    case 'sample':
      return '示範'
    case 'upload':
      return '上傳'
  }
}

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
