import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

const templateIdPattern = /^[a-zA-Z0-9-]{1,64}$/

export function ensureUploadDir(uploadDir: string) {
  mkdirSync(uploadDir, { recursive: true })
}

export function templateFilePath(uploadDir: string, id: string): string {
  if (!templateIdPattern.test(id)) {
    throw new Error('不安全的範本編號。')
  }
  const root = path.resolve(uploadDir)
  const target = path.resolve(root, `${id}.docx`)
  if (target !== path.join(root, `${id}.docx`)) {
    throw new Error('不安全的範本路徑。')
  }
  return target
}

export function writeTemplateFile(uploadDir: string, id: string, data: Buffer) {
  ensureUploadDir(uploadDir)
  const target = templateFilePath(uploadDir, id)
  const temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`
  try {
    writeFileSync(temporary, data, { flag: 'wx' })
    renameSync(temporary, target)
  } finally {
    rmSync(temporary, { force: true })
  }
}

export function removeTemplateFile(uploadDir: string, id: string) {
  rmSync(templateFilePath(uploadDir, id), { force: true })
}

export function readTemplateBytes(
  uploadDir: string,
  id: string,
  fallback: Buffer | undefined,
): Buffer | undefined {
  try {
    const target = templateFilePath(uploadDir, id)
    if (existsSync(target)) return readFileSync(target)
  } catch {
    return fallback
  }
  return fallback
}
