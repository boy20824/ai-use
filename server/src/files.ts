import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

type TemplateKind = 'docx' | 'pdf'

const templateIdPattern = /^[a-zA-Z0-9-]{1,64}$/

export function ensureUploadDir(uploadDir: string) {
  mkdirSync(uploadDir, { recursive: true })
}

export function templateFilePath(
  uploadDir: string,
  id: string,
  kind: TemplateKind = 'docx',
): string {
  if (!templateIdPattern.test(id) || !['docx', 'pdf'].includes(kind)) {
    throw new Error('不安全的範本編號。')
  }
  const root = path.resolve(uploadDir)
  const target = path.resolve(root, `${id}.${kind}`)
  if (target !== path.join(root, `${id}.${kind}`)) {
    throw new Error('不安全的範本路徑。')
  }
  return target
}

export function writeTemplateFile(
  uploadDir: string,
  id: string,
  data: Buffer,
  kind: TemplateKind = 'docx',
) {
  ensureUploadDir(uploadDir)
  const target = templateFilePath(uploadDir, id, kind)
  const temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`
  try {
    writeFileSync(temporary, data, { flag: 'wx' })
    renameSync(temporary, target)
  } finally {
    rmSync(temporary, { force: true })
  }
}

export function removeTemplateFile(uploadDir: string, id: string, kind: TemplateKind = 'docx') {
  rmSync(templateFilePath(uploadDir, id, kind), { force: true })
}

export function readTemplateBytes(
  uploadDir: string,
  id: string,
  fallback: Buffer | undefined,
  kind: TemplateKind = 'docx',
): Buffer | undefined {
  try {
    const target = templateFilePath(uploadDir, id, kind)
    if (existsSync(target)) return readFileSync(target)
  } catch {
    return fallback
  }
  return fallback
}
