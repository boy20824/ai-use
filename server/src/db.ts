import Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

export type AppDatabase = Database.Database

export type Role = 'sysadmin' | 'user'

export type AuditAction =
  | 'upload'
  | 'delete'
  | 'category_create'
  | 'category_update'
  | 'category_delete'
  | 'member_list'
  | 'member_create'
  | 'member_update'
  | 'feedback_update'
  | 'feedback_delete'
  | 'feedback_moderate'

export type FeedbackStatus = 'pending' | 'in_progress' | 'done'

const auditActionsSql = `'upload', 'delete', 'category_create', 'category_update', 'category_delete', 'member_list', 'member_create', 'member_update', 'feedback_update', 'feedback_delete', 'feedback_moderate'`

export type AuditResult = 'allowed' | 'denied'

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
  nickname: string
  role: Role
  canManageCategories: boolean
  active: boolean
  createdAt: string
}

export interface NewUserInput {
  id: string
  username: string
  passwordHash: string
  displayName: string
  nickname: string
  role: Role
  canManageCategories?: boolean
  active?: boolean
  createdAt?: string
}

export interface MemberPatch {
  active?: boolean
  canManageCategories?: boolean
  role?: Role
}

export type MemberUpdateError = 'not-found' | 'self-disable' | 'self-demote' | 'last-sysadmin'

export type MemberUpdateResult =
  { ok: true; user: UserRecord } | { ok: false; error: MemberUpdateError }

export interface FeedbackRecord {
  id: string
  authorId: string
  authorNickname: string
  title: string
  content: string
  status: FeedbackStatus
  adminReply: string
  createdAt: string
  updatedAt: string
}

export interface FeedbackPatch {
  title?: string
  content?: string
  status?: FeedbackStatus
  adminReply?: string
}

export interface CategoryStepRecord {
  id: string
  body: string
  templateIds: string[]
}

export interface TemplateUsage {
  categoryId: string
  categoryName: string
  stepId: string
  stepBody: string
  sortOrder: number
}

export interface CategoryRecord {
  id: string
  code: string
  name: string
  summary: string
  updatedAt: string
  steps: CategoryStepRecord[]
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
  usages: TemplateUsage[]
  data?: Buffer
}

export interface StepInput {
  id: string
  body: string
  templateIds: string[]
}

export interface CategoryInput {
  id: string
  code: string
  name: string
  summary: string
  updatedAt: string
  steps: StepInput[]
}

interface UserRow {
  id: string
  username: string
  password_hash: string
  display_name: string
  nickname: string
  role: Role
  can_manage_categories: number
  active: number
  created_at: string
}

interface FeedbackRow {
  id: string
  author_id: string
  author_nickname: string
  title: string
  content: string
  status: FeedbackStatus
  admin_reply: string
  created_at: string
  updated_at: string
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
  id: string
  categoryId: string
  body: string
}

interface StepTemplateRow {
  stepId: string
  templateId: string
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

interface UsageRow {
  template_id: string
  category_id: string
  category_name: string
  step_id: string
  step_body: string
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
    nickname: row.nickname,
    role: row.role,
    canManageCategories: row.can_manage_categories === 1,
    active: row.active === 1,
    createdAt: row.created_at,
  }
}

function mapFeedback(row: FeedbackRow): FeedbackRecord {
  return {
    id: row.id,
    authorId: row.author_id,
    authorNickname: row.author_nickname,
    title: row.title,
    content: row.content,
    status: row.status,
    adminReply: row.admin_reply,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function roleLabel(role: Role): string {
  return role === 'sysadmin' ? '系統管理員' : '一般使用者'
}

const userSelect = `id, username, password_hash, display_name, nickname, role, can_manage_categories, active, created_at`

function mapCategory(row: CategoryRow, steps: CategoryStepRecord[]): CategoryRecord {
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
  usages: TemplateUsage[],
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
    usages,
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

function tableExists(db: AppDatabase, table: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { ok: number } | undefined
  return Boolean(row)
}

function columnNames(db: AppDatabase, table: string): string[] {
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
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    nickname TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('sysadmin', 'user')),
    can_manage_categories INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_categories IN (0, 1)),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL
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
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    body TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS category_steps_by_category ON category_steps(category_id, sort_order);
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
  CREATE TABLE IF NOT EXISTS step_templates (
    step_id TEXT NOT NULL REFERENCES category_steps(id) ON DELETE CASCADE,
    template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    PRIMARY KEY (step_id, template_id)
  );
  CREATE INDEX IF NOT EXISTS step_templates_by_template ON step_templates(template_id);
`

const auditTable = `
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    actor_username TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN (${auditActionsSql})),
    template_id TEXT NOT NULL DEFAULT '',
    file_name TEXT NOT NULL DEFAULT '',
    category_id TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    result TEXT NOT NULL DEFAULT 'allowed',
    target_username TEXT NOT NULL DEFAULT ''
  );
