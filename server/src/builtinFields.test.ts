import { execFileSync } from 'node:child_process'
import {
  closeSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createQueries, migrate, openDatabase, type AppDatabase } from './db.ts'
import {
  applyRemoveBaseName,
  ensureBuiltinFieldsSchema,
  removeBaseNameId,
  revertRemoveBaseName,
} from './builtinFields.ts'

function existing() {
  const db = openDatabase(':memory:')
  migrate(db)
  // Model the previous release plus an existing deployment-specific built-in setting.
  db.prepare('DELETE FROM data_adjustments WHERE id = ?').run(removeBaseNameId)
  db.prepare('DELETE FROM audit_log').run()
  for (const id of ['absent', 'on', 'off'])
    db.prepare('INSERT INTO categories(id, name, updated_at) VALUES (?, ?, ?)').run(
      id,
      `Mock ${id}`,
      'old',
    )
  ensureBuiltinFieldsSchema(db)
  db.prepare(
    "INSERT INTO category_builtin_fields VALUES ('on', '姓名', 1), ('off', '姓名', 0), ('on', '其他', 1)",
  ).run()
  db.prepare(
    "INSERT INTO category_fields VALUES ('manual', 'absent', '姓名', '姓名', 'text', 'base')",
  ).run()
  db.prepare(
    "INSERT INTO category_steps(id, category_id, sort_order, body, details) VALUES ('s', 'absent', 0, 'Mock', '{}')",
  ).run()
  db.prepare(
    "INSERT INTO base_step_refs(category_id, step_id, sort_order) VALUES ('absent', 's', 0)",
  ).run()
  db.prepare(
    "INSERT INTO templates VALUES ('t', 'Mock.docx', 'mock/docx', 4, 'old', '[\"姓名\"]', 'upload', ?)",
  ).run(Buffer.from('Mock'))
  db.prepare("INSERT INTO step_templates VALUES ('s', 't', 0)").run()
  db.prepare("INSERT INTO step_parallel_settings VALUES ('s', 0)").run()
  db.prepare(
    "INSERT INTO category_modules(id, category_id, name, sort_order) VALUES ('m', 'absent', 'Mock 模組', 0)",
  ).run()
  db.prepare(
    "INSERT INTO module_step_refs(module_id, step_id, sort_order) VALUES ('m', 's', 0)",
  ).run()
  db.prepare('INSERT INTO category_combination_orders VALUES (?, ?, ?)').run(
    'absent',
    '["m"]',
    '["s"]',
  )
  return db
}
function otherRows(db: AppDatabase) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[]
  return tables
    .filter(
      ({ name }) =>
        !['category_builtin_fields', 'data_adjustments', 'audit_log', 'sqlite_sequence'].includes(
          name,
        ),
    )
    .map(({ name }) => ({
      name,
      rows: db.prepare(`SELECT rowid, * FROM "${name}" ORDER BY rowid`).all(),
    }))
}

describe('reversible built-in name adjustment', () => {
  it('applies once through migrate, snapshots all previous settings, audits actor/time/count and preserves every other table row', () => {
    const db = existing()
    try {
      const before = otherRows(db)
      migrate(db)
      migrate(db)
      expect(applyRemoveBaseName(db)).toBe(false)
      expect(otherRows(db)).toEqual(before)
      expect(
        db.prepare("SELECT enabled FROM category_builtin_fields WHERE field_key = '姓名'").all(),
      ).toEqual([{ enabled: 0 }, { enabled: 0 }, { enabled: 0 }])
      const record = db.prepare('SELECT * FROM data_adjustments').get() as {
        payload: string
        applied_at: string
        actor: string
      }
      expect(JSON.parse(record.payload)).toEqual([
        { categoryId: 'absent', enabled: null },
        { categoryId: 'off', enabled: 0 },
        { categoryId: 'on', enabled: 1 },
      ])
      expect(record.applied_at).toMatch(/^\d{4}-/)
      expect(record.actor).toBe('system/migration')
      const audit = db
        .prepare('SELECT actor_username, created_at, detail FROM audit_log')
        .all() as { actor_username: string; created_at: string; detail: string }[]
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({
        actor_username: 'system/migration',
        created_at: record.applied_at,
      })
      expect(JSON.parse(audit[0]!.detail)).toMatchObject({
        operation: 'apply',
        affectedCategories: 3,
      })
    } finally {
      db.close()
    }
  })
  it('restores absent/on/off settings exactly, audits recovery, never reapplies after recovery and preserves data (9)', () => {
    const db = existing()
    try {
      const before = otherRows(db)
      const settings = db
        .prepare('SELECT * FROM category_builtin_fields ORDER BY category_id, field_key')
        .all()
      expect(applyRemoveBaseName(db)).toBe(true)
      expect(revertRemoveBaseName(db, 'Mock 維運')).toBe(true)
      expect(revertRemoveBaseName(db, 'Mock 維運')).toBe(false)
      migrate(db)
      expect(applyRemoveBaseName(db)).toBe(false)
      expect(
        db.prepare('SELECT * FROM category_builtin_fields ORDER BY category_id, field_key').all(),
      ).toEqual(settings)
      expect(otherRows(db)).toEqual(before)
      expect(createQueries(db).getCategory('absent')?.builtinFields).toEqual({ 姓名: true })
      expect(createQueries(db).getCategory('off')?.builtinFields).toEqual({ 姓名: false })
      expect(db.prepare('SELECT reverted_at FROM data_adjustments').get()).toEqual({
        reverted_at: expect.any(String),
      })
      expect(
        db.prepare("SELECT actor_username FROM audit_log WHERE detail LIKE '%revert%'").all(),
      ).toEqual([{ actor_username: 'Mock 維運' }])
    } finally {
      db.close()
    }
  })
  it('defaults new categories to no name even after a historical recovery, retaining a manually added name', () => {
    const db = existing()
    try {
      applyRemoveBaseName(db)
      revertRemoveBaseName(db, 'Mock')
      const queries = createQueries(db)
      queries.createCategory(
        {
          id: 'new',
          name: 'Mock 新案類',
          code: '',
          summary: '',
          updatedAt: '',
          steps: [],
          fields: [
            {
              id: 'new-name',
              categoryId: 'new',
              name: '姓名',
              key: '姓名',
              type: 'text',
              scope: 'base',
            },
          ],
        },
        'Mock',
      )
      expect(queries.getCategory('new')).toMatchObject({
        builtinFields: { 姓名: false },
        fields: [{ key: '姓名', scope: 'base' }],
      })
      migrate(db)
      expect(queries.getCategory('new')?.builtinFields).toEqual({ 姓名: false })
    } finally {
      db.close()
    }
  })
  it('rolls back settings and migration record if audit fails', () => {
    const db = existing()
    try {
      const settings = db
        .prepare('SELECT * FROM category_builtin_fields ORDER BY category_id')
        .all()
      db.exec(
        "CREATE TRIGGER reject_adjustment BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'Mock audit failure'); END",
      )
      expect(() => applyRemoveBaseName(db)).toThrow('Mock audit failure')
      expect(
        db.prepare('SELECT * FROM category_builtin_fields ORDER BY category_id').all(),
      ).toEqual(settings)
      expect(db.prepare('SELECT * FROM data_adjustments').all()).toEqual([])
    } finally {
      db.close()
    }
  })
})

