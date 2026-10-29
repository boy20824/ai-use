import type { DocumentKind, StatusTone, TemplateOrigin } from '@/types/domain'

export function documentTone(kind: DocumentKind): StatusTone {
  switch (kind) {
    case '說明':
      return 'neutral'
    case '表單':
      return 'warn'
    case '檢核':
      return 'ok'
  }
}

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
