import { describe, expect, it } from 'vitest'
import { applyFieldDefaults, fieldDefaults } from './fieldDefaults'

describe('applyFieldDefaults', () => {
  it('fills missing, empty and whitespace-only fields from one configuration', () => {
    expect(fieldDefaults['警局']).toBe('臺南市政府警察局')
    expect(fieldDefaults['警察局']).toBe(fieldDefaults['警局'])
    expect(fieldDefaults['分局']).toBe('白河分局')
    const drafts: Record<string, string>[] = [{}, { 警局: '', 警察局: '  ', 分局: '\t' }]
    for (const values of drafts) {
      expect(applyFieldDefaults(values)).toEqual(fieldDefaults)
    }
  })

  it('copies values, preserves existing entries and only initializes available fields', () => {
    const values = { 分局: '其他分局（Mock)', 警局: '其他警局（Mock）', 案由: 'Mock' }
    expect(applyFieldDefaults(values)).toEqual({ ...values, 警察局: fieldDefaults['警察局'] })
    expect(applyFieldDefaults(values)).not.toBe(values)
    expect(values).not.toHaveProperty('警察局')
    expect(applyFieldDefaults({}, ['分局', '案由'])).toEqual({ 分局: fieldDefaults['分局'] })
  })
})
