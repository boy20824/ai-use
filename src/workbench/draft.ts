import { defaultRocDateSlash } from '@/utils/rocDate'

export function initialDraftValues(now: Date = new Date()): Record<string, string> {
  return { 日期: defaultRocDateSlash(now) }
}
