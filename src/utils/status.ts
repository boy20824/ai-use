import type { StatusTone, TemplateOrigin } from '@/types/domain'

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
