import { describe, expect, it } from 'vitest'
import { displayFileName } from './fileName'

describe('displayFileName', () => {
  it('removes markup characters from template names', () => {
    expect(displayFileName('欄位示範範本.docx')).toBe('欄位示範範本.docx')
    expect(displayFileName('<img src=x onerror="alert(1)">.docx')).toBe(
      'img src=x onerror=alert(1).docx',
    )
    expect(displayFileName('a&b<script>.docx')).toBe('abscript.docx')
    expect(displayFileName('\u0000..\nsecret.docx')).toBe('..secret.docx')
  })
})