`

const feedbackTable = `
  CREATE TABLE IF NOT EXISTS feedback_posts (
    id TEXT PRIMARY KEY,
    author_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done')),
    admin_reply TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS feedback_posts_by_status ON feedback_posts(status, created_at);
  CREATE INDEX IF NOT EXISTS feedback_posts_by_author ON feedback_posts(author_id);
`

const registerEventsTable = `
  CREATE TABLE IF NOT EXISTS register_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS register_events_by_ip ON register_events(ip, created_at);
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

        CREATE TABLE category_steps (
          category_id TEXT NOT NULL,
          sort_order INTEGER NOT NULL,
          body TEXT NOT NULL,
          PRIMARY KEY (category_id, sort_order)
        );
        CREATE TABLE category_templates (
          category_id TEXT NOT NULL,
          template_id TEXT NOT NULL,
          sort_order INTEGER NOT NULL,
          PRIMARY KEY (category_id, template_id)
        );

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
          detail TEXT NOT NULL DEFAULT '',
          result TEXT NOT NULL DEFAULT 'allowed'
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

function needsStepLinkMigration(db: AppDatabase): boolean {
  if (tableExists(db, 'category_templates')) return true
  return tableExists(db, 'category_steps') && !columnNames(db, 'category_steps').includes('id')
}

function upgradeStepLinks(db: AppDatabase) {
  const stepsHaveId = columnNames(db, 'category_steps').includes('id')
  const oldSteps = (
    tableExists(db, 'category_steps')
      ? stepsHaveId
        ? db
            .prepare(
              'SELECT id, category_id, sort_order, body FROM category_steps ORDER BY category_id, sort_order, id',
            )
            .all()
        : db
            .prepare(
              'SELECT category_id, sort_order, body FROM category_steps ORDER BY category_id, sort_order',
            )
            .all()
      : []
  ) as { id?: string; category_id: string; sort_order: number; body: string }[]
  const oldLinks = (
    tableExists(db, 'category_templates')
      ? db
          .prepare(
            'SELECT category_id, template_id, sort_order FROM category_templates ORDER BY category_id, sort_order, template_id',
          )
          .all()
      : []
  ) as { category_id: string; template_id: string; sort_order: number }[]

  db.pragma('foreign_keys = OFF')
  try {
    const apply = db.transaction(() => {
      if (!stepsHaveId) {
        db.exec(`
          CREATE TABLE category_steps_next (
            id TEXT PRIMARY KEY,
            category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
            sort_order INTEGER NOT NULL,
            body TEXT NOT NULL
          );
        `)
        const insertStep = db.prepare(
          'INSERT INTO category_steps_next (id, category_id, sort_order, body) VALUES (?, ?, ?, ?)',
        )
        for (const step of oldSteps) {
          insertStep.run(
            randomBytes(16).toString('hex'),
            step.category_id,
            step.sort_order,
            step.body,
          )
        }
        db.exec(`
          DROP TABLE IF EXISTS category_steps;
          ALTER TABLE category_steps_next RENAME TO category_steps;
          CREATE INDEX IF NOT EXISTS category_steps_by_category ON category_steps(category_id, sort_order);
        `)
      }

      db.exec(`
        CREATE TABLE IF NOT EXISTS step_templates (
          step_id TEXT NOT NULL REFERENCES category_steps(id) ON DELETE CASCADE,
          template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
          sort_order INTEGER NOT NULL,
          PRIMARY KEY (step_id, template_id)
        );
        CREATE INDEX IF NOT EXISTS step_templates_by_template ON step_templates(template_id);
      `)

      const firstStep = db.prepare(
        'SELECT id FROM category_steps WHERE category_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1',
      )
      const insertStep = db.prepare(
        'INSERT INTO category_steps (id, category_id, sort_order, body) VALUES (?, ?, ?, ?)',
      )
      const insertLink = db.prepare(
        'INSERT OR IGNORE INTO step_templates (step_id, template_id, sort_order) VALUES (?, ?, ?)',
      )
      const grouped = new Map<string, { template_id: string; sort_order: number }[]>()
      for (const link of oldLinks) {
        const list = grouped.get(link.category_id) ?? []
        list.push({ template_id: link.template_id, sort_order: link.sort_order })
        grouped.set(link.category_id, list)
      }
      for (const [categoryId, links] of grouped) {
        let step = firstStep.get(categoryId) as { id: string } | undefined
        if (!step) {
          const id = randomBytes(16).toString('hex')
          insertStep.run(id, categoryId, 0, '產生文件')
          step = { id }
        }
        const stepId = step.id
        links
          .sort(
            (left, right) =>
              left.sort_order - right.sort_order ||
              left.template_id.localeCompare(right.template_id),
          )
          .forEach((link, index) => insertLink.run(stepId, link.template_id, index))
      }
      db.exec('DROP TABLE IF EXISTS category_templates')
    })
    apply()
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

function tableSql(db: AppDatabase, table: string): string {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { sql: string } | undefined
  return row?.sql ?? ''
}

function mappedRole(username: string, role: string): Role {
  if (username.toLowerCase() === 'boy20824') return 'sysadmin'
  if (role === 'admin' || role === 'sysadmin') return 'sysadmin'
  return 'user'
}

function needsAccountUpgrade(db: AppDatabase): boolean {
  if (!tableExists(db, 'users')) return false
  const sql = tableSql(db, 'users')
  if (!sql.includes("'sysadmin'")) return true
  const names = new Set(columnNames(db, 'users'))
  return ['nickname', 'can_manage_categories', 'active', 'created_at'].some(
    (name) => !names.has(name),
  )
}

function upgradeAccounts(db: AppDatabase) {
  if (!needsAccountUpgrade(db)) return
  const names = new Set(columnNames(db, 'users'))
  const rows = db.prepare('SELECT * FROM users').all() as Record<string, unknown>[]
  const createdAt = new Date().toISOString()
  db.pragma('foreign_keys = OFF')
  try {
    const apply = db.transaction(() => {
      db.exec(`
        CREATE TABLE users_next (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL COLLATE NOCASE UNIQUE,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          nickname TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('sysadmin', 'user')),
          can_manage_categories INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_categories IN (0, 1)),
          active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
          created_at TEXT NOT NULL
        );
      `)
      const insert = db.prepare(`
        INSERT INTO users_next (
          id, username, password_hash, display_name, nickname, role,
          can_manage_categories, active, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const row of rows) {
        const username = String(row.username ?? '')
        const displayName = String(row.display_name ?? username)
        const nicknameRaw = names.has('nickname') ? String(row.nickname ?? '').trim() : ''
        const canManage =
          names.has('can_manage_categories') && Number(row.can_manage_categories) === 1 ? 1 : 0
        const active = names.has('active') && Number(row.active) === 0 ? 0 : 1
        const created =
          names.has('created_at') && String(row.created_at ?? '').length > 0
            ? String(row.created_at)
            : createdAt
        insert.run(
          row.id,
          username,
          row.password_hash,
          displayName,
          nicknameRaw || displayName,
          mappedRole(username, String(row.role ?? '')),
          canManage,
          active,
          created,
        )
      }
      db.exec('DROP TABLE users')
      db.exec('ALTER TABLE users_next RENAME TO users')
    })
    apply()
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

function needsAuditUpgrade(db: AppDatabase): boolean {
  if (!tableExists(db, 'audit_log')) return false
  const names = new Set(columnNames(db, 'audit_log'))
  if (!names.has('result') || !names.has('detail') || !names.has('target_username')) return true
  return !tableSql(db, 'audit_log').includes("'member_update'")
}

function ensureAuditSchema(db: AppDatabase) {
  if (!tableExists(db, 'audit_log')) {
    db.exec(auditTable)
    return
  }
  if (!needsAuditUpgrade(db)) return
  const names = new Set(columnNames(db, 'audit_log'))
  const rows = db.prepare('SELECT * FROM audit_log').all() as Record<string, unknown>[]
  const apply = db.transaction(() => {
    db.exec(`
      CREATE TABLE audit_log_next (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        actor_username TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN (${auditActionsSql})),
        template_id TEXT NOT NULL DEFAULT '',
        file_name TEXT NOT NULL DEFAULT '',
        category_id TEXT NOT NULL DEFAULT '',
        detail TEXT NOT NULL DEFAULT '',
        result TEXT NOT NULL DEFAULT 'allowed',
        target_username TEXT NOT NULL DEFAULT ''
      );
    `)
    const insert = db.prepare(`
      INSERT INTO audit_log_next (
        id, created_at, actor_username, action, template_id, file_name, category_id, detail, result,
        target_username
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const row of rows) {
      insert.run(
        row.id,
        row.created_at,
        row.actor_username,
        row.action,
        row.template_id ?? '',
        names.has('file_name') ? (row.file_name ?? '') : '',
        row.category_id ?? '',
        names.has('detail') ? (row.detail ?? '') : '',
        names.has('result') && row.result ? row.result : 'allowed',
        names.has('target_username') ? (row.target_username ?? '') : '',
      )
    }
    db.exec('DROP TABLE audit_log')
    db.exec('ALTER TABLE audit_log_next RENAME TO audit_log')
  })
  apply()
}

function deleteSeededCategories(db: AppDatabase) {
  const removeStepLinks = db.prepare(`
    DELETE FROM step_templates
    WHERE step_id IN (SELECT id FROM category_steps WHERE category_id = ?)
  `)
  const removeSteps = db.prepare('DELETE FROM category_steps WHERE category_id = ?')
  const removeCategory = db.prepare('DELETE FROM categories WHERE id = ?')
  const apply = db.transaction(() => {
    for (const id of seededCategoryIds) {
      removeStepLinks.run(id)
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
  } else {
    if (isLegacySchema(db)) upgradeLegacySchema(db)
    if (needsStepLinkMigration(db)) upgradeStepLinks(db)
    db.exec(stepTable + linkTable)
    deleteSeededCategories(db)
  }
  ensureAuditSchema(db)
  upgradeAccounts(db)
  db.exec(feedbackTable + registerEventsTable)
}

export function isUniqueConstraint(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = 'code' in error ? String((error as { code?: string }).code ?? '') : ''
  if (code === 'SQLITE_CONSTRAINT_UNIQUE') return true
  const message = 'message' in error ? String((error as { message?: string }).message ?? '') : ''
  return message.includes('UNIQUE')
}

export function createQueries(db: AppDatabase) {
  const countUsers = db.prepare('SELECT COUNT(*) AS count FROM users')
  const insertUser = db.prepare(
    `INSERT INTO users (
      id, username, password_hash, display_name, nickname, role, can_manage_categories, active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const findUserByUsername = db.prepare(
    `SELECT ${userSelect} FROM users WHERE username = ? COLLATE NOCASE`,
  )
  const findUserById = db.prepare(`SELECT ${userSelect} FROM users WHERE id = ?`)
  const listUsers = db.prepare(
    `SELECT ${userSelect} FROM users ORDER BY created_at ASC, username COLLATE NOCASE ASC`,
  )
  const countOtherActiveSysadmins = db.prepare(
    `SELECT COUNT(*) AS count FROM users WHERE role = 'sysadmin' AND active = 1 AND id <> ?`,
  )
  const updateUserRow = db.prepare(
    'UPDATE users SET role = ?, can_manage_categories = ?, active = ? WHERE id = ?',
  )
  const insertSession = db.prepare(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)',
  )
  const findSession = db.prepare(`
    SELECT
      u.id, u.username, u.display_name, u.nickname, u.role, u.can_manage_categories, u.active,
      s.expires_at
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
      (
        SELECT COUNT(*)
        FROM step_templates st
        JOIN category_steps cs ON cs.id = st.step_id
        WHERE cs.category_id = categories.id
      ) AS templateCount
    FROM categories
  `)
  const listStepRows = db.prepare(`
    SELECT id, category_id AS categoryId, body
    FROM category_steps
    ORDER BY category_id, sort_order, id
  `)
  const listStepTemplateRows = db.prepare(`
    SELECT step_id AS stepId, template_id AS templateId
    FROM step_templates
    ORDER BY step_id, sort_order, template_id
  `)
  const getCategoryRow = db.prepare(`
    SELECT
      id,
      code,
      name,
      summary,
      updated_at AS updatedAt,
      (
        SELECT COUNT(*)
        FROM step_templates st
        JOIN category_steps cs ON cs.id = st.step_id
        WHERE cs.category_id = categories.id
      ) AS templateCount
    FROM categories
    WHERE id = ?
  `)
  const listStepsForCategory = db.prepare(
    'SELECT id, category_id AS categoryId, body FROM category_steps WHERE category_id = ? ORDER BY sort_order, id',
  )
  const listStepIds = db.prepare('SELECT id FROM category_steps WHERE category_id = ?')
  const getStepRow = db.prepare(
    'SELECT id, category_id AS categoryId, body FROM category_steps WHERE id = ?',
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
  const deleteStep = db.prepare('DELETE FROM category_steps WHERE id = ?')
  const upsertStep = db.prepare(`
    INSERT INTO category_steps (id, category_id, sort_order, body) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      category_id = excluded.category_id,
      sort_order = excluded.sort_order,
      body = excluded.body
  `)
  const deleteStepLinks = db.prepare('DELETE FROM step_templates WHERE step_id = ?')
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
    JOIN step_templates st ON st.template_id = t.id
    JOIN category_steps cs ON cs.id = st.step_id
    WHERE cs.category_id = ?
    GROUP BY t.id
    ORDER BY MIN(cs.sort_order), MIN(st.sort_order), t.id
  `)
  const getTemplateFile = db.prepare(
    'SELECT id, file_name, mime_type, size_bytes, added_at, placeholders, origin, data FROM templates WHERE id = ?',
  )
  const deleteTemplate = db.prepare('DELETE FROM templates WHERE id = ?')
  const listUsages = db.prepare(`
    SELECT
      st.template_id,
      c.id AS category_id,
      c.name AS category_name,
      cs.id AS step_id,
      cs.body AS step_body,
      st.sort_order
    FROM step_templates st
    JOIN category_steps cs ON cs.id = st.step_id
    JOIN categories c ON c.id = cs.category_id
    ORDER BY c.name COLLATE NOCASE, cs.sort_order, st.sort_order, st.template_id
  `)
  const insertLink = db.prepare(
    'INSERT INTO step_templates (step_id, template_id, sort_order) VALUES (?, ?, ?)',
  )
  const nextSort = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS sortOrder FROM step_templates WHERE step_id = ?',
  )
  const linkExists = db.prepare(
    'SELECT 1 AS ok FROM step_templates WHERE step_id = ? AND template_id = ?',
  )

  const insertAudit = db.prepare(
    `INSERT INTO audit_log (
      created_at, actor_username, action, template_id, file_name, category_id, detail, result,
      target_username
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertFeedback = db.prepare(`
    INSERT INTO feedback_posts (
      id, author_id, title, content, status, admin_reply, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pending', '', ?, ?)
  `)
  const listFeedbackRows = db.prepare(`
    SELECT
      p.id, p.author_id, u.nickname AS author_nickname, p.title, p.content, p.status,
      p.admin_reply, p.created_at, p.updated_at
    FROM feedback_posts p
    JOIN users u ON u.id = p.author_id
    WHERE (? IS NULL OR p.status = ?)
    ORDER BY p.created_at DESC, p.id DESC
  `)
  const getFeedbackRow = db.prepare(`
    SELECT
      p.id, p.author_id, u.nickname AS author_nickname, p.title, p.content, p.status,
      p.admin_reply, p.created_at, p.updated_at
    FROM feedback_posts p
    JOIN users u ON u.id = p.author_id
    WHERE p.id = ?
  `)
  const updateFeedbackRow = db.prepare(
    'UPDATE feedback_posts SET title = ?, content = ?, status = ?, admin_reply = ?, updated_at = ? WHERE id = ?',
  )
  const deleteFeedbackRow = db.prepare('DELETE FROM feedback_posts WHERE id = ?')
  const insertRegisterEvent = db.prepare(
    'INSERT INTO register_events (ip, created_at) VALUES (?, ?)',
  )
  const countRegisterByIp = db.prepare(
    'SELECT COUNT(*) AS count FROM register_events WHERE ip = ? AND created_at > ?',
  )
  const countRegisterGlobal = db.prepare(
    'SELECT COUNT(*) AS count FROM register_events WHERE created_at > ?',
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

  function templatesByStep(): Map<string, string[]> {
    const grouped = new Map<string, string[]>()
    for (const row of listStepTemplateRows.all() as StepTemplateRow[]) {
      const list = grouped.get(row.stepId) ?? []
      list.push(row.templateId)
      grouped.set(row.stepId, list)
    }
    return grouped
  }

  function stepsByCategory(): Map<string, CategoryStepRecord[]> {
    const templates = templatesByStep()
    const grouped = new Map<string, CategoryStepRecord[]>()
    for (const row of listStepRows.all() as StepRow[]) {
      const list = grouped.get(row.categoryId) ?? []
      list.push({ id: row.id, body: row.body, templateIds: templates.get(row.id) ?? [] })
      grouped.set(row.categoryId, list)
    }
    return grouped
  }

  function usagesByTemplate(): Map<string, TemplateUsage[]> {
    const grouped = new Map<string, TemplateUsage[]>()
    for (const row of listUsages.all() as UsageRow[]) {
      const list = grouped.get(row.template_id) ?? []
      list.push({
        categoryId: row.category_id,
        categoryName: row.category_name,
        stepId: row.step_id,
        stepBody: row.step_body,
        sortOrder: row.sort_order,
      })
      grouped.set(row.template_id, list)
    }
    return grouped
  }

  function hydrateTemplates(rows: TemplateRow[], includeData: boolean): TemplateRecord[] {
    const grouped = usagesByTemplate()
    return rows.map((row) => mapTemplate(row, grouped.get(row.id) ?? [], includeData))
  }

  function stepsFor(categoryId: string): CategoryStepRecord[] {
    const templates = templatesByStep()
    return (listStepsForCategory.all(categoryId) as StepRow[]).map((row) => ({
      id: row.id,
      body: row.body,
      templateIds: templates.get(row.id) ?? [],
    }))
  }

  function writeSteps(categoryId: string, steps: StepInput[]) {
    const existing = new Set((listStepIds.all(categoryId) as { id: string }[]).map((row) => row.id))
    const keep = new Set(steps.map((step) => step.id))
    for (const id of existing) {
      if (!keep.has(id)) deleteStep.run(id)
    }
    steps.forEach((step, index) => {
      upsertStep.run(step.id, categoryId, index, step.body)
      deleteStepLinks.run(step.id)
      step.templateIds.forEach((templateId, order) => insertLink.run(step.id, templateId, order))
    })
  }

  function writeAudit(
    actorUsername: string,
    action: AuditAction,
    templateId: string,
    fileName: string,
    categoryId: string,
    detail: string,
    result: AuditResult = 'allowed',
    targetUsername = '',
  ) {
    const denied = result === 'denied'
    insertAudit.run(
      new Date().toISOString(),
      actorUsername,
      action,
      templateId,
      denied ? '' : fileName,
      categoryId,
      denied ? '' : detail,
      denied ? 'denied' : 'allowed',
      targetUsername,
    )
  }

  return {
    countUsers() {
      const row = countUsers.get() as { count: number }
      return row.count
    },
    insertUser(input: NewUserInput) {
      insertUser.run(
        input.id,
        input.username,
        input.passwordHash,
        input.displayName,
        input.nickname,
        input.role,
        input.canManageCategories ? 1 : 0,
        input.active === false ? 0 : 1,
        input.createdAt ?? new Date().toISOString(),
      )
    },
    findUserByUsername(username: string) {
      const row = findUserByUsername.get(username) as UserRow | undefined
      return row ? mapUser(row) : null
    },
    findUserById(id: string) {
      const row = findUserById.get(id) as UserRow | undefined
      return row ? mapUser(row) : null
    },
    listUsers() {
      return (listUsers.all() as UserRow[]).map(mapUser)
    },
    updateMember(actorId: string, targetId: string, patch: MemberPatch): MemberUpdateResult {
      const apply = db.transaction((): MemberUpdateResult => {
        const current = findUserById.get(targetId) as UserRow | undefined
        if (!current) return { ok: false, error: 'not-found' }
        const target = mapUser(current)
        if (patch.active === false && target.id === actorId) {
          return { ok: false, error: 'self-disable' }
        }
        if (patch.role === 'user' && target.id === actorId && target.role === 'sysadmin') {
          return { ok: false, error: 'self-demote' }
        }
        const nextRole = patch.role ?? target.role
        const nextActive = patch.active ?? target.active
        const nextFlag = patch.canManageCategories ?? target.canManageCategories
        const remainsActiveSysadmin = nextRole === 'sysadmin' && nextActive
        if (!remainsActiveSysadmin) {
          const others = countOtherActiveSysadmins.get(target.id) as { count: number }
          if (others.count < 1) return { ok: false, error: 'last-sysadmin' }
        }
        const changes: string[] = []
        if (nextActive !== target.active) {
          changes.push(`狀態：${target.active ? '啟用' : '停用'} → ${nextActive ? '啟用' : '停用'}`)
        }
        if (nextFlag !== target.canManageCategories) {
          changes.push(
            `可維護類別：${target.canManageCategories ? '是' : '否'} → ${nextFlag ? '是' : '否'}`,
          )
        }
        if (nextRole !== target.role) {
          changes.push(`角色：${roleLabel(target.role)} → ${roleLabel(nextRole)}`)
        }
        if (changes.length === 0) return { ok: true, user: target }
        updateUserRow.run(nextRole, nextFlag ? 1 : 0, nextActive ? 1 : 0, target.id)
        if (target.active && !nextActive) deleteUserSessions.run(target.id)
        const actor = findUserById.get(actorId) as UserRow | undefined
        for (const change of changes) {
          writeAudit(
            actor?.username ?? '',
            'member_update',
            '',
            '',
            '',
            change,
            'allowed',
            target.username,
          )
        }
        const updated = findUserById.get(target.id) as UserRow | undefined
        if (!updated) return { ok: false, error: 'not-found' }
        return { ok: true, user: mapUser(updated) }
      })
      return apply()
    },
    insertSession(id: string, userId: string, expiresAt: string) {
      insertSession.run(id, userId, expiresAt)
    },
    findSession(id: string) {
      return findSession.get(id) as
        | {
            id: string
            username: string
            display_name: string
            nickname: string
            role: Role
            can_manage_categories: number
            active: number
            expires_at: string
          }
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
      return mapCategory(row, stepsFor(id))
    },
    stepIdsFor(categoryId: string) {
      return (listStepIds.all(categoryId) as { id: string }[]).map((row) => row.id)
    },
    getStep(id: string) {
      const row = getStepRow.get(id) as StepRow | undefined
      return row ? { id: row.id, categoryId: row.categoryId, body: row.body } : null
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
    insertTemplate(record: TemplateRecord & { data: Buffer }, stepId?: string) {
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
        if (stepId && !linkExists.get(stepId, record.id)) {
          const sort = nextSort.get(stepId) as { sortOrder: number }
          insertLink.run(stepId, record.id, sort.sortOrder)
          const step = getStepRow.get(stepId) as StepRow | undefined
          if (step) touchCategory.run(record.addedAt, step.categoryId)
        }
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
      result: AuditResult = 'allowed',
      targetUsername = '',
    ) {
      writeAudit(
        actorUsername,
        action,
        templateId,
        fileName,
        categoryId,
        detail,
        result,
        targetUsername,
      )
    },
    insertFeedback(record: {
      id: string
      authorId: string
      title: string
      content: string
      createdAt: string
    }) {
      insertFeedback.run(
        record.id,
        record.authorId,
        record.title,
        record.content,
        record.createdAt,
        record.createdAt,
      )
    },
    listFeedback(status?: FeedbackStatus) {
      const filter = status ?? null
      return (listFeedbackRows.all(filter, filter) as FeedbackRow[]).map(mapFeedback)
    },
    getFeedback(id: string) {
      const row = getFeedbackRow.get(id) as FeedbackRow | undefined
      return row ? mapFeedback(row) : null
    },
    updateFeedback(id: string, patch: FeedbackPatch) {
      const current = getFeedbackRow.get(id) as FeedbackRow | undefined
      if (!current) return null
      const updatedAt = new Date().toISOString()
      updateFeedbackRow.run(
        patch.title ?? current.title,
        patch.content ?? current.content,
        patch.status ?? current.status,
        patch.adminReply ?? current.admin_reply,
        updatedAt,
        id,
      )
      const row = getFeedbackRow.get(id) as FeedbackRow | undefined
      return row ? mapFeedback(row) : null
    },
    deleteFeedback(id: string) {
      return deleteFeedbackRow.run(id).changes > 0
    },
    consumeRegisterAttempt(
      ip: string,
      now: number,
      since: number,
      ipLimit: number,
      globalLimit: number,
    ) {
      const apply = db.transaction(() => {
        const byIp = countRegisterByIp.get(ip, since) as { count: number }
        const global = countRegisterGlobal.get(since) as { count: number }
        if (byIp.count >= ipLimit || global.count >= globalLimit) return false
        insertRegisterEvent.run(ip, now)
        return true
      })
      return apply()
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
