import { migrateModules } from './modules.ts'
import Database from 'better-sqlite3'
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
  | 'password_change'
  | 'breach_check_unavailable'

export type FeedbackStatus = 'pending' | 'in_progress' | 'done'

const auditActionsSql = `'upload', 'delete', 'category_create', 'category_update', 'category_delete', 'member_list', 'member_create', 'member_update', 'feedback_update', 'feedback_delete', 'feedback_moderate', 'password_change', 'breach_check_unavailable'`

export type AuditResult = 'allowed' | 'denied'

/**
 * Historical built-in IDs retained for compatibility.
 * Migration preserves these rows, including any content users added.
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

export type CategoryGroup = 'criminal' | 'admin' | 'internal'
export interface VariantRecord {
  id: string
  categoryId: string
  name: string
}
export interface FieldDefRecord {
  id: string
  categoryId: string
  name: string
  key: string
  type: 'text' | 'number'
}
export interface StepDetails {
  categoryId?: string
  order?: number
  title?: string
  items?: string[]
  note?: string
  variantIds?: string[]
}
export interface CategoryStepRecord extends StepDetails {
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

export interface StepRef {
  stepId: string
  sortOrder: number
}
export interface ModuleRecord {
  id: string
  categoryId: string
  name: string
  sortOrder: number
  steps: StepRef[]
}

export interface CategoryRecord {
  baseSteps?: StepRef[]
  modules?: ModuleRecord[]
  group: CategoryGroup
  variants: VariantRecord[]
  fields: FieldDefRecord[]
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

export interface StepInput extends StepDetails {
  id: string
  body: string
  templateIds: string[]
}

export interface CategoryInput {
  group?: CategoryGroup
  variants?: VariantRecord[]
  fields?: FieldDefRecord[]
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
    group: 'criminal',
    variants: [],
    fields: [],
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

  CREATE TABLE IF NOT EXISTS password_change_attempts (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS password_attempts_user ON password_change_attempts(user_id, created_at);
  CREATE INDEX IF NOT EXISTS password_attempts_ip ON password_change_attempts(ip, created_at);

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

function needsStepLinkMigration(db: AppDatabase): boolean {
  return tableExists(db, 'category_steps') && !columnNames(db, 'category_steps').includes('id')
}

function tableSql(db: AppDatabase, table: string): string {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { sql: string } | undefined
  return row?.sql ?? ''
}

function needsAccountUpgrade(db: AppDatabase): boolean {
  if (!tableExists(db, 'users')) return false
  const sql = tableSql(db, 'users')
  if (/CHECK\s*\(\s*role\s+IN/i.test(sql) && !sql.includes("'sysadmin'")) return true
  const names = new Set(columnNames(db, 'users'))
  return ['nickname', 'can_manage_categories', 'active', 'created_at'].some(
    (name) => !names.has(name),
  )
}

function needsAuditUpgrade(db: AppDatabase): boolean {
  if (!tableExists(db, 'audit_log')) return false
  const names = new Set(columnNames(db, 'audit_log'))
  if (!names.has('result') || !names.has('detail') || !names.has('target_username')) return true
  return !tableSql(db, 'audit_log').includes("'breach_check_unavailable'")
}

function ensureAuditSchema(db: AppDatabase) {
  if (!tableExists(db, 'audit_log')) {
    db.exec(auditTable)
    return
  }
  if (!needsAuditUpgrade(db)) return
  if (
    /CHECK\s*\(\s*action\s+IN/i.test(tableSql(db, 'audit_log')) &&
    !tableSql(db, 'audit_log').includes("'breach_check_unavailable'")
  )
    throw new Error('Historical audit constraints require a separate upgrade; no data changed')
  const names = new Set(columnNames(db, 'audit_log'))
  for (const name of ['detail', 'result', 'target_username']) {
    if (!names.has(name))
      db.exec(
        `ALTER TABLE audit_log ADD COLUMN ${name} TEXT NOT NULL DEFAULT '${name === 'result' ? 'allowed' : ''}'`,
      )
  }
}

export function migrate(db: AppDatabase) {
  db.transaction(() => {
    db.exec(accountTables)
    if (!tableExists(db, 'categories')) {
      createCurrentSchema(db)
    } else {
      if (isLegacySchema(db))
        throw new Error(
          'Unsupported historical schema: restore a backup and upgrade separately; no data changed',
        )
      if (needsStepLinkMigration(db))
        throw new Error('Historical step IDs require an explicit mapping; no data changed')
      db.exec(stepTable + linkTable)
      // Built-in IDs may contain user content: never remove rows during migration.
    }
    ensureAuditSchema(db)
    if (needsAccountUpgrade(db)) throw new Error('Historical accounts require a separate upgrade')
    db.exec(feedbackTable + registerEventsTable)
    db.transaction(() => {
      if (!columnNames(db, 'categories').includes('group_name'))
        db.exec(
          "ALTER TABLE categories ADD COLUMN group_name TEXT NOT NULL DEFAULT 'criminal' CHECK(group_name IN ('criminal','admin','internal'))",
        )
      if (!columnNames(db, 'category_steps').includes('details'))
        db.exec("ALTER TABLE category_steps ADD COLUMN details TEXT NOT NULL DEFAULT '{}'")
      db.exec(`CREATE TABLE IF NOT EXISTS category_variants (
      id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL, UNIQUE(category_id, name));
      CREATE TABLE IF NOT EXISTS category_fields (
      id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL, key TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('text','number')),
      UNIQUE(category_id, key));`)
    })()
    migrateModules(db)
  })()
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
    const created: string[] = []
    steps.forEach((step, index) => {
      const isNew = !getStepRow.get(step.id)
      upsertStep.run(step.id, categoryId, index, step.body)
      if (isNew) {
        created.push(step.id)
        db.prepare(
          'INSERT INTO base_step_refs(category_id, step_id, sort_order) VALUES (?, ?, ?)',
        ).run(categoryId, step.id, step.order ?? index)
      }
      deleteStepLinks.run(step.id)
      step.templateIds.forEach((templateId, order) => insertLink.run(step.id, templateId, order))
    })
    return created
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

  function hydrateCategory(row: CategoryRow, steps: CategoryStepRecord[]): CategoryRecord {
    const category = mapCategory(row, steps)
    category.group = (
      db.prepare('SELECT group_name FROM categories WHERE id = ?').get(row.id) as {
        group_name: CategoryGroup
      }
    ).group_name
    category.variants = db
      .prepare(
        'SELECT id, category_id AS categoryId, name FROM category_variants WHERE category_id = ? ORDER BY rowid',
      )
      .all(row.id) as VariantRecord[]
    category.fields = db
      .prepare(
        'SELECT id, category_id AS categoryId, name, key, type FROM category_fields WHERE category_id = ? ORDER BY rowid',
      )
      .all(row.id) as FieldDefRecord[]
    category.steps = steps
      .map((step, index) => {
        const details = db
          .prepare('SELECT details FROM category_steps WHERE id = ?')
          .get(step.id) as { details: string }
        return {
          ...step,
          categoryId: row.id,
          order: index,
          title: step.body,
          items: [],
          note: '',
          variantIds: [],
          ...JSON.parse(details.details),
        }
      })
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    category.baseSteps = db
      .prepare(
        'SELECT step_id AS stepId, sort_order AS sortOrder FROM base_step_refs WHERE category_id = ? ORDER BY sort_order, step_id',
      )
      .all(row.id) as StepRef[]
    category.modules = (
      db
        .prepare(
          'SELECT id, category_id AS categoryId, name, sort_order AS sortOrder FROM category_modules WHERE category_id = ? ORDER BY sort_order, id',
        )
        .all(row.id) as ModuleRecord[]
    ).map((m) => ({
      ...m,
      steps: db
        .prepare(
          'SELECT step_id AS stepId, sort_order AS sortOrder FROM module_step_refs WHERE module_id = ? ORDER BY sort_order, step_id',
        )
        .all(m.id) as StepRef[],
    }))
    return category
  }
  function writeDetails(input: CategoryInput, created: string[]) {
    db.prepare('UPDATE categories SET group_name = ? WHERE id = ?').run(
      input.group ?? 'criminal',
      input.id,
    )
    if (input.variants) {
      const previous = new Set(
        (
          db.prepare('SELECT id FROM category_variants WHERE category_id = ?').all(input.id) as {
            id: string
          }[]
        ).map((v) => v.id),
      )
      db.prepare('DELETE FROM category_variants WHERE category_id = ?').run(input.id)
      for (const v of input.variants)
        db.prepare('INSERT INTO category_variants(id, category_id, name) VALUES (?, ?, ?)').run(
          v.id,
          input.id,
          v.name,
        )
      for (const [index, v] of input.variants.entries()) {
        if (
          !previous.has(v.id) &&
          !db.prepare('SELECT 1 FROM category_modules WHERE id = ?').get(v.id)
        )
          db.prepare(
            'INSERT INTO category_modules(id, category_id, name, sort_order) VALUES (?, ?, ?, ?)',
          ).run(v.id, input.id, v.name, index)
      }
    }
    if (input.fields) {
      db.prepare('DELETE FROM category_fields WHERE category_id = ?').run(input.id)
      for (const f of input.fields)
        db.prepare(
          'INSERT INTO category_fields(id, category_id, name, key, type) VALUES (?, ?, ?, ?, ?)',
        ).run(f.id, input.id, f.name, f.key, f.type)
    }
    for (const step of input.steps.filter((s) => created.includes(s.id) && s.variantIds?.length)) {
      db.prepare('DELETE FROM base_step_refs WHERE category_id = ? AND step_id = ?').run(
        input.id,
        step.id,
      )
      for (const id of new Set(step.variantIds))
        db.prepare('INSERT INTO module_step_refs VALUES (?, ?, ?)').run(
          id,
          step.id,
          step.order ?? input.steps.indexOf(step),
        )
    }
    input.steps.forEach((step, index) =>
      db.prepare('UPDATE category_steps SET details = ? WHERE id = ?').run(
        JSON.stringify({
          order: step.order ?? index,
          title: step.title ?? step.body,
          items: step.items ?? [],
          note: step.note ?? '',
          variantIds: step.variantIds ?? [],
        }),
        step.id,
      ),
    )
  }
  return {
    stepImpact(stepId: string) {
      return {
        base: db
          .prepare('SELECT category_id AS categoryId FROM base_step_refs WHERE step_id = ?')
          .all(stepId),
        modules: db
          .prepare(
            'SELECT m.id, m.name, m.category_id AS categoryId FROM module_step_refs r JOIN category_modules m ON m.id = r.module_id WHERE r.step_id = ? ORDER BY m.sort_order, m.id',
          )
          .all(stepId),
        templates: db
          .prepare(
            'SELECT template_id AS templateId FROM step_templates WHERE step_id = ? ORDER BY sort_order, template_id',
          )
          .all(stepId),
      }
    },
    configWrite(categoryId: string, actor: string, detail: string, apply: () => void | boolean) {
      db.transaction(() => {
        if (apply() === false) return
        writeAudit(actor, 'category_update', '', '', categoryId, detail)
      })()
    },
    deleteMember(id: string) {
      db.transaction(() => {
        const user = findUserById.get(id) as UserRow | undefined
        if (!user) return
        db.prepare('DELETE FROM feedback_posts WHERE author_id = ?').run(id)
        deleteUserSessions.run(id)
        db.prepare('DELETE FROM login_events WHERE username = ? COLLATE NOCASE').run(user.username)
        db.prepare('DELETE FROM users WHERE id = ?').run(id)
      })()
    },
    replaceTemplate(record: TemplateRecord & { data: Buffer }) {
      db.prepare(
        'UPDATE templates SET file_name = ?, mime_type = ?, size_bytes = ?, added_at = ?, placeholders = ?, origin = ?, data = ? WHERE id = ?',
      ).run(
        record.fileName,
        record.mimeType,
        record.sizeBytes,
        record.addedAt,
        JSON.stringify(record.placeholders),
        record.origin,
        record.data,
        record.id,
      )
    },
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
    consumePasswordChangeAttempt(userId: string, ip: string, now: number) {
      return db.transaction(() => {
        const after = now - 15 * 60_000
        db.prepare('DELETE FROM password_change_attempts WHERE created_at <= ?').run(after)
        const counts = db
          .prepare(
            `
          SELECT
            (SELECT COUNT(*) FROM password_change_attempts WHERE user_id = ?) AS per_user,
            (SELECT COUNT(*) FROM password_change_attempts WHERE ip = ?) AS per_ip
        `,
          )
          .get(userId, ip) as { per_user: number; per_ip: number }
        if (counts.per_user >= 5 || counts.per_ip >= 5) return false
        db.prepare(
          'INSERT INTO password_change_attempts (user_id, ip, created_at) VALUES (?, ?, ?)',
        ).run(userId, ip, now)
        return true
      })()
    },
    changePassword(user: UserRecord, currentSession: string, passwordHash: string) {
      return db.transaction(() => {
        const changed = db
          .prepare(
            `
          UPDATE users SET password_hash = ?
          WHERE id = ? AND password_hash = ? AND active = 1
            AND EXISTS (SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND expires_at > ?)
        `,
          )
          .run(
            passwordHash,
            user.id,
            user.passwordHash,
            currentSession,
            user.id,
            new Date().toISOString(),
          )
        if (changed.changes !== 1) return false
        db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(
          user.id,
          currentSession,
        )
        writeAudit(user.username, 'password_change', '', '', '', '', 'allowed', user.username)
        return true
      })()
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
        .map((row) => hydrateCategory(row, steps.get(row.id) ?? []))
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant'))
    },
    getCategory(id: string) {
      const row = getCategoryRow.get(id) as CategoryRow | undefined
      if (!row) return null
      return hydrateCategory(row, stepsFor(id))
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
        const created = writeSteps(input.id, input.steps)
        writeDetails(input, created)
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
        const created = writeSteps(input.id, input.steps)
        writeDetails(input, created)
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
