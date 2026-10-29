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
    expect(userTemplate?.usages).toEqual([
      expect.objectContaining({
        categoryId: 'user-keep',
        stepBody: '產生文件',
      }),
    ])
    expect(seededTemplate?.data?.toString()).toBe('SEEDED-FILE')
    expect(seededTemplate?.usages).toEqual([])
    expect(queries.listTemplates('user-keep').map((item) => item.id)).toEqual(['user-template'])
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    expect(tables.map((table) => table.name)).not.toContain('category_templates')
    expect(tables.map((table) => table.name)).toContain('step_templates')

    const columns = db.prepare("SELECT name FROM pragma_table_info('categories')").all() as {
      name: string
    }[]
    expect(columns.map((column) => column.name)).not.toContain('audience')
    expect(columns.map((column) => column.name)).not.toContain('category_id')
    const templateColumns = db.prepare("SELECT name FROM pragma_table_info('templates')").all() as {
      name: string
    }[]
    expect(templateColumns.map((column) => column.name)).not.toContain('category_id')

    const audit = db.prepare('SELECT action, template_id, result FROM audit_log').all() as {
      action: string
      template_id: string
      result: string
    }[]
    expect(audit).toEqual([{ action: 'upload', template_id: 'user-template', result: 'allowed' }])

    const removed = queries.deleteCategory('user-keep', 'admin', '使用者自建類別')
    expect(removed).toBe(true)
    expect(queries.getTemplateFile('user-template')?.data?.toString()).toBe('USER-FILE')
    expect(queries.getTemplateFile('user-template')?.usages).toEqual([])
    db.close()
  })

  it('moves category template links onto the first step', () => {
    const db = openDatabase(':memory:')
    db.exec(`
      CREATE TABLE categories (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE category_steps (
        category_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        body TEXT NOT NULL,
        PRIMARY KEY (category_id, sort_order)
      );
      CREATE TABLE templates (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        added_at TEXT NOT NULL,
        placeholders TEXT NOT NULL,
        origin TEXT NOT NULL CHECK (origin IN ('sample', 'upload')),
        data BLOB NOT NULL
      );
      CREATE TABLE category_templates (
        category_id TEXT NOT NULL,
        template_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        PRIMARY KEY (category_id, template_id)
      );
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        actor_username TEXT NOT NULL,
        action TEXT NOT NULL,
        template_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        category_id TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT ''
      );
    `)
    db.prepare(
      'INSERT INTO categories (id, code, name, summary, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('case-keep', 'A', '竊盜案', '', '2026-10-29')
    db.prepare('INSERT INTO category_steps (category_id, sort_order, body) VALUES (?, ?, ?)').run(
      'case-keep',
      0,
      '製作筆錄',
    )
    db.prepare('INSERT INTO category_steps (category_id, sort_order, body) VALUES (?, ?, ?)').run(
      'case-keep',
      1,
      '通知事主',
    )
    db.prepare(
      'INSERT INTO categories (id, code, name, summary, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('case-empty', 'B', '毀損案', '', '2026-10-29')
    const insertTemplate = db.prepare(
      'INSERT INTO templates (id, file_name, mime_type, size_bytes, added_at, placeholders, origin, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    insertTemplate.run(
      'tpl-a',
      '甲.docx',
      'application/octet-stream',
      1,
      '2026-10-29',
      '[]',
      'upload',
      Buffer.from('A'),
    )
    insertTemplate.run(
      'tpl-b',
      '乙.docx',
      'application/octet-stream',
      1,
      '2026-10-29',
      '[]',
      'upload',
      Buffer.from('B'),
    )
    db.prepare(
      'INSERT INTO category_templates (category_id, template_id, sort_order) VALUES (?, ?, ?)',
    ).run('case-keep', 'tpl-b', 0)
    db.prepare(
      'INSERT INTO category_templates (category_id, template_id, sort_order) VALUES (?, ?, ?)',
    ).run('case-keep', 'tpl-a', 1)
    db.prepare(
      'INSERT INTO category_templates (category_id, template_id, sort_order) VALUES (?, ?, ?)',
    ).run('case-empty', 'tpl-a', 0)

    migrate(db)
    const queries = createQueries(db)
    const kept = queries.getCategory('case-keep')
    expect(kept?.steps.map((step) => step.body)).toEqual(['製作筆錄', '通知事主'])
    expect(kept?.steps[0]?.templateIds).toEqual(['tpl-b', 'tpl-a'])
    expect(kept?.steps[1]?.templateIds).toEqual([])
    const empty = queries.getCategory('case-empty')
    expect(empty?.steps.map((step) => step.body)).toEqual(['產生文件'])
    expect(empty?.steps[0]?.templateIds).toEqual(['tpl-a'])
    expect(queries.getTemplateFile('tpl-a')?.data?.toString()).toBe('A')
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    expect(tables.map((table) => table.name)).not.toContain('category_templates')
    db.close()
  })

  it('maps legacy roles, promotes boy20824, and keeps the migration idempotent', () => {
    const db = openDatabase(':memory:')
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'clerk', 'viewer'))
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE categories (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        summary TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE templates (
        id TEXT PRIMARY KEY,
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
        action TEXT NOT NULL CHECK (action IN (
          'upload', 'delete', 'category_create', 'category_update', 'category_delete'
        )),
        template_id TEXT NOT NULL DEFAULT '',
        file_name TEXT NOT NULL DEFAULT '',
        category_id TEXT NOT NULL DEFAULT '',
        detail TEXT NOT NULL DEFAULT '',
        result TEXT NOT NULL DEFAULT 'allowed'
      );
    `)
    const insertUser = db.prepare(
      'INSERT INTO users (id, username, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)',
    )
    insertUser.run('u-admin', 'admin', 'hash-admin', '管理員', 'admin')
    insertUser.run('u-clerk', 'clerk', 'hash-clerk', '承辦', 'clerk')
    insertUser.run('u-viewer', 'viewer', 'hash-viewer', '檢視', 'viewer')
    insertUser.run('u-boy', 'boy20824', 'hash-boy', '伯洋', 'viewer')
    insertUser.run('u-kept', 'kept', 'hash-kept', '自建', 'clerk')
    db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(
      'sess-boy',
      'u-boy',
      '2099-01-01T00:00:00.000Z',
    )
    db.prepare(
      'INSERT INTO categories (id, code, name, summary, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('case-1', 'A', '竊盜案', '保留', '2026-10-29')
    db.prepare(
      `INSERT INTO audit_log (
        created_at, actor_username, action, template_id, file_name, category_id, detail, result
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      '2026-10-01T00:00:00.000Z',
      'admin',
      'category_create',
      '',
      '',
      'case-1',
      '竊盜案',
      'allowed',
    )

    migrate(db)
    const queries = createQueries(db)
    const firstStamp = queries.findUserByUsername('boy20824')?.createdAt
    migrate(db)

    expect(queries.findUserByUsername('admin')).toMatchObject({
      role: 'sysadmin',
      canManageCategories: false,
      active: true,
      passwordHash: 'hash-admin',
    })
    expect(queries.findUserByUsername('clerk')).toMatchObject({ role: 'user', active: true })
    expect(queries.findUserByUsername('viewer')).toMatchObject({ role: 'user', active: true })
    expect(queries.findUserByUsername('kept')).toMatchObject({
      role: 'user',
      canManageCategories: false,
      passwordHash: 'hash-kept',
    })
    expect(queries.findUserByUsername('BOY20824')).toMatchObject({
      id: 'u-boy',
      role: 'sysadmin',
      canManageCategories: false,
      active: true,
      passwordHash: 'hash-boy',
      nickname: '伯洋',
      createdAt: firstStamp,
    })
    expect(queries.findSession('sess-boy')?.id).toBe('u-boy')
    expect(queries.getCategory('case-1')?.name).toBe('竊盜案')
    const roles = db.prepare('SELECT role FROM users').all() as { role: string }[]
    expect(roles.every((row) => row.role === 'sysadmin' || row.role === 'user')).toBe(true)
    const audit = db
      .prepare('SELECT action, detail, result, target_username FROM audit_log')
      .all() as { action: string; detail: string; result: string; target_username: string }[]
    expect(audit).toEqual([
      {
        action: 'category_create',
        detail: '竊盜案',
        result: 'allowed',
        target_username: '',
      },
    ])
    expect(() => insertUser.run('u-old', 'legacy', 'hash', '舊', 'admin')).toThrow()
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    expect(tables.map((table) => table.name)).toContain('feedback_posts')
    db.close()
  })

  it('creates the shared library schema on an empty database', () => {
    const db = openDatabase(':memory:')
    migrate(db)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    const names = tables.map((table) => table.name)
    expect(names).toEqual(
      expect.arrayContaining(['categories', 'category_steps', 'step_templates', 'templates']),
    )
    expect(names).not.toContain('category_templates')
    expect(createQueries(db).listCategories()).toEqual([])
    db.close()
  })
})
