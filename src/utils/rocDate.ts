export const ROC_EPOCH = 1911
export const MIN_ROC_YEAR = 1
export const MAX_ROC_YEAR = 300

export interface RocDate {
  rocYear: number
  month: number
  day: number
}

const monthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export function isLeapYear(adYear: number): boolean {
  if (!Number.isInteger(adYear)) return false
  if (adYear % 400 === 0) return true
  if (adYear % 100 === 0) return false
  return adYear % 4 === 0
}

export function adYearFromRoc(rocYear: number): number {
  return rocYear + ROC_EPOCH
}

export function rocYearFromAd(adYear: number): number {
  return adYear - ROC_EPOCH
}

export function daysInMonth(adYear: number, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) return 0
  if (month === 2 && isLeapYear(adYear)) return 29
  return monthLengths[month - 1] ?? 0
}

export function isValidRocDate(rocYear: number, month: number, day: number): boolean {
  if (!Number.isInteger(rocYear) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (rocYear < MIN_ROC_YEAR || rocYear > MAX_ROC_YEAR) return false
  if (month < 1 || month > 12) return false
  const maxDay = daysInMonth(adYearFromRoc(rocYear), month)
  return day >= 1 && day <= maxDay
}

export function parseRocDate(input: string): RocDate | null {
  const match = input.trim().match(/^(\d{1,3})\/(\d{1,2})\/(\d{1,2})$/)
  if (!match) return null
  const rocYear = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!isValidRocDate(rocYear, month, day)) return null
  return { rocYear, month, day }
}

export function formatRocSlash(date: RocDate): string {
  return `${date.rocYear}/${date.month}/${date.day}`
}

export function formatRocLong(date: RocDate): string {
  return `${date.rocYear}年${date.month}月${date.day}日`
}

const derivedDateTags = new Set(['日期_民國', '年', '月', '日'])

export function isDerivedDateTag(name: string): boolean {
  return derivedDateTags.has(name)
}

function taipeiPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const value = Number(parts.find((part) => part.type === type)?.value)
  if (!Number.isInteger(value)) throw new Error('taipei-date')
  return value
}

/** Gregorian year, month, and day in Asia/Taipei. Does not use the browser's local zone. */
export function taipeiCalendarDate(now: Date = new Date()): {
  year: number
  month: number
  day: number
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now)
  return {
    year: taipeiPart(parts, 'year'),
    month: taipeiPart(parts, 'month'),
    day: taipeiPart(parts, 'day'),
  }
}

export function defaultRocDateSlash(now: Date = new Date()): string {
  const date = taipeiCalendarDate(now)
  return formatRocSlash({ rocYear: rocYearFromAd(date.year), month: date.month, day: date.day })
}

export function formatStoredDate(value: string): string {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/)
  if (!match) return value
  const rocYear = rocYearFromAd(Number(match[1]))
  const month = Number(match[2])
  const day = Number(match[3])
  if (!isValidRocDate(rocYear, month, day)) return value
  const date = formatRocSlash({ rocYear, month, day })
  if (match[4] && match[5]) return `${date} ${match[4]}:${match[5]}`
  return date
}

export function applyRocDateFields(fields: Record<string, string>): Record<string, string> | null {
  const raw = fields['日期'] ?? ''
  const parsed = raw.trim().length > 0 ? parseRocDate(raw) : null
  if (raw.trim().length > 0 && !parsed) return null
  const next = { ...fields }
  // 月、日不補零，與既有 {{日期}}、{{日期_民國}} 相同。
  next['日期'] = parsed ? formatRocLong(parsed) : ''
  next['日期_民國'] = parsed ? formatRocSlash(parsed) : ''
  next['年'] = parsed ? String(parsed.rocYear) : ''
  next['月'] = parsed ? String(parsed.month) : ''
  next['日'] = parsed ? String(parsed.day) : ''
  return next
}
