export function displayFileName(name: string): string {
  const text = name.replace(/[<>&"'`\u0000-\u001f\u007f]/g, '').trim()
  return text.slice(0, 180) || '未命名.docx'
}
