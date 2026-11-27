import { describe, expect, it } from 'vitest'
import { displayFileName, displayTemplateName, photoTemplateLabel } from './fileName'

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

describe('displayTemplateName', () => {
  it.each([
    ['scene-photos-template.docx', '刑案現場照片（可插入圖片）'],
    ['delivery-certificate-photos-template.docx', '送達證書黏貼照片（可插入圖片）'],
  ])('displays a photo template label for %s', (name, label) => {
    expect(photoTemplateLabel(name)).toBe(label)
    expect(displayTemplateName(name)).toBe(label)
    expect(displayFileName(name)).toBe(name)
  })

  it('applies the original sanitization to all other names', () => {
    expect(displayTemplateName('欄位示範範本.docx')).toBe('欄位示範範本.docx')
    expect(displayTemplateName('<scene-photos-template.docx>')).toBe('scene-photos-template.docx')
    expect(photoTemplateLabel('constructor')).toBeUndefined()
  })
})
