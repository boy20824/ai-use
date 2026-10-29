import { describe, expect, it } from 'vitest'
import {
  applyRocDateFields,
  formatRocLong,
  formatRocSlash,
  formatStoredDate,
  isValidRocDate,
  parseRocDate,
} from './rocDate'

describe('rocDate', () => {
  it('parses and formats 115/10/29', () => {
    const parsed = parseRocDate('115/10/29')
    expect(parsed).toEqual({ rocYear: 115, month: 10, day: 29 })
    expect(formatRocSlash(parsed!)).toBe('115/10/29')
    expect(formatRocLong(parsed!)).toBe('115年10月29日')
  })

  it('accepts padded months and days', () => {
    expect(parseRocDate(' 113/02/29 ')).toEqual({ rocYear: 113, month: 2, day: 29 })
    expect(parseRocDate('089/02/29')).toEqual({ rocYear: 89, month: 2, day: 29 })
  })

  it('accepts leap days only on leap years', () => {
    expect(isValidRocDate(113, 2, 29)).toBe(true)
    expect(isValidRocDate(105, 2, 29)).toBe(true)
    expect(isValidRocDate(89, 2, 29)).toBe(true)
    expect(isValidRocDate(115, 2, 29)).toBe(false)
    expect(isValidRocDate(104, 2, 29)).toBe(false)
    expect(isValidRocDate(100, 2, 29)).toBe(false)
    expect(isValidRocDate(189, 2, 29)).toBe(false)
    expect(parseRocDate('115/02/29')).toBeNull()
    expect(parseRocDate('113/2/29')).toEqual({ rocYear: 113, month: 2, day: 29 })
  })

  it('rejects impossible calendar days', () => {
    expect(parseRocDate('115/4/31')).toBeNull()
    expect(parseRocDate('115/6/31')).toBeNull()
    expect(parseRocDate('115/11/31')).toBeNull()
    expect(parseRocDate('115/00/01')).toBeNull()
    expect(parseRocDate('115/13/01')).toBeNull()
    expect(parseRocDate('115/10/00')).toBeNull()
    expect(parseRocDate('115/10/32')).toBeNull()
    expect(parseRocDate('000/01/01')).toBeNull()
    expect(parseRocDate('301/01/01')).toBeNull()
    expect(isValidRocDate(115.5, 10, 29)).toBe(false)
  })

  it('rejects strings that are not 民國年/月/日', () => {
    expect(parseRocDate('')).toBeNull()
    expect(parseRocDate('115-10-29')).toBeNull()
    expect(parseRocDate('2026-10-29')).toBeNull()
    expect(parseRocDate('115/10')).toBeNull()
    expect(parseRocDate('115/10/29/1')).toBeNull()
    expect(parseRocDate('民國115年10月29日')).toBeNull()
  })

  it('formats stored ISO timestamps for the UI', () => {
    expect(formatStoredDate('2026-10-29')).toBe('115/10/29')
    expect(formatStoredDate('2026-10-29 09:00')).toBe('115/10/29 09:00')
    expect(formatStoredDate('2024-02-29T08:05')).toBe('113/2/29 08:05')
    expect(formatStoredDate('尚未排程')).toBe('尚未排程')
    expect(formatStoredDate('2026-02-29')).toBe('2026-02-29')
  })

  it('maps the date field into document placeholders without zero padding', () => {
    const input = { 姓名: '測試者', 日期: '115/10/29' }
    expect(applyRocDateFields(input)).toEqual({
      姓名: '測試者',
      日期: '115年10月29日',
      日期_民國: '115/10/29',
      年: '115',
      月: '10',
      日: '29',
    })
    expect(input).toEqual({ 姓名: '測試者', 日期: '115/10/29' })
    expect(applyRocDateFields({ 日期: '115/2/5' })).toEqual({
      日期: '115年2月5日',
      日期_民國: '115/2/5',
      年: '115',
      月: '2',
      日: '5',
    })
  })

  it('leaves an empty date blank and rejects an invalid one', () => {
    expect(applyRocDateFields({ 姓名: '測試者', 日期: '' })).toEqual({
      姓名: '測試者',
      日期: '',
      日期_民國: '',
      年: '',
      月: '',
      日: '',
    })
    expect(applyRocDateFields({ 日期: '115/02/29' })).toBeNull()
  })
})