it('rolls back a failed recovery audit and skips deleted categories without resurrecting any rows', () => {
  const db = existing()
  try {
    applyRemoveBaseName(db)
    db.exec(
      "CREATE TRIGGER reject_recovery BEFORE INSERT ON audit_log WHEN NEW.detail LIKE '%revert%' BEGIN SELECT RAISE(ABORT, 'Mock audit failure'); END",
    )
    expect(() => revertRemoveBaseName(db, 'Mock')).toThrow('Mock audit failure')
    expect(db.prepare('SELECT reverted_at FROM data_adjustments').get()).toEqual({
      reverted_at: null,
    })
    expect(createQueries(db).getCategory('on')?.builtinFields!['姓名']).toBe(false)
    db.exec('DROP TRIGGER reject_recovery')
    db.prepare("DELETE FROM categories WHERE id = 'off'").run()
    expect(revertRemoveBaseName(db, 'Mock')).toBe(true)
    expect(createQueries(db).getCategory('off')).toBeNull()
    expect(
      db.prepare("SELECT * FROM category_builtin_fields WHERE category_id = 'off'").all(),
    ).toEqual([])
  } finally {
    db.close()
  }
})

it('runs the shipped recovery CLI with isolated server .env precedence, repeat protection, relative paths and no secret output', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'Mock-name-cli-'))
  const db = existing()
  try {
    // Copy the shipped sources unchanged; operator .env files must never redirect this fixture.
    mkdirSync(path.join(dir, 'server/src'), { recursive: true })
    mkdirSync(path.join(dir, 'server/scripts'))
    writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}')
    symlinkSync(path.resolve('server/node_modules'), path.join(dir, 'server/node_modules'), 'dir')
    for (const file of ['db', 'config', 'modules', 'builtinFields'])
      copyFileSync(`server/src/${file}.ts`, path.join(dir, `server/src/${file}.ts`))
    const script = path.join(dir, 'server/scripts/revert-remove-base-name.ts')
    copyFileSync('server/scripts/revert-remove-base-name.ts', script)
    writeFileSync(
      path.join(dir, '.env'),
      'DATABASE_PATH=../wrong.sqlite\nSESSION_SECRET=Mock-secret-never-log\n',
    )
    writeFileSync(path.join(dir, 'server/.env'), 'DATABASE_PATH=../Mock.sqlite\n')
    const databasePath = path.join(dir, 'Mock.sqlite')
    applyRemoveBaseName(db)
    await db.backup(databasePath)
    const log = path.join(dir, 'output.txt')
    function run() {
      const fd = openSync(log, 'w')
      try {
        execFileSync(process.execPath, ['--experimental-strip-types', script, 'Mock 維運'], {
          stdio: ['inherit', fd, fd],
          env: { ...process.env, DATABASE_PATH: '../also-wrong.sqlite' },
        })
      } finally {
        closeSync(fd)
      }
      return readFileSync(log, 'utf8')
    }
    expect(run()).toBe('已回復內建姓名設定並寫入稽核紀錄。\n')
    expect(run()).toBe('無待回復的姓名調整。\n')
    const restored = openDatabase(databasePath)
    try {
      expect(createQueries(restored).getCategory('absent')?.builtinFields).toEqual({ 姓名: true })
      expect(
        restored.prepare("SELECT actor_username FROM audit_log WHERE detail LIKE '%revert%'").all(),
      ).toEqual([{ actor_username: 'Mock 維運' }])
      migrate(restored)
      expect(createQueries(restored).getCategory('absent')?.builtinFields).toEqual({ 姓名: true })
    } finally {
      restored.close()
    }
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
