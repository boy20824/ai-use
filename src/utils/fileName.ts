export function displayFileName(name: string): string {
  const text = name.replace(/[<>&"'`\u0000-\u001f\u007f]/g, '').trim()
  return text.slice(0, 180) || '未命名.docx'
}

const photoTemplateLabels = new Map([
  ['scene-photos-template.docx', '刑案現場照片（可插入圖片）'],
  ['delivery-certificate-photos-template.docx', '送達證書黏貼照片（可插入圖片）'],
])

export function photoTemplateLabel(name: string): string | undefined {
  return photoTemplateLabels.get(name)
}

export function displayTemplateName(name: string): string {
  return photoTemplateLabel(name) ?? displayFileName(name)
}
