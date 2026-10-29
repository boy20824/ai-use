import bcrypt from 'bcryptjs'
import { readFileSync } from 'node:fs'
import { categories } from './categories.ts'
import type { SeedPasswords } from './config.ts'
import { listPlaceholders } from './docx.ts'
import type { AppQueries } from './db.ts'

const users = [
  { id: 'user-clerk', username: 'clerk', displayName: '示範承辦', role: 'clerk' },
  { id: 'user-admin', username: 'admin', displayName: '示範管理員', role: 'admin' },
  { id: 'user-viewer', username: 'viewer', displayName: '示範檢視', role: 'viewer' },
] as const

export function seedReferenceData(
  queries: AppQueries,
  passwords: SeedPasswords,
  samplePath: string,
) {
  if (queries.countUsers() === 0) {
    for (const user of users) {
      queries.insertUser(
        user.id,
        user.username,
        bcrypt.hashSync(passwords[user.role], 10),
        user.displayName,
        user.role,
      )
    }
  }

  for (const category of categories) {
    queries.insertCategory(
      category.id,
      category.code,
      category.name,
      category.summary,
      category.audience,
      category.updatedAt,
    )
  }

  if (!queries.hasTemplate('sample-field-note')) {
    const data = readFileSync(samplePath)
    queries.insertTemplate({
      id: 'sample-field-note',
      categoryId: 'general-assist',
      fileName: '欄位示範範本.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: data.byteLength,
      addedAt: '2026-10-29 09:00',
      placeholders: listPlaceholders(data),
      origin: 'sample',
      data,
    })
  }
}
