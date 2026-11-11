import type { AppDatabase } from './db.ts'

export const removeBaseNameId = '2026-11-11-remove-base-name'
interface PreviousNameSetting {
  categoryId: string
  enabled: number | null
}

export function ensureBuiltinFieldsSchema(db: AppDatabase) {
  db.exec(`CREATE TABLE IF NOT EXISTS category_builtin_fields (
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    field_key TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
    PRIMARY KEY(category_id, field_key));
    CREATE TABLE IF NOT EXISTS data_adjustments (
    id TEXT PRIMARY KEY, applied_at TEXT NOT NULL, reverted_at TEXT NULL,
    actor TEXT NOT NULL, payload TEXT NOT NULL);`)
}

function audit(db: AppDatabase, actor: string, time: string, operation: string, count: number) {
  // Reuse category_update so historical audit constraints remain intact.
  db.prepare(
    `INSERT INTO audit_log(created_at, actor_username, action, detail)
    VALUES (?, ?, 'category_update', ?)`,
  ).run(
    time,
    actor,
    JSON.stringify({ adjustment: removeBaseNameId, operation, affectedCategories: count }),
  )
}

/** A completed or reverted adjustment is never automatically applied again. */
export function applyRemoveBaseName(db: AppDatabase, actor = 'system/migration'): boolean {
  return db.transaction(() => {
    ensureBuiltinFieldsSchema(db)
    if (db.prepare('SELECT id FROM data_adjustments WHERE id = ?').get(removeBaseNameId))
      return false
    const previous = db
      .prepare(
        `SELECT c.id AS categoryId, b.enabled
      FROM categories c LEFT JOIN category_builtin_fields b
      ON b.category_id = c.id AND b.field_key = '姓名' ORDER BY c.id`,
      )
      .all() as PreviousNameSetting[]
    const set = db.prepare(`INSERT INTO category_builtin_fields(category_id, field_key, enabled)
      VALUES (?, '姓名', 0) ON CONFLICT(category_id, field_key) DO UPDATE SET enabled = 0`)
    for (const entry of previous) set.run(entry.categoryId)
    const time = new Date().toISOString()
    db.prepare('INSERT INTO data_adjustments VALUES (?, ?, NULL, ?, ?)').run(
      removeBaseNameId,
      time,
      actor,
      JSON.stringify(previous),
    )
    audit(db, actor, time, 'apply', previous.length)
    return true
  })()
}

/** Restore absent settings as absent, and explicit settings exactly as recorded. */
export function revertRemoveBaseName(db: AppDatabase, actor: string): boolean {
  return db.transaction(() => {
    const record = db
      .prepare('SELECT payload, reverted_at FROM data_adjustments WHERE id = ?')
      .get(removeBaseNameId) as { payload: string; reverted_at: string | null } | undefined
    if (!record || record.reverted_at) return false
    const previous = JSON.parse(record.payload) as PreviousNameSetting[]
    let affected = 0
    for (const entry of previous) {
      if (!db.prepare('SELECT id FROM categories WHERE id = ?').get(entry.categoryId)) continue
      if (entry.enabled === null) {
        db.prepare(
          "DELETE FROM category_builtin_fields WHERE category_id = ? AND field_key = '姓名'",
        ).run(entry.categoryId)
      } else {
        db.prepare(
          `INSERT INTO category_builtin_fields VALUES (?, '姓名', ?)
          ON CONFLICT(category_id, field_key) DO UPDATE SET enabled = excluded.enabled`,
        ).run(entry.categoryId, entry.enabled)
      }
      affected++
    }
    const time = new Date().toISOString()
    db.prepare('UPDATE data_adjustments SET reverted_at = ? WHERE id = ?').run(
      time,
      removeBaseNameId,
    )
    audit(db, actor, time, 'revert', affected)
    return true
  })()
}
