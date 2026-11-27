import { mkdtempSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import PizZip from 'pizzip'
import type { AppConfig, SeedPasswords } from './config.ts'

export const testPasswords: SeedPasswords = {
  clerk: 'clerk-pass',
  admin: 'admin-pass',
  viewer: 'viewer-pass',
}

export const testOrigin = 'http://localhost:5173'
export const testSamplePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../public/samples/field-note.docx',
)

export function makeConfig(
  directory: { scratch: string } | { uploadDir: string },
  overrides: Partial<AppConfig> = {},
): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    databasePath: ':memory:',
    uploadDir:
      'scratch' in directory
        ? mkdtempSync(path.join(directory.scratch, 'up-'))
        : directory.uploadDir,
    sessionSecret: '',
    sessionTtlHours: 1,
    cookieSecure: false,
    corsOrigins: [testOrigin],
    maxUploadBytes: 1024 * 1024,
    maxZipEntries: 32,
    maxZipUncompressedBytes: 8 * 1024 * 1024,
    loginMaxFailures: 5,
    loginLockoutMinutes: 15,
    globalRatePerMinute: 120,
    loginRatePerMinute: 30,
    registerIpLimit: 5,
    registerGlobalLimit: 30,
    registerWindowMs: 60 * 60 * 1000,
    sampleTemplatePath: testSamplePath,
    builtinTemplateDir: path.resolve(path.dirname(testSamplePath), '../templates'),
    seedSampleData: false,
    staticDir: undefined,
    trustProxy: false,
    seedDemoUsers: true,
    passwords: testPasswords,
    ...overrides,
  }
}

export function buildMinimalDocx(text: string, extraFiles = 0) {
  const zip = new PizZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  )
  for (let index = 0; index < extraFiles; index += 1) zip.file(`word/extra-${index}.xml`, '<x/>')
  return zip.generate({ type: 'nodebuffer' }) as Uint8Array
}
