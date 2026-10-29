import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

export type AppDatabase = Database.Database

export type Role = 'admin' | 'clerk' | 'viewer'

export type AuditAction =
  'upload' | 'delete' | 'category_create' | 'category_update' | 'category_delete'

/**
 * Ids of the removed built-in categories. Migration deletes only these rows.
 * User-created categories use generated ids and are left in place.
 */
export const seededCategoryIds = [
  'general-assist',
  'doc-summary',
  'training-material',
  'public-copy',
  'analysis-pilot',
] as const

export interface UserRecord {
  id: string
  username: string
  passwordHash: string
  displayName: string
  role: Role
}

export interface CategoryLink {
  id: string
  name: string
  sortOrder: number
}

export interface CategoryRecord {
  id: string
  code: string
  name: string
  summary: string
  updatedAt: string
  steps: string[]
  templateCount: number
}

export interface TemplateRecord {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  addedAt: string
  placeholders: string[]
  origin: 'sample' | 'upload'
  categories: CategoryLink[]
  data?: Buffer
}

export interface CategoryInput {
  id: string
  code: string
  name: string
  summary: string
  updatedAt: string
  steps: string[]
}

interface UserRow {
  id: string
  username: string
  password_hash: string
  display_name: string
  role: Role
}

interface CategoryRow {
  id: string
  code: string
  name: string
  summary: string
  updatedAt: string
  templateCount: number
}

interface StepRow {
  categoryId: string
  body: string
}

interface TemplateRow {
  id: string
  file_name: string
  mime_type: string
  size_bytes: number
  added_at: string
  placeholders: string
  origin: 'sample' | 'upload'
  data?: Buffer
}

interface LinkRow {
  template_id: string
  category_id: string
  category_name: string
  sort_order: number
}

interface OwnerRow {
  id: string
  category_id: string
  added_at: string
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    role: row.role,
  }
}

function mapCategory(row: CategoryRow, steps: string[]): CategoryRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    summary: row.summary,
    updatedAt: row.updatedAt,
    steps,
    templateCount: row.templateCount,
  }
}

function mapTemplate(
  row: TemplateRow,
  categories: CategoryLink[],
  includeData: boolean,
): TemplateRecord {
  const placeholders = JSON.parse(row.placeholders) as unknown
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    addedAt: row.added_at,
    placeholders: Array.isArray(placeholders)
      ? placeholders.filter((item) => typeof item === 'string')
      : [],
    origin: row.origin,
    categories,
    data: includeData ? row.data : undefined,
  }
}

export function openDatabase(filename: string): AppDatabase {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true })
  const db = new Database(filename)
  db.pragma('foreign_keys = ON')
  return db
}

function tableExists(db: AppDatabase, table: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { ok: number } | undefined
  return Boolean(row)
}

function columnNames(db: AppDatabase, table: 'templates' | 'categories' | 'audit_log'): string[] {
  if (!tableExists(db, table)) return []
  const rows = db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as {
    name: string
  }[]
  return rows.map((row) => row.name)
}

function isLegacySchema(db: AppDatabase): boolean {
  return (
    columnNames(db, 'templates').includes('category_id') ||
    columnNames(db, 'categories').includes('audience')
  )
}

const accountTables = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'clerk', 'viewer'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS login_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    ip TEXT NOT NULL,
    success INTEGER NOT NULL CHECK (success IN (0, 1)),
    created_at INTEGER NOT NULL
  );
`

const categoryTable = `
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    summary TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );
`

const stepTable = `
  CREATE TABLE IF NOT EXISTS category_steps (
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (category_id, sort_order)
  );
`

const templateTable = `
  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    added_at TEXT NOT NULL,
    placeholders TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('sample', 'upload')),
    data BLOB NOT NULL
  );
`

const linkTable = `
  CREATE TABLE IF NOT EXISTS category_templates (
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    PRIMARY KEY (category_id, template_id)
  );
  CREATE INDEX IF NOT EXISTS category_templates_by_template ON category_templates(template_id);
`

const auditTable = `
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    actor_username TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN (
      'upload', 'delete', 'category_create', 'category_update', 'category_delete'
    )),
    template_id TEXT NOT NULL DEFAULT '',
    file_name TEXT NOT NULL DEFAULT '',
    category_id TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT ''
  );
