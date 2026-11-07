import type { AppDatabase } from './db.ts'

/** Additive, all-or-nothing mapping. Marker prevents resurrecting removed refs. */
export function migrateModules(db: AppDatabase) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS config_migrations (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS category_modules (
        id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        name TEXT NOT NULL, sort_order INTEGER NOT NULL, source_rowid INTEGER);
      CREATE TABLE IF NOT EXISTS base_step_refs (
        category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL REFERENCES category_steps(id), sort_order INTEGER NOT NULL,
        PRIMARY KEY(category_id, step_id));
      CREATE TABLE IF NOT EXISTS module_step_refs (
        module_id TEXT NOT NULL REFERENCES category_modules(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL REFERENCES category_steps(id), sort_order INTEGER NOT NULL,
        PRIMARY KEY(module_id, step_id));`)
    if (db.prepare('SELECT 1 FROM config_migrations WHERE id = ?').get('sop-modules-v1')) return
    const categories = db.prepare('SELECT id FROM categories ORDER BY id').all() as { id: string }[]
    for (const category of categories) {
      const variants = db
        .prepare(
          'SELECT id, name, rowid AS source FROM category_variants WHERE category_id = ? ORDER BY rowid',
        )
        .all(category.id) as { id: string; name: string; source: number }[]
      variants.forEach((v, i) =>
        db
          .prepare('INSERT INTO category_modules VALUES (?, ?, ?, ?, ?)')
          .run(v.id, category.id, v.name, i, v.source),
      )
      const steps = db
        .prepare(
          'SELECT id, details FROM category_steps WHERE category_id = ? ORDER BY sort_order, id',
        )
        .all(category.id) as { id: string; details: string }[]
      steps.forEach((step, index) => {
        const details = JSON.parse(step.details)
        if (!details || typeof details !== 'object' || Array.isArray(details))
          throw new Error(`Invalid step details: ${step.id}`)
        const order = details.order ?? index
        if (!Number.isSafeInteger(order) || order < 0)
          throw new Error(`Invalid step order: ${step.id}`)
        const ids = details.variantIds ?? []
        if (
          !Array.isArray(ids) ||
          ids.some((id) => typeof id !== 'string' || !variants.some((v) => v.id === id))
        )
          throw new Error(`Invalid variant mapping: ${step.id}`)
        if (!ids.length)
          db.prepare('INSERT INTO base_step_refs VALUES (?, ?, ?)').run(category.id, step.id, order)
        for (const id of new Set(ids))
          db.prepare('INSERT INTO module_step_refs VALUES (?, ?, ?)').run(id, step.id, order)
      })
    }
    db.prepare('INSERT INTO config_migrations VALUES (?)').run('sop-modules-v1')
  })()
}
