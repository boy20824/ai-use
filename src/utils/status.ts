import type { DocumentKind, DraftSource, StatusTone } from '@/types/domain'

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

export function draftTone(source: DraftSource): StatusTone {
  switch (source) {
    case '示範':
      return 'neutral'
    case '本機':
      return 'ok'
  }
}
