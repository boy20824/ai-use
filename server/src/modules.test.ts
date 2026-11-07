import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { migrate, openDatabase } from './db.ts'

it('maps old SQLite data twice without changing any old rows, and restores its online backup', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sop-migration-'))
  const db = openDatabase(path.join(dir, 'old.sqlite'))
  try {
    migrate(db)
    // Recreate the pre-module schema using the actual legacy tables, then seed Mock only.
    db.exec(
      'DROP TABLE module_step_refs; DROP TABLE base_step_refs; DROP TABLE category_modules; DROP TABLE config_migrations;',
    )
    db.prepare('INSERT INTO categories(id, name, updated_at) VALUES (?, ?, ?)').run(
      'general-assist',
      'Mock',
      'old',
    )
    db.prepare('INSERT INTO category_variants VALUES (?, ?, ?)').run(
      'v2',
      'general-assist',
      'Second ID, first row',
    )
    db.prepare('INSERT INTO category_variants VALUES (?, ?, ?)').run(
      'v1',
      'general-assist',
      'First ID, second row',
    )
    const insert = db.prepare(
      'INSERT INTO category_steps(id, category_id, sort_order, body, details) VALUES (?, ?, ?, ?, ?)',
    )
    insert.run('z', 'general-assist', 0, 'Z', '{"order":8,"variantIds":[],"extra":"preserve"}')
    insert.run('b', 'general-assist', 1, 'B', '{}')
    insert.run('a', 'general-assist', 2, 'A', '{"order":1}')
    insert.run('multi', 'general-assist', 3, 'Shared', '{"order":2,"variantIds":["v1","v2","v1"]}')
    db.prepare('INSERT INTO templates VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      't',
      'mock.docx',
      'application/octet-stream',
      4,
      'old',
      '[]',
      'upload',
      Buffer.from('mock'),
    )
    db.prepare('INSERT INTO step_templates VALUES (?, ?, ?)').run('multi', 't', 7)
    const tables = [
      'categories',
      'category_variants',
      'category_steps',
      'templates',
      'step_templates',
      'category_fields',
    ]
    const snapshot = () =>
      tables.map((t) => ({
        table: t,
        rows: db.prepare(`SELECT rowid, * FROM ${t} ORDER BY rowid`).all(),
      }))
    const before = snapshot()
    await db.backup(path.join(dir, 'backup.sqlite'))
    migrate(db)
    migrate(db)
    expect(snapshot()).toEqual(before)
    expect(
      db
        .prepare(
          'SELECT id, sort_order, source_rowid FROM category_modules ORDER BY sort_order, id',
        )
        .all(),
    ).toEqual([
      { id: 'v2', sort_order: 0, source_rowid: 1 },
      { id: 'v1', sort_order: 1, source_rowid: 2 },
    ])
    expect(
      db
        .prepare('SELECT step_id, sort_order FROM base_step_refs ORDER BY sort_order, step_id')
        .all(),
    ).toEqual([
      { step_id: 'a', sort_order: 1 },
      { step_id: 'b', sort_order: 1 },
      { step_id: 'z', sort_order: 8 },
    ])
    expect(
      db
        .prepare('SELECT module_id, step_id, sort_order FROM module_step_refs ORDER BY module_id')
        .all(),
    ).toEqual([
      { module_id: 'v1', step_id: 'multi', sort_order: 2 },
      { module_id: 'v2', step_id: 'multi', sort_order: 2 },
    ])
    db.prepare('DELETE FROM module_step_refs WHERE module_id = ?').run('v1')
    migrate(db)
    expect(db.prepare('SELECT COUNT(*) AS n FROM module_step_refs').get()).toEqual({ n: 1 })
    expect(db.pragma('foreign_key_check')).toEqual([])
    const backup = openDatabase(path.join(dir, 'backup.sqlite'))
    try {
      expect(backup.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
      for (const record of before)
        expect(backup.prepare(`SELECT rowid, * FROM ${record.table} ORDER BY rowid`).all()).toEqual(
          record.rows,
        )
      migrate(backup)
      expect(backup.prepare('SELECT COUNT(*) AS n FROM module_step_refs').get()).toEqual({ n: 2 })
    } finally {
      backup.close()
    }
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

it.each(['{"variantIds":["missing"]}', '{broken', '{"order":"1"}', '{"variantIds":["foreign"]}'])(
  'rolls back the entire migration on invalid old mapping: %s',
  (details) => {
    const db = openDatabase(':memory:')
    try {
      migrate(db)
      db.exec(
        'DROP TABLE module_step_refs; DROP TABLE base_step_refs; DROP TABLE category_modules; DROP TABLE config_migrations;',
      )
      db.prepare('INSERT INTO categories(id, name, updated_at) VALUES (?, ?, ?)').run(
        'c',
        'Mock',
        'old',
      )
      db.prepare('INSERT INTO categories(id, name, updated_at) VALUES (?, ?, ?)').run(
        'other',
        'Other Mock',
        'old',
      )
      db.prepare('INSERT INTO category_variants VALUES (?, ?, ?)').run('v', 'c', 'Mock module')
      db.prepare('INSERT INTO category_variants VALUES (?, ?, ?)').run(
        'foreign',
        'other',
        'Other Mock module',
      )
      db.prepare('INSERT INTO category_steps VALUES (?, ?, ?, ?, ?)').run(
        's',
        'c',
        1,
        'Mock step',
        details,
      )
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(() => migrate(db)).toThrow()
        expect(
          db
            .prepare(
              "SELECT name FROM sqlite_master WHERE name IN ('category_modules', 'base_step_refs', 'module_step_refs', 'config_migrations')",
            )
            .all(),
        ).toEqual([])
        expect(db.prepare('SELECT details FROM category_steps').get()).toEqual({ details })
        expect(db.prepare('SELECT COUNT(*) AS n FROM category_variants').get()).toEqual({ n: 2 })
      }
    } finally {
      db.close()
    }
  },
)

it('adds default-false parallel settings without rewriting legacy details and preserves explicit settings on repeated migration', () => {
  const db = openDatabase(':memory:')
  try {
    migrate(db)
    db.exec('DROP TABLE step_parallel_settings')
    db.prepare('INSERT INTO categories(id, name, updated_at) VALUES (?, ?, ?)').run(
      'c',
      'Mock',
      'old',
    )
    const details = '{"note":"Legacy note","extra":"preserve"}'
    db.prepare('INSERT INTO category_steps VALUES (?, ?, ?, ?, ?)').run(
      's',
      'c',
      0,
      'Legacy',
      details,
    )
    const before = db.prepare('SELECT * FROM category_steps').all()
    migrate(db)
    migrate(db)
    expect(db.prepare('SELECT * FROM category_steps').all()).toEqual(before)
    expect(db.prepare('SELECT * FROM step_parallel_settings').all()).toEqual([
      { step_id: 's', can_run_in_parallel: 0 },
    ])
    db.prepare('UPDATE step_parallel_settings SET can_run_in_parallel = 1 WHERE step_id = ?').run(
      's',
    )
    migrate(db)
    expect(db.prepare('SELECT * FROM step_parallel_settings').all()).toEqual([
      { step_id: 's', can_run_in_parallel: 1 },
    ])
    expect(db.prepare('SELECT * FROM category_steps').all()).toEqual(before)
    expect(db.pragma('foreign_key_check')).toEqual([])
  } finally {
    db.close()
  }
})