`

function createCurrentSchema(db: AppDatabase) {
  db.exec(categoryTable + stepTable + templateTable + linkTable + auditTable)
}

function readLegacyOwners(
  db: AppDatabase,
): { categoryId: string; templateId: string; sortOrder: number }[] {
  if (!columnNames(db, 'templates').includes('category_id')) return []
  const rows = db.prepare('SELECT id, category_id, added_at FROM templates').all() as OwnerRow[]
  const groups = new Map<string, OwnerRow[]>()
  for (const row of rows) {
    const list = groups.get(row.category_id) ?? []
    list.push(row)
    groups.set(row.category_id, list)
  }
  const owners: { categoryId: string; templateId: string; sortOrder: number }[] = []
  for (const [categoryId, list] of groups) {
    list.sort(
      (left, right) =>
        left.added_at.localeCompare(right.added_at) || left.id.localeCompare(right.id),
    )
    list.forEach((row, index) => {
      owners.push({ categoryId, templateId: row.id, sortOrder: index })
    })
  }
  return owners
}

function upgradeLegacySchema(db: AppDatabase) {
  const owners = readLegacyOwners(db)
  db.pragma('foreign_keys = OFF')
  try {
    const apply = db.transaction(() => {
      db.exec(`
        CREATE TABLE templates_next (
          id TEXT PRIMARY KEY,
          file_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          added_at TEXT NOT NULL,
          placeholders TEXT NOT NULL,
          origin TEXT NOT NULL CHECK (origin IN ('sample', 'upload')),
          data BLOB NOT NULL
        );
        INSERT INTO templates_next (
          id, file_name, mime_type, size_bytes, added_at, placeholders, origin, data
        )
        SELECT id, file_name, mime_type, size_bytes, added_at, placeholders, origin, data
        FROM templates;
        DROP TABLE templates;
        ALTER TABLE templates_next RENAME TO templates;

        CREATE TABLE categories_next (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL COLLATE NOCASE UNIQUE,
          summary TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        );
        INSERT INTO categories_next (id, code, name, summary, updated_at)
        SELECT id, code, name, summary, updated_at FROM categories;
        DROP TABLE categories;
        ALTER TABLE categories_next RENAME TO categories;

        ${stepTable}
        ${linkTable}

        CREATE TABLE audit_log_next (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL,
          actor_username TEXT NOT NULL,
          action TEXT NOT NULL CHECK (action IN (
            'upload', 'delete', 'category_create', 'category_update', 'category_delete'
          )),
          template_id TEXT NOT NULL DEFAULT '',
          file_name TEXT NOT NULL DEFAULT '',
          category_id TEXT NOT NULL DEFAULT '',
          detail TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO audit_log_next (
          id, created_at, actor_username, action, template_id, file_name, category_id, detail
        )
        SELECT id, created_at, actor_username, action, template_id, file_name, category_id, ''
        FROM audit_log;
        DROP TABLE audit_log;
        ALTER TABLE audit_log_next RENAME TO audit_log;
      `)

      const categoryExists = db.prepare('SELECT 1 AS ok FROM categories WHERE id = ?')
      const templateExists = db.prepare('SELECT 1 AS ok FROM templates WHERE id = ?')
      const insertLink = db.prepare(
        'INSERT INTO category_templates (category_id, template_id, sort_order) VALUES (?, ?, ?)',
      )
      for (const owner of owners) {
        if (!categoryExists.get(owner.categoryId)) continue
        if (!templateExists.get(owner.templateId)) continue
        insertLink.run(owner.categoryId, owner.templateId, owner.sortOrder)
      }
    })
    apply()
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

function deleteSeededCategories(db: AppDatabase) {
  const removeLinks = db.prepare('DELETE FROM category_templates WHERE category_id = ?')
  const removeSteps = db.prepare('DELETE FROM category_steps WHERE category_id = ?')
  const removeCategory = db.prepare('DELETE FROM categories WHERE id = ?')
  const apply = db.transaction(() => {
    for (const id of seededCategoryIds) {
      removeLinks.run(id)
      removeSteps.run(id)
      removeCategory.run(id)
    }
  })
  apply()
}

export function migrate(db: AppDatabase) {
  db.exec(accountTables)
  if (!tableExists(db, 'categories')) {
    createCurrentSchema(db)
    return
  }
  if (isLegacySchema(db)) upgradeLegacySchema(db)
  db.exec(stepTable + linkTable)
  deleteSeededCategories(db)
}

function isUniqueConstraint(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = 'code' in error ? String((error as { code?: string }).code ?? '') : ''
  if (code === 'SQLITE_CONSTRAINT_UNIQUE') return true
  const message = 'message' in error ? String((error as { message?: string }).message ?? '') : ''
  return message.includes('UNIQUE')
}

export function createQueries(db: AppDatabase) {
  const countUsers = db.prepare('SELECT COUNT(*) AS count FROM users')
  const insertUser = db.prepare(
    'INSERT INTO users (id, username, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)',
  )
  const findUserByUsername = db.prepare(
    'SELECT id, username, password_hash, display_name, role FROM users WHERE username = ?',
  )
  const insertSession = db.prepare(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)',
  )
  const findSession = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, s.expires_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ?
  `)
  const deleteSession = db.prepare('DELETE FROM sessions WHERE id = ?')
  const deleteUserSessions = db.prepare('DELETE FROM sessions WHERE user_id = ?')

  const listCategoryRows = db.prepare(`
    SELECT
      id,
      code,
      name,
      summary,
      updated_at AS updatedAt,
      (SELECT COUNT(*) FROM category_templates ct WHERE ct.category_id = categories.id) AS templateCount
    FROM categories
  `)
  const listStepRows = db.prepare(`
    SELECT category_id AS categoryId, body
    FROM category_steps
    ORDER BY category_id, sort_order
  `)
  const getCategoryRow = db.prepare(`
    SELECT
      id,
      code,
      name,
      summary,
      updated_at AS updatedAt,
      (SELECT COUNT(*) FROM category_templates ct WHERE ct.category_id = categories.id) AS templateCount
    FROM categories
    WHERE id = ?
  `)
  const listStepsForCategory = db.prepare(
    'SELECT body FROM category_steps WHERE category_id = ? ORDER BY sort_order',
  )
  const findNameOwner = db.prepare(
    'SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND id <> ?',
  )
  const insertCategory = db.prepare(
    'INSERT INTO categories (id, code, name, summary, updated_at) VALUES (?, ?, ?, ?, ?)',
  )
  const updateCategory = db.prepare(
    'UPDATE categories SET code = ?, name = ?, summary = ?, updated_at = ? WHERE id = ?',
  )
  const deleteCategorySteps = db.prepare('DELETE FROM category_steps WHERE category_id = ?')
  const insertStep = db.prepare(
    'INSERT INTO category_steps (category_id, sort_order, body) VALUES (?, ?, ?)',
  )
  const deleteCategoryRow = db.prepare('DELETE FROM categories WHERE id = ?')
  const touchCategory = db.prepare('UPDATE categories SET updated_at = ? WHERE id = ?')

  const countTemplate = db.prepare('SELECT COUNT(*) AS count FROM templates WHERE id = ?')
  const insertTemplate = db.prepare(`
    INSERT INTO templates (
      id, file_name, mime_type, size_bytes, added_at, placeholders, origin, data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const listTemplates = db.prepare(`
    SELECT id, file_name, mime_type, size_bytes, added_at, placeholders, origin
    FROM templates
    ORDER BY added_at DESC, id DESC
  `)
  const listTemplatesByCategory = db.prepare(`
    SELECT t.id, t.file_name, t.mime_type, t.size_bytes, t.added_at, t.placeholders, t.origin
    FROM templates t
    JOIN category_templates ct ON ct.template_id = t.id
    WHERE ct.category_id = ?
    ORDER BY ct.sort_order ASC, t.id ASC
  `)
  const getTemplateFile = db.prepare(
    'SELECT id, file_name, mime_type, size_bytes, added_at, placeholders, origin, data FROM templates WHERE id = ?',
  )
  const deleteTemplate = db.prepare('DELETE FROM templates WHERE id = ?')
  const listLinks = db.prepare(`
    SELECT ct.template_id, ct.category_id, c.name AS category_name, ct.sort_order
    FROM category_templates ct
    JOIN categories c ON c.id = ct.category_id
    ORDER BY ct.sort_order ASC, c.name COLLATE NOCASE ASC
  `)
  const deleteLinksForCategory = db.prepare('DELETE FROM category_templates WHERE category_id = ?')
  const insertLink = db.prepare(
    'INSERT INTO category_templates (category_id, template_id, sort_order) VALUES (?, ?, ?)',
  )
  const nextSort = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS sortOrder FROM category_templates WHERE category_id = ?',
  )
  const linkExists = db.prepare(
    'SELECT 1 AS ok FROM category_templates WHERE category_id = ? AND template_id = ?',
  )

  const insertAudit = db.prepare(
    'INSERT INTO audit_log (created_at, actor_username, action, template_id, file_name, category_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const insertLoginEvent = db.prepare(
    'INSERT INTO login_events (username, ip, success, created_at) VALUES (?, ?, ?, ?)',
  )
  const countFailures = db.prepare(
    'SELECT COUNT(*) AS count FROM login_events WHERE username = ? AND success = 0 AND created_at > ?',
  )
  const countAttempts = db.prepare(
    'SELECT COUNT(*) AS count FROM login_events WHERE ip = ? AND created_at > ?',
  )
  const clearFailures = db.prepare('DELETE FROM login_events WHERE username = ? AND success = 0')

  function stepsByCategory(): Map<string, string[]> {
    const grouped = new Map<string, string[]>()
    const rows = listStepRows.all() as StepRow[]
    for (const row of rows) {
      const list = grouped.get(row.categoryId) ?? []
      list.push(row.body)
      grouped.set(row.categoryId, list)
    }
    return grouped
  }

  function linksByTemplate(rows: LinkRow[]): Map<string, CategoryLink[]> {
    const grouped = new Map<string, CategoryLink[]>()
    for (const row of rows) {
      const list = grouped.get(row.template_id) ?? []
      list.push({ id: row.category_id, name: row.category_name, sortOrder: row.sort_order })
      grouped.set(row.template_id, list)
    }
    return grouped
  }

  function hydrateTemplates(rows: TemplateRow[], includeData: boolean): TemplateRecord[] {
    const grouped = linksByTemplate(listLinks.all() as LinkRow[])
    return rows.map((row) => mapTemplate(row, grouped.get(row.id) ?? [], includeData))
  }

  function writeSteps(categoryId: string, steps: string[]) {
    deleteCategorySteps.run(categoryId)
    steps.forEach((body, index) => insertStep.run(categoryId, index, body))
  }

  function writeAudit(
    actorUsername: string,
    action: AuditAction,
    templateId: string,
    fileName: string,
    categoryId: string,
    detail: string,
  ) {
    insertAudit.run(
      new Date().toISOString(),
      actorUsername,
      action,
      templateId,
      fileName,
      categoryId,
      detail,
    )
  }

  return {
    countUsers() {
      const row = countUsers.get() as { count: number }
      return row.count
    },
    insertUser(
      id: string,
      username: string,
      passwordHash: string,
      displayName: string,
      role: Role,
    ) {
      insertUser.run(id, username, passwordHash, displayName, role)
    },
    findUserByUsername(username: string) {
      const row = findUserByUsername.get(username) as UserRow | undefined
      return row ? mapUser(row) : null
    },
    insertSession(id: string, userId: string, expiresAt: string) {
      insertSession.run(id, userId, expiresAt)
    },
    findSession(id: string) {
      return findSession.get(id) as
        | { id: string; username: string; display_name: string; role: Role; expires_at: string }
        | undefined
    },
    deleteSession(id: string) {
      deleteSession.run(id)
    },
    deleteUserSessions(userId: string) {
      deleteUserSessions.run(userId)
    },
    listCategories() {
      const steps = stepsByCategory()
      const rows = listCategoryRows.all() as CategoryRow[]
      return rows
        .map((row) => mapCategory(row, steps.get(row.id) ?? []))
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant'))
    },
    getCategory(id: string) {
      const row = getCategoryRow.get(id) as CategoryRow | undefined
      if (!row) return null
      const steps = (listStepsForCategory.all(id) as { body: string }[]).map((item) => item.body)
      return mapCategory(row, steps)
    },
    nameTaken(name: string, exceptId = '') {
      return Boolean(findNameOwner.get(name, exceptId))
    },
    createCategory(input: CategoryInput, actorUsername: string) {
      const apply = db.transaction(() => {
        insertCategory.run(input.id, input.code, input.name, input.summary, input.updatedAt)
        writeSteps(input.id, input.steps)
        writeAudit(actorUsername, 'category_create', '', '', input.id, input.name)
      })
      try {
        apply()
      } catch (error) {
        if (isUniqueConstraint(error)) return false
        throw error
      }
      return true
    },
    updateCategory(input: CategoryInput, actorUsername: string) {
      const apply = db.transaction(() => {
        const result = updateCategory.run(
          input.code,
          input.name,
          input.summary,
          input.updatedAt,
          input.id,
        )
        if (result.changes === 0) return false
        writeSteps(input.id, input.steps)
        writeAudit(actorUsername, 'category_update', '', '', input.id, input.name)
        return true
      })
      try {
        return apply()
      } catch (error) {
        if (isUniqueConstraint(error)) return false
        throw error
      }
    },
    deleteCategory(id: string, actorUsername: string, name: string) {
      const apply = db.transaction(() => {
        const result = deleteCategoryRow.run(id)
        if (result.changes === 0) return false
        writeAudit(actorUsername, 'category_delete', '', '', id, name)
        return true
      })
      return apply()
    },
    hasTemplate(id: string) {
      const row = countTemplate.get(id) as { count: number }
      return row.count > 0
    },
    insertTemplate(record: TemplateRecord & { data: Buffer }, linkCategoryId?: string) {
      const apply = db.transaction(() => {
        insertTemplate.run(
          record.id,
          record.fileName,
          record.mimeType,
          record.sizeBytes,
          record.addedAt,
          JSON.stringify(record.placeholders),
          record.origin,
          record.data,
        )
        if (linkCategoryId && !linkExists.get(linkCategoryId, record.id)) {
          const sort = nextSort.get(linkCategoryId) as { sortOrder: number }
          insertLink.run(linkCategoryId, record.id, sort.sortOrder)
          touchCategory.run(record.addedAt, linkCategoryId)
        }
      })
      apply()
    },
    replaceCategoryTemplates(
      categoryId: string,
      templateIds: string[],
      actorUsername: string,
      categoryName: string,
      updatedAt: string,
    ) {
      const apply = db.transaction(() => {
        deleteLinksForCategory.run(categoryId)
        templateIds.forEach((templateId, index) => insertLink.run(categoryId, templateId, index))
        touchCategory.run(updatedAt, categoryId)
        writeAudit(
          actorUsername,
          'category_update',
          '',
          '',
          categoryId,
          `${categoryName} · 範本連結`,
        )
      })
      apply()
    },
    listTemplates(categoryId?: string) {
      const rows = (
        categoryId ? listTemplatesByCategory.all(categoryId) : listTemplates.all()
      ) as TemplateRow[]
      return hydrateTemplates(rows, false)
    },
    getTemplateFile(id: string) {
      const row = getTemplateFile.get(id) as TemplateRow | undefined
      if (!row) return null
      return hydrateTemplates([row], true)[0] ?? null
    },
    deleteTemplate(id: string) {
      return deleteTemplate.run(id).changes
    },
    insertAudit(
      actorUsername: string,
      action: AuditAction,
      templateId: string,
      fileName: string,
      categoryId: string,
      detail = '',
    ) {
      writeAudit(actorUsername, action, templateId, fileName, categoryId, detail)
    },
    recordLogin(username: string, ip: string, success: boolean) {
      insertLoginEvent.run(username, ip, success ? 1 : 0, Date.now())
    },
    recentFailures(username: string, since: number) {
      const row = countFailures.get(username, since) as { count: number }
      return row.count
    },
    recentAttempts(ip: string, since: number) {
      const row = countAttempts.get(ip, since) as { count: number }
      return row.count
    },
    clearFailures(username: string) {
      clearFailures.run(username)
    },
  }
}

export type AppQueries = ReturnType<typeof createQueries>
