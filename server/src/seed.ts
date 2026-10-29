import bcrypt from 'bcryptjs'
import { readFileSync } from 'node:fs'
import type { SeedPasswords } from './config.ts'
import { listPlaceholders } from './docx.ts'
import type { AppQueries, Role } from './db.ts'
import { writeTemplateFile } from './files.ts'

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
    id: sampleTemplateId,
    fileName: '欄位示範範本.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sizeBytes: data.byteLength,
    addedAt: '2026-10-29 09:00',
    placeholders: listPlaceholders(data),
    origin: 'sample',
    usages: [],
    data,
  })
}
