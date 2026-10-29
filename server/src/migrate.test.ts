import { describe, expect, it } from 'vitest'
import { createQueries, migrate, openDatabase, seededCategoryIds } from './db.ts'

const legacySchema = `
  CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    summary TEXT NOT NULL,
    audience TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE templates (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    added_at TEXT NOT NULL,
    placeholders TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('sample', 'upload')),
    data BLOB NOT NULL
  );

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    actor_username TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('upload', 'delete')),
    template_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    category_id TEXT NOT NULL
  );
`

describe('category migration', () => {
  it('deletes only the fixed seeded categories and keeps template files', () => {
    expect([...seededCategoryIds]).toEqual([
      'general-assist',
      'doc-summary',
      'training-material',
      'public-copy',
      'analysis-pilot',
    ])

    const db = openDatabase(':memory:')
    db.exec(legacySchema)
    const insertCategory = db.prepare(
      'INSERT INTO categories (id, code, name, summary, audience, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    for (const id of seededCategoryIds) {
      insertCategory.run(id, id, `內建 ${id}`, '舊摘要', '舊對象', '2026-10-01')
    }
    insertCategory.run('user-keep', 'USR', '使用者自建類別', '自建摘要', '承辦', '2026-10-20')
    insertCategory.run(
      'general-assist-extra',
      'EXT',
      '名稱很像內建',
      '不該被刪',
      '承辦',
      '2026-10-21',
    )

    const insertTemplate = db.prepare(
      'INSERT INTO templates (id, category_id, file_name, mime_type, size_bytes, added_at, placeholders, origin, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    insertTemplate.run(
      'sample-field-note',
      'general-assist',
      '欄位示範範本.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      11,
      '2026-10-01 09:00',
      '[]',
      'sample',
      Buffer.from('SEEDED-FILE'),
    )
    insertTemplate.run(
      'user-template',
      'user-keep',
      '自建範本.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      9,
      '2026-10-20 09:00',
      '["姓名"]',
      'upload',
      Buffer.from('USER-FILE'),
    )
    db.prepare(
      'INSERT INTO audit_log (created_at, actor_username, action, template_id, file_name, category_id) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      '2026-10-20T00:00:00.000Z',
      'admin',
      'upload',
      'user-template',
      '自建範本.docx',
      'user-keep',
    )

    migrate(db)
    migrate(db)

    const queries = createQueries(db)
    const ids = queries
      .listCategories()
      .map((item) => item.id)
      .sort()
    for (const id of seededCategoryIds) expect(ids).not.toContain(id)
    expect(ids).toEqual(['general-assist-extra', 'user-keep'])

    const userTemplate = queries.getTemplateFile('user-template')
    const seededTemplate = queries.getTemplateFile('sample-field-note')
    expect(userTemplate?.data?.toString()).toBe('USER-FILE')
    expect(userTemplate?.categories.map((item) => item.id)).toEqual(['user-keep'])
    expect(seededTemplate?.data?.toString()).toBe('SEEDED-FILE')
    expect(seededTemplate?.categories).toEqual([])
    expect(queries.listTemplates('user-keep').map((item) => item.id)).toEqual(['user-template'])

    const columns = db.prepare("SELECT name FROM pragma_table_info('categories')").all() as {
      name: string
    }[]
    expect(columns.map((column) => column.name)).not.toContain('audience')
    expect(columns.map((column) => column.name)).not.toContain('category_id')
    const templateColumns = db.prepare("SELECT name FROM pragma_table_info('templates')").all() as {
      name: string
    }[]
    expect(templateColumns.map((column) => column.name)).not.toContain('category_id')

    const audit = db.prepare('SELECT action, template_id FROM audit_log').all() as {
      action: string
      template_id: string
    }[]
    expect(audit).toEqual([{ action: 'upload', template_id: 'user-template' }])

    const removed = queries.deleteCategory('user-keep', 'admin', '使用者自建類別')
    expect(removed).toBe(true)
    expect(queries.getTemplateFile('user-template')?.data?.toString()).toBe('USER-FILE')
    expect(queries.getTemplateFile('user-template')?.categories).toEqual([])
    db.close()
  })

  it('creates the shared library schema on an empty database', () => {
    const db = openDatabase(':memory:')
    migrate(db)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    const names = tables.map((table) => table.name)
    expect(names).toEqual(expect.arrayContaining(['categories', 'category_templates', 'templates']))
    expect(createQueries(db).listCategories()).toEqual([])
    db.close()
  })
})
