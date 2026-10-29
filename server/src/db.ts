import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

export type AppDatabase = Database.Database

export type Role = 'admin' | 'clerk' | 'viewer'

export interface UserRecord {
  id: string
  username: string
  passwordHash: string
  displayName: string
  role: Role
}

export interface TemplateRecord {
  id: string
  categoryId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  addedAt: string
  placeholders: string[]
  origin: 'sample' | 'upload'
  data?: Buffer
}

interface UserRow {
  id: string
  username: string
  password_hash: string
  display_name: string
  role: Role
}

interface TemplateRow {
  id: string
  category_id: string
  file_name: string
  mime_type: string
  size_bytes: number
  added_at: string
  placeholders: string
  origin: 'sample' | 'upload'
  data?: Buffer
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

function mapTemplate(row: TemplateRow, includeData: boolean): TemplateRecord {
  const placeholders = JSON.parse(row.placeholders) as unknown
  return {
    id: row.id,
    categoryId: row.category_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    addedAt: row.added_at,
    placeholders: Array.isArray(placeholders)
      ? placeholders.filter((item) => typeof item === 'string')
      : [],
    origin: row.origin,
    data: includeData ? row.data : undefined,
  }
}

export function openDatabase(filename: string): AppDatabase {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true })
  const db = new Database(filename)
  db.pragma('foreign_keys = ON')
  if (filename !== ':memory:') {
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('busy_timeout = 5000')
  }
  return db
}

export function migrate(db: AppDatabase) {
  db.exec(`
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

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      summary TEXT NOT NULL,
      audience TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS templates (
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

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      actor_username TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('upload', 'delete')),
      template_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      category_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS login_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      ip TEXT NOT NULL,
      success INTEGER NOT NULL CHECK (success IN (0, 1)),
      created_at INTEGER NOT NULL
    );
  `)
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
  const insertCategory = db.prepare(
    'INSERT OR IGNORE INTO categories (id, code, name, summary, audience, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
  const listCategories = db.prepare(
    'SELECT id, code, name, summary, audience, updated_at AS updatedAt FROM categories ORDER BY code',
  )
  const countTemplate = db.prepare('SELECT COUNT(*) AS count FROM templates WHERE id = ?')
  const insertTemplate = db.prepare(`
    INSERT INTO templates (
      id, category_id, file_name, mime_type, size_bytes, added_at, placeholders, origin, data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const listTemplates = db.prepare(`
    SELECT id, category_id, file_name, mime_type, size_bytes, added_at, placeholders, origin
    FROM templates
    ORDER BY added_at DESC, id DESC
  `)
  const listTemplatesByCategory = db.prepare(`
    SELECT id, category_id, file_name, mime_type, size_bytes, added_at, placeholders, origin
    FROM templates
    WHERE category_id = ?
    ORDER BY added_at DESC, id DESC
  `)
  const getTemplateFile = db.prepare(
    'SELECT id, category_id, file_name, mime_type, size_bytes, added_at, placeholders, origin, data FROM templates WHERE id = ?',
  )
  const deleteTemplate = db.prepare('DELETE FROM templates WHERE id = ?')
  const deleteUserSessions = db.prepare('DELETE FROM sessions WHERE user_id = ?')
  const insertAudit = db.prepare(
    'INSERT INTO audit_log (created_at, actor_username, action, template_id, file_name, category_id) VALUES (?, ?, ?, ?, ?, ?)',
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
    insertCategory(
      id: string,
      code: string,
      name: string,
      summary: string,
      audience: string,
      updatedAt: string,
    ) {
      insertCategory.run(id, code, name, summary, audience, updatedAt)
    },
    listCategories() {
      return listCategories.all() as {
        id: string
        code: string
        name: string
        summary: string
        audience: string
        updatedAt: string
      }[]
    },
    hasTemplate(id: string) {
      const row = countTemplate.get(id) as { count: number }
      return row.count > 0
    },
    insertTemplate(record: TemplateRecord & { data: Buffer }) {
      insertTemplate.run(
        record.id,
        record.categoryId,
        record.fileName,
        record.mimeType,
        record.sizeBytes,
        record.addedAt,
        JSON.stringify(record.placeholders),
        record.origin,
        record.data,
      )
    },
    listTemplates(categoryId?: string) {
      const rows = (
        categoryId ? listTemplatesByCategory.all(categoryId) : listTemplates.all()
      ) as TemplateRow[]
      return rows.map((row) => mapTemplate(row, false))
    },
    getTemplateFile(id: string) {
      const row = getTemplateFile.get(id) as TemplateRow | undefined
      return row ? mapTemplate(row, true) : null
    },
    deleteTemplate(id: string) {
      return deleteTemplate.run(id).changes
    },
    deleteUserSessions(userId: string) {
      deleteUserSessions.run(userId)
    },
    insertAudit(
      actorUsername: string,
      action: 'upload' | 'delete',
      templateId: string,
      fileName: string,
      categoryId: string,
    ) {
      insertAudit.run(
        new Date().toISOString(),
        actorUsername,
        action,
        templateId,
        fileName,
        categoryId,
      )
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
