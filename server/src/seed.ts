import bcrypt from 'bcryptjs'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { SeedPasswords } from './config.ts'
import { docxMimeType } from '../../shared/templateUpload.ts'
import { listPlaceholders } from './docx.ts'
import { createQueries, type AppDatabase, type AppQueries, type Role } from './db.ts'
import { removeTemplateFile, templateFilePath, writeTemplateFile } from './files.ts'

const users: {
  id: string
  username: string
  displayName: string
  nickname: string
  role: Role
  passwordKey: keyof SeedPasswords
}[] = [
  {
    id: 'user-clerk',
    username: 'clerk',
    displayName: '示範承辦',
    nickname: '承辦',
    role: 'user',
    passwordKey: 'clerk',
  },
  {
    id: 'user-admin',
    username: 'admin',
    displayName: '示範管理員',
    nickname: '管理員',
    role: 'sysadmin',
    passwordKey: 'admin',
  },
  {
    id: 'user-viewer',
    username: 'viewer',
    displayName: '示範檢視',
    nickname: '檢視',
    role: 'user',
    passwordKey: 'viewer',
  },
]

const sampleTemplateId = 'sample-field-note'
const builtinTemplatesMigration = 'builtin-photo-templates-v1'
const deliveryTemplateTextMigration = 'builtin-delivery-template-text-v2'
export const builtinDeliveryTemplateV1Sha256 =
  '3535d32b94a914a1af3547dfe473a90562d05882d11a20406da2f5e30a0bb949'
const deliveryTemplate = {
  id: 'builtin-delivery-certificate-photos',
  fileName: 'delivery-certificate-photos-template.docx',
}
const builtinTemplates = [
  deliveryTemplate,
  { id: 'builtin-scene-photos', fileName: 'scene-photos-template.docx' },
]

export function seedBuiltinTemplates(db: AppDatabase, templateDir: string, uploadDir: string) {
  const writtenFiles: string[] = []
  try {
    db.transaction(() => {
      db.exec('CREATE TABLE IF NOT EXISTS config_migrations (id TEXT PRIMARY KEY)')
      const migrationExists = db.prepare('SELECT 1 FROM config_migrations WHERE id = ?')
      if (migrationExists.get(builtinTemplatesMigration)) return

      const templateExists = db.prepare(
        'SELECT 1 FROM templates WHERE id = ? OR file_name COLLATE NOCASE = ? LIMIT 1',
      )
      const queries = createQueries(db)
      const addedAt = new Date().toISOString().slice(0, 16).replace('T', ' ')
      for (const { id, fileName } of builtinTemplates) {
        if (templateExists.get(id, fileName)) continue
        const data = readFileSync(path.join(templateDir, fileName))
        queries.insertTemplate({
          kind: 'docx',
          id,
          fileName,
          mimeType: docxMimeType,
          sizeBytes: data.byteLength,
          addedAt,
          placeholders: listPlaceholders(data),
          origin: 'sample',
          usages: [],
          data,
        })
        writeTemplateFile(uploadDir, id, data)
        writtenFiles.push(id)
      }
      db.prepare('INSERT INTO config_migrations (id) VALUES (?)').run(builtinTemplatesMigration)
    }).immediate()
  } catch (error) {
    // SQLite rolls back the rows. Clean up files unless another process has since seeded them.
    if (writtenFiles.length > 0) {
      db.transaction(() => {
        const templateExists = db.prepare('SELECT 1 FROM templates WHERE id = ?')
        for (const id of writtenFiles) {
          if (!templateExists.get(id)) removeTemplateFile(uploadDir, id)
        }
      }).immediate()
    }
    throw error
  }

  updateBuiltinDeliveryTemplate(db, templateDir, uploadDir)
}

function updateBuiltinDeliveryTemplate(db: AppDatabase, templateDir: string, uploadDir: string) {
  const { id, fileName } = deliveryTemplate
  const migrationExists = db.prepare('SELECT 1 FROM config_migrations WHERE id = ?')
  const matchesV1 = (data: Buffer | undefined) =>
    data && createHash('sha256').update(data).digest('hex') === builtinDeliveryTemplateV1Sha256
  let overwrittenFile: { previousBytes: Buffer | undefined } | undefined
  try {
    db.transaction(() => {
      if (migrationExists.get(deliveryTemplateTextMigration)) return

      const queries = createQueries(db)
      const previous = queries.getTemplateFile(id)
      if (previous && matchesV1(previous.data)) {
        const data = readFileSync(path.join(templateDir, fileName))
        const target = templateFilePath(uploadDir, id, previous.kind)
        const previousBytes = existsSync(target) ? readFileSync(target) : undefined
        queries.replaceTemplate({
          ...previous,
          data,
          sizeBytes: data.byteLength,
          placeholders: listPlaceholders(data),
        })
        writeTemplateFile(uploadDir, id, data, previous.kind)
        overwrittenFile = { previousBytes }
      }

      db.prepare('INSERT INTO config_migrations (id) VALUES (?)').run(deliveryTemplateTextMigration)
    }).immediate()
  } catch (error) {
    const file = overwrittenFile
    if (file) {
      // Another process may have completed the migration since SQLite rolled back.
      db.transaction(() => {
        if (migrationExists.get(deliveryTemplateTextMigration)) return
        const current = createQueries(db).getTemplateFile(id)
        if (!current || !matchesV1(current.data)) return
        if (file.previousBytes) writeTemplateFile(uploadDir, id, file.previousBytes, current.kind)
        else removeTemplateFile(uploadDir, id, current.kind)
      }).immediate()
    }
    throw error
  }
}

export function seedReferenceData(
  queries: AppQueries,
  passwords: SeedPasswords | undefined,
  samplePath: string,
  uploadDir: string,
  seedSample = false,
) {
  // Insert missing demo users only when SEED_DEMO_USERS loaded passwords.
  // Existing accounts are left as they are; nothing here deletes users.
  if (passwords) {
    for (const user of users) {
      if (queries.findUserByUsername(user.username)) continue
      queries.insertUser({
        id: user.id,
        username: user.username,
        passwordHash: bcrypt.hashSync(passwords[user.passwordKey], 10),
        displayName: user.displayName,
        nickname: user.nickname,
        role: user.role,
      })
    }
  }

  if (!seedSample || queries.hasTemplate(sampleTemplateId)) return
  const data = readFileSync(samplePath)
  writeTemplateFile(uploadDir, sampleTemplateId, data)
  queries.insertTemplate({
    kind: 'docx',
    id: sampleTemplateId,
    fileName: '欄位示範範本.docx',
    mimeType: docxMimeType,
    sizeBytes: data.byteLength,
    addedAt: '2026-10-29 09:00',
    placeholders: listPlaceholders(data),
    origin: 'sample',
    usages: [],
    data,
  })
}
