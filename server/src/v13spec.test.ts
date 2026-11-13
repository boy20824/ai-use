import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import PizZip from 'pizzip'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { buildDocx, kaiBoldRPr, paragraph, run, wordDocument } from '../../shared/docxFixture.ts'
import { renderDocx } from '../../shared/docxRender.ts'
import { buildApp } from './app.ts'
import type { AppConfig, SeedPasswords } from './config.ts'
import { createQueries, migrate, openDatabase, type AppDatabase } from './db.ts'
import { seedReferenceData } from './seed.ts'

const passwords: SeedPasswords = {
  clerk: 'clerk-pass',
  admin: 'admin-pass',
  viewer: 'viewer-pass',
}
const origin = 'http://localhost:5173'
const samplePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../public/samples/field-note.docx',
)
const scratch = mkdtempSync(path.join(tmpdir(), 'ai-use-v13spec-'))

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    databasePath: ':memory:',
    uploadDir: mkdtempSync(path.join(scratch, 'up-')),
    sessionSecret: '',
    sessionTtlHours: 1,
    cookieSecure: false,
    corsOrigins: [origin],
    maxUploadBytes: 1024 * 1024,
    maxZipEntries: 32,
    maxZipUncompressedBytes: 8 * 1024 * 1024,
    loginMaxFailures: 8,
    loginLockoutMinutes: 15,
    globalRatePerMinute: 120,
    loginRatePerMinute: 60,
    registerIpLimit: 5,
    registerGlobalLimit: 30,
    registerWindowMs: 60 * 60 * 1000,
    sampleTemplatePath: samplePath,
    seedSampleData: false,
    staticDir: undefined,
    trustProxy: false,
    seedDemoUsers: true,
    passwords,
    ...overrides,
  }
}

function multipart(name: string, data: Uint8Array) {
  const boundary = '----v13'
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return {
    payload,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

async function boot() {
  const appConfig = config()
  const db = openDatabase(':memory:')
  migrate(db)
  seedReferenceData(createQueries(db), passwords, samplePath, appConfig.uploadDir, false)
  const app = await buildApp(db, appConfig)
  return { app, db }
}

function cookieValue(response: { cookies: { name: string; value: string }[] }, name: string) {
  return response.cookies.find((cookie) => cookie.name === name)?.value ?? ''
}

async function login(
  app: Awaited<ReturnType<typeof boot>>['app'],
  username: keyof SeedPasswords = 'admin',
) {
  const csrfProbe = await app.inject({ method: 'GET', url: '/api/auth/me' })
  const csrf = cookieValue(csrfProbe, 'csrf')
  const signedIn = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: passwords[username] },
  })
  return {
    cookies: { session: cookieValue(signedIn, 'session'), csrf },
    headers: { origin, 'x-csrf-token': csrf },
  }
}

type App = Awaited<ReturnType<typeof boot>>['app']
type Auth = Awaited<ReturnType<typeof login>>
const resources: { app: App; db: AppDatabase }[] = []
async function setup() {
  const resource = await boot()
  resources.push(resource)
  return resource
}
afterEach(async () => {
  for (const r of resources.splice(0)) {
    await r.app.close()
    r.db.close()
  }
})
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
function request(
  app: App,
  auth: Auth,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
) {
  return app.inject({ method, url, payload, ...auth })
}
async function category(app: App, auth: Auth, name = '公共危險') {
  const response = await request(app, auth, 'POST', '/api/categories', { name, group: 'criminal' })
  expect(response.statusCode).toBe(201)
  return response.json().category as { id: string }
}
function documentBytes(text = '{{酒測值}}') {
  return buildDocx({ document: wordDocument(paragraph(run(kaiBoldRPr, text))) })
}
async function upload(app: App, auth: Auth) {
  const file = multipart('original.docx', documentBytes())
  const response = await app.inject({
    method: 'POST',
    url: '/api/templates',
    cookies: auth.cookies,
    headers: { ...auth.headers, ...file.headers },
    payload: file.payload,
  })
  expect(response.statusCode).toBe(201)
  return response.json().template.id as string
}

describe('v1.3 workflow spec', () => {
  it('migrates existing categories and preserves ids, old codes, step bodies and template links on repeated startup', () => {
    const db = openDatabase(':memory:')
    try {
      migrate(db)
      const q = createQueries(db)
      q.insertTemplate({
        kind: 'docx',
        id: 'document',
        fileName: 'mock.docx',
        mimeType: 'application/octet-stream',
        sizeBytes: 1,
        addedAt: 'now',
        placeholders: [],
        origin: 'upload',
        usages: [],
        data: Buffer.from('x'),
      })
      q.createCategory(
        {
          id: 'existing',
          code: 'old-code',
          name: '舊流程',
          summary: '',
          updatedAt: 'now',
          steps: [{ id: 'existing-step', body: '原步驟', templateIds: ['document'] }],
        },
        'mock',
      )
      db.exec(
        'DROP TABLE category_variants; DROP TABLE category_fields; ALTER TABLE categories DROP COLUMN group_name; ALTER TABLE category_steps DROP COLUMN details;',
      )
      migrate(db)
      migrate(db)
      expect(createQueries(db).getCategory('existing')).toMatchObject({
        id: 'existing',
        code: 'old-code',
        group: 'criminal',
        steps: [
          {
            id: 'existing-step',
            title: '原步驟',
            items: [],
            variantIds: [],
            templateIds: ['document'],
          },
        ],
      })
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally {
      db.close()
    }
  })

  it('supports variants, structured steps and field CRUD and rejects invalid references and field values', async () => {
    const { app, db } = await setup()
    const auth = await login(app)
    const c = await category(app, auth)
    expect(
      (await request(app, auth, 'GET', `/api/categories/${c.id}`)).json().category,
    ).not.toHaveProperty('code')
    const base = `/api/categories/${c.id}`
    const v = await request(app, auth, 'POST', `${base}/variants`, { name: '攔查' })
    expect(v.statusCode).toBe(201)
    const variantId = v.json().variant.id as string
    expect(
      (await request(app, auth, 'PATCH', `${base}/variants/${variantId}`, { name: '酒駕攔查' }))
        .statusCode,
    ).toBe(200)
    const f = await request(app, auth, 'POST', `${base}/fields`, {
      name: '酒測值',
      key: '酒測值',
      type: 'number',
    })
    expect(f.statusCode).toBe(201)
    const fieldId = f.json().field.id as string
    expect(
      (await request(app, auth, 'PATCH', `${base}/fields/${fieldId}`, { name: '酒測結果' }))
        .statusCode,
    ).toBe(200)
    const step = await request(app, auth, 'POST', `${base}/steps`, {
      order: 2,
      title: '開立罰單',
      items: ['細項一', '細項二'],
      note: '註明主動攔查',
      variantIds: [variantId],
      templateIds: [],
    })
    expect(step.statusCode).toBe(201)
    expect(step.json().step).toMatchObject({
      title: '開立罰單',
      order: 2,
      items: ['細項一', '細項二'],
      note: '註明主動攔查',
      variantIds: [variantId],
    })
    const stepId = step.json().step.id as string
    expect(
      (
        await request(app, auth, 'PUT', `${base}/steps/${stepId}`, {
          order: 0,
          title: '新標題',
          items: [],
          note: '',
          variantIds: [],
          templateIds: [],
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await request(app, auth, 'POST', `${base}/steps`, {
          title: '無效',
          variantIds: ['missing'],
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await request(app, auth, 'POST', `${base}/steps`, {
          title: '無效',
          templateIds: ['missing'],
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await request(app, auth, 'POST', `${base}/fields`, {
          key: '酒測值',
          type: 'number',
          value: '0.35',
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (await request(app, auth, 'POST', `${base}/fields`, { key: 'bad', type: 'date' })).statusCode,
    ).toBe(400)
    expect(
      (await request(app, auth, 'POST', `${base}/fields`, { key: '酒測結果', type: 'number' }))
        .statusCode,
    ).toBe(400)
    const other = await category(app, auth, '其他流程')
    expect(
      (
        await request(app, auth, 'PUT', `/api/categories/${other.id}`, {
          name: '其他流程',
          variants: [{ id: variantId, name: '盜用' }],
        })
      ).statusCode,
    ).toBe(400)
    expect((await request(app, auth, 'DELETE', `${base}/fields/${fieldId}`)).statusCode).toBe(204)
    // Legacy variant JSON is retained; entity deletion requires explicit reference handling.
    expect((await request(app, auth, 'DELETE', `${base}/variants/${variantId}`)).statusCode).toBe(
      409,
    )
    expect((await request(app, auth, 'DELETE', `${base}/steps/${stepId}`)).statusCode).toBe(409)
    expect(
      (await request(app, auth, 'DELETE', `${base}/refs/${variantId}/${stepId}`)).statusCode,
    ).toBe(200)
    expect(
      (await request(app, auth, 'DELETE', `${base}/steps/${stepId}`, { confirm: true })).statusCode,
    ).toBe(204)
    expect(JSON.stringify(db.prepare('SELECT * FROM category_fields').all())).not.toContain('0.35')
    expect(db.pragma('foreign_key_check')).toEqual([])
  })

  it('derives field keys, strips braces, validates keys and rejects duplicates without mutating the workflow', async () => {
    const { app } = await setup()
    const auth = await login(app)
    const c = await category(app, auth)
    const base = `/api/categories/${c.id}`
    const created = await request(app, auth, 'POST', `${base}/fields`, {
      name: '  酒測值  ',
      type: 'text',
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().field).toMatchObject({ name: '酒測值', key: '酒測值' })
    const braces = await request(app, auth, 'POST', `${base}/fields`, {
      name: '車牌',
      key: ' {{車牌}} ',
      type: 'text',
    })
    expect(braces.statusCode).toBe(201)
    expect(braces.json().field.key).toBe('車牌')
    for (const field of [
      { name: '酒測值', type: 'text' },
      { name: '其他名稱', key: '{{酒測值}}', type: 'number' },
    ]) {
      const duplicate = await request(app, auth, 'POST', `${base}/fields`, field)
      expect(duplicate.statusCode).toBe(400)
      expect(duplicate.json().message).toBe('同一流程的細項欄位鍵不可重複。')
    }
    for (const key of [
      'bad key',
      '<script>',
      '{{未關閉}',
      'constructor',
      '__proto__',
      '',
      'a'.repeat(81),
    ]) {
      const invalid = await request(app, auth, 'POST', `${base}/fields`, { key, type: 'text' })
      expect(invalid.statusCode).toBe(400)
      expect(invalid.json().message).toContain('細項欄位鍵須為')
    }
    const patched = await request(app, auth, 'PATCH', base, {
      name: '公共危險',
      variants: [],
      fields: [{ id: 'derived-field', name: ' 酒測值 ', type: 'number' }],
      steps: [{ title: '共同步驟', variantIds: [] }],
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().category).toMatchObject({
      variants: [],
      fields: [{ key: '酒測值' }],
      steps: [{ variantIds: [] }],
    })
    const duplicatePatch = await request(app, auth, 'PATCH', base, {
      name: '公共危險',
      fields: [
        { id: 'first', name: '酒測值', type: 'text' },
        { id: 'second', key: '{{酒測值}}', type: 'text' },
      ],
    })
    expect(duplicatePatch.statusCode).toBe(400)
    expect(duplicatePatch.json().message).toBe('同一流程的細項欄位鍵不可重複。')
    expect((await request(app, auth, 'GET', `${base}/fields`)).json().fields).toHaveLength(1)
    const variants = [
      { id: 'stop', name: '攔查' },
      { id: 'crash', name: '肇事' },
    ]
    const combined = await request(app, auth, 'PATCH', base, {
      name: '公共危險',
      variants,
      steps: [{ title: '需同時符合', variantIds: ['stop', 'crash'] }],
    })
    expect(combined.statusCode).toBe(200)
    expect(
      combined.json().category.steps.find((s: { title: string }) => s.title === '需同時符合')
        .variantIds,
    ).toEqual(['stop', 'crash'])
    expect(
      combined
        .json()
        .category.modules.every((m: { steps: { stepId: string }[] }) => m.steps.length === 1),
    ).toBe(true)
  })

  it('updates groups, ignores legacy user codes, and rolls back an invalid aggregate update', async () => {
    const { app } = await setup()
    const auth = await login(app)
    const c = await category(app, auth)
    const base = `/api/categories/${c.id}`
    expect(
      (
        await request(app, auth, 'PUT', base, {
          name: '行政流程',
          group: 'admin',
          code: 'user-code',
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (await request(app, auth, 'PATCH', base, { name: '內部流程', group: 'internal' })).json()
        .category,
    ).toMatchObject({ group: 'internal' })
    expect(
      (await request(app, auth, 'PUT', base, { name: '壞資料', group: 'other' })).statusCode,
    ).toBe(400)
    expect(
      (
        await request(app, auth, 'PUT', base, {
          name: '壞資料',
          steps: [{ title: '壞資料', variantIds: ['missing'] }],
        })
      ).statusCode,
    ).toBe(400)
    expect((await request(app, auth, 'GET', base)).json().category.name).toBe('內部流程')
  })

  it('replaces one template in three workflows, returns distinct linked count, and retains Word styling', async () => {
    const { app, db } = await setup()
    const auth = await login(app)
    const id = await upload(app, auth)
    for (let i = 0; i < 3; i++) {
      const c = await category(app, auth, `流程${i}`)
      const response = await request(app, auth, 'PUT', `/api/categories/${c.id}`, {
        name: `流程${i}`,
        steps: [
          { title: '共同', templateIds: [id] },
          { title: '第二步', templateIds: [id] },
        ],
      })
      expect(response.statusCode).toBe(200)
    }
    const file = multipart('../../replacement.docx', documentBytes('新版{{酒測值}}'))
    const replacement = await app.inject({
      method: 'PUT',
      url: `/api/templates/${id}/file`,
      cookies: auth.cookies,
      headers: { ...auth.headers, ...file.headers },
      payload: file.payload,
    })
    expect(replacement.statusCode).toBe(200)
    expect(replacement.json()).toMatchObject({
      linkedCategoryCount: 3,
      template: { id, fileName: 'replacement.docx' },
    })
    expect(replacement.json().template.usages).toHaveLength(6)
    const download = await request(app, auth, 'GET', `/api/templates/${id}/file`)
    const xml = new PizZip(renderDocx(download.rawPayload, { 酒測值: '0.35' }))
      .file('word/document.xml')!
      .asText()
    expect(xml).toContain('新版0.35')
    expect(xml).toContain('標楷體')
    expect(xml).toContain('<w:b/>')
    expect(db.prepare('SELECT COUNT(*) AS count FROM templates').get()).toEqual({ count: 1 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM step_templates').get()).toEqual({ count: 6 })
    expect(JSON.stringify(db.prepare('SELECT * FROM audit_log').all())).not.toContain('0.35')
  })

  it('rejects invalid and oversized replacements without altering the old file', async () => {
    const { app } = await setup()
    const auth = await login(app)
    const id = await upload(app, auth)
    const before = await request(app, auth, 'GET', `/api/templates/${id}/file`)
    for (const [name, bytes, status] of [
      ['bad.txt', documentBytes(), 400],
      ['bad.docx', new Uint8Array([80, 75, 0, 0]), 400],
      ['large.docx', new Uint8Array(1024 * 1024 + 1), 413],
    ] as const) {
      const file = multipart(name, bytes)
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `/api/templates/${id}/file`,
            cookies: auth.cookies,
            headers: { ...auth.headers, ...file.headers },
            payload: file.payload,
          })
        ).statusCode,
      ).toBe(status)
    }
    expect((await request(app, auth, 'GET', `/api/templates/${id}/file`)).rawPayload).toEqual(
      before.rawPayload,
    )
  })

  it('enforces maintenance permissions and reserves category/template deletion and member deletion to sysadmin', async () => {
    const { app } = await setup()
    const admin = await login(app)
    const c = await category(app, admin)
    const id = await upload(app, admin)
    const viewer = await login(app, 'viewer')
    const routes = [
      ['POST', '/api/categories'],
      ['PUT', `/api/categories/${c.id}`],
      ['POST', `/api/categories/${c.id}/variants`],
      ['PATCH', `/api/categories/${c.id}/variants/missing`],
      ['DELETE', `/api/categories/${c.id}/variants/missing`],
      ['POST', `/api/categories/${c.id}/fields`],
      ['POST', `/api/categories/${c.id}/steps`],
      ['PUT', `/api/templates/${id}/file`],
      ['POST', '/api/templates'],
      ['DELETE', `/api/categories/${c.id}`],
      ['DELETE', `/api/templates/${id}`],
      ['DELETE', '/api/members/user-clerk'],
    ] as const
    for (const [method, url] of routes)
      expect((await request(app, viewer, method, url, {})).statusCode, `${method} ${url}`).toBe(403)
    await request(app, admin, 'PATCH', '/api/members/user-clerk', { canManageCategories: true })
    const maintainer = await login(app, 'clerk')
    expect(
      (
        await request(app, maintainer, 'POST', `/api/categories/${c.id}/variants`, {
          name: '可維護',
        })
      ).statusCode,
    ).toBe(201)
    for (const url of [
      `/api/categories/${c.id}`,
      `/api/templates/${id}`,
      '/api/members/user-viewer',
    ])
      expect((await request(app, maintainer, 'DELETE', url)).statusCode).toBe(403)
  })

  it('hard deletes users, feedback, and sessions, and rejects self deletion and later login', async () => {
    const { app, db } = await setup()
    const admin = await login(app)
    const viewer = await login(app, 'viewer')
    await request(app, viewer, 'POST', '/api/feedback', { title: '模擬留言', content: '模擬內容' })
    expect(
      (
        await request(app, admin, 'PATCH', '/api/members/user-viewer', {
          canManageCategories: true,
        })
      ).statusCode,
    ).toBe(200)
    const victimAudit = db.prepare(
      'SELECT * FROM audit_log WHERE actor_username = ? OR target_username = ? ORDER BY id',
    )
    const auditBefore = victimAudit.all('viewer', 'viewer')
    expect(auditBefore.length).toBeGreaterThan(0)
    expect((await request(app, admin, 'DELETE', '/api/members/user-admin')).statusCode).toBe(400)
    expect((await request(app, admin, 'DELETE', '/api/members/user-viewer')).statusCode).toBe(204)
    expect(victimAudit.all('viewer', 'viewer')).toEqual(auditBefore)
    expect(db.prepare('SELECT * FROM users WHERE id = ?').get('user-viewer')).toBeUndefined()
    expect(db.prepare('SELECT * FROM sessions WHERE user_id = ?').all('user-viewer')).toEqual([])
    expect(db.prepare('SELECT * FROM login_events WHERE username = ?').all('viewer')).toEqual([])
    expect(
      db.prepare('SELECT * FROM feedback_posts WHERE author_id = ?').all('user-viewer'),
    ).toEqual([])
    expect((await request(app, viewer, 'GET', '/api/auth/me')).statusCode).toBe(401)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { username: 'viewer', password: passwords.viewer },
        })
      ).statusCode,
    ).toBe(401)
    expect(db.pragma('foreign_key_check')).toEqual([])
  })

  it('serves three to five release notes before login', async () => {
    const { app } = await setup()
    const notes = await app.inject({ method: 'GET', url: '/api/release-notes' })
    expect(notes.statusCode).toBe(200)
    expect(notes.json().items.length).toBeGreaterThanOrEqual(3)
    expect(notes.json().items.length).toBeLessThanOrEqual(5)
  })

  it('enforces module/ref permissions, preserves shared steps on remove-ref and aggregate omission, and audits configuration only', async () => {
    const { app, db } = await setup()
    db.prepare('UPDATE users SET can_manage_categories = 1 WHERE username = ?').run('clerk')
    const admin = await login(app)
    const manager = await login(app, 'clerk')
    const normal = await login(app, 'viewer')
    const c = await category(app, admin, 'Mock modules')
    const base = `/api/categories/${c.id}`
    const created = await request(app, manager, 'POST', `${base}/steps`, { title: 'Shared Mock' })
    expect(created.statusCode).toBe(201)
    const stepId = created.json().step.id as string
    const moduleId = 'mock-module'
    expect(
      (
        await request(app, manager, 'POST', `${base}/modules/${moduleId}`, {
          name: 'Mock module',
          sortOrder: 0,
        })
      ).statusCode,
    ).toBe(200)
    const writes = [
      ['POST', `${base}/modules/another`, { name: 'Mock', sortOrder: 0 }],
      ['PATCH', `${base}/modules/${moduleId}`, { name: 'Changed', sortOrder: 1 }],
      ['PUT', `${base}/refs/${moduleId}/${stepId}`, { stepId, sortOrder: 0 }],
      ['DELETE', `${base}/refs/base/${stepId}`],
      ['POST', `${base}/steps`, { title: 'Denied' }],
      ['PATCH', `${base}/steps/${stepId}`, { title: 'Denied' }],
      ['PUT', `${base}/order/modules`, { ids: [moduleId] }],
      ['PUT', `${base}/order/base`, { ids: [stepId] }],
    ] as const
    for (const [method, url, payload] of writes)
      expect((await request(app, normal, method, url, payload)).statusCode).toBe(403)
    for (const actor of [normal, manager]) {
      expect(
        (await request(app, actor, 'DELETE', `${base}/modules/${moduleId}`, { confirm: true }))
          .statusCode,
      ).toBe(403)
      expect(
        (await request(app, actor, 'DELETE', `${base}/steps/${stepId}`, { confirm: true }))
          .statusCode,
      ).toBe(403)
      expect((await request(app, actor, 'DELETE', base)).statusCode).toBe(403)
    }
    expect(
      (
        await request(app, manager, 'PUT', `${base}/refs/${moduleId}/${stepId}`, {
          stepId,
          sortOrder: 7,
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await request(app, manager, 'PUT', `${base}/refs/${moduleId}/${stepId}`, {
          stepId,
          sortOrder: 7,
        })
      ).statusCode,
    ).toBe(200)
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM module_step_refs WHERE module_id = ?').get(moduleId),
    ).toEqual({ n: 1 })
    const blocked = await request(app, admin, 'DELETE', `${base}/steps/${stepId}`, {
      confirm: true,
    })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().impact.base).toHaveLength(1)
    expect(blocked.json().impact.modules).toEqual([
      expect.objectContaining({ id: moduleId, name: 'Mock module' }),
    ])
    expect((await request(app, manager, 'GET', `${base}/steps/${stepId}/impact`)).statusCode).toBe(
      200,
    )
    expect((await request(app, normal, 'GET', `${base}/steps/${stepId}/impact`)).statusCode).toBe(
      403,
    )
    expect(
      (await request(app, manager, 'PATCH', base, { name: 'Mock modules', steps: [] })).statusCode,
    ).toBe(200)
    expect(db.prepare('SELECT id FROM category_steps WHERE id = ?').get(stepId)).toEqual({
      id: stepId,
    })
    const oldDetails = db.prepare('SELECT details FROM category_steps WHERE id = ?').get(stepId)
    expect((await request(app, manager, 'DELETE', `${base}/refs/base/${stepId}`)).statusCode).toBe(
      200,
    )
    expect(
      (await request(app, manager, 'DELETE', `${base}/refs/${moduleId}/${stepId}`)).statusCode,
    ).toBe(200)
    expect(db.prepare('SELECT details FROM category_steps WHERE id = ?').get(stepId)).toEqual(
      oldDetails,
    )
    expect(
      db
        .prepare(
          'SELECT detail FROM audit_log WHERE actor_username = ? AND detail LIKE ? ORDER BY id',
        )
        .all('clerk', 'ref_remove:%'),
    ).toEqual([
      { detail: `ref_remove:base:${stepId}` },
      { detail: `ref_remove:${moduleId}:${stepId}` },
    ])
    // Omission cannot be used as a second entity-delete endpoint, even after dereferencing.
    expect(
      (await request(app, manager, 'PATCH', base, { name: 'Mock modules', steps: [] })).statusCode,
    ).toBe(200)
    expect(db.prepare('SELECT id FROM category_steps WHERE id = ?').get(stepId)).toEqual({
      id: stepId,
    })
    expect((await request(app, admin, 'DELETE', `${base}/steps/${stepId}`)).statusCode).toBe(409)
    expect(
      (await request(app, admin, 'DELETE', `${base}/steps/${stepId}`, { confirm: true }))
        .statusCode,
    ).toBe(204)
    expect((await request(app, admin, 'DELETE', `${base}/modules/${moduleId}`)).statusCode).toBe(
      409,
    )
    expect(
      (await request(app, admin, 'DELETE', `${base}/modules/${moduleId}`, { confirm: true }))
        .statusCode,
    ).toBe(200)
  })

  it('rejects cross-category refs, malformed configuration, and foreign modules without writing rows', async () => {
    const { app, db } = await setup()
    const auth = await login(app)
    const a = await category(app, auth, 'Mock A')
    const b = await category(app, auth, 'Mock B')
    const step = (
      await request(app, auth, 'POST', `/api/categories/${b.id}/steps`, { title: 'Foreign' })
    ).json().step.id
    expect(
      (
        await request(app, auth, 'POST', `/api/categories/${a.id}/modules/mock-a`, {
          name: 'Mock A',
          sortOrder: 0,
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await request(app, auth, 'PUT', `/api/categories/${a.id}/refs/mock-a/${step}`, {
          stepId: step,
          sortOrder: 0,
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await request(app, auth, 'PUT', `/api/categories/${b.id}/refs/mock-a/${step}`, {
          stepId: step,
          sortOrder: 0,
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (await request(app, auth, 'DELETE', `/api/categories/${a.id}/refs/base/${step}`)).statusCode,
    ).toBe(400)
    expect(
      (
        await request(app, auth, 'PATCH', `/api/categories/${b.id}/modules/mock-a`, {
          name: 'Stolen',
          sortOrder: 0,
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await request(app, auth, 'POST', `/api/categories/${a.id}/modules/invalid`, {
          name: '',
          sortOrder: -1,
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await request(app, auth, 'PUT', `/api/categories/${b.id}/refs/base/${step}`, {
          stepId: step,
          sortOrder: '1',
        })
      ).statusCode,
    ).toBe(400)
    expect(db.prepare('SELECT * FROM module_step_refs').all()).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS n FROM category_modules').get()).toEqual({ n: 1 })
  })
  it('keeps shared templates and legacy JSON when deleting modules, and never resurrects deleted legacy modules', async () => {
    const { app, db } = await setup()
    const auth = await login(app)
    const response = await request(app, auth, 'POST', '/api/categories', {
      name: 'Legacy Mock',
      variants: [{ id: 'legacy', name: 'Legacy module' }],
      steps: [{ title: 'Shared Mock', variantIds: ['legacy'] }],
    })
    const category = response.json().category
    const base = `/api/categories/${category.id}`
    const stepId = category.steps[0].id
    const details = db.prepare('SELECT details FROM category_steps WHERE id = ?').get(stepId)
    expect(
      (await request(app, auth, 'DELETE', `${base}/modules/legacy`, { confirm: true })).statusCode,
    ).toBe(200)
    expect(db.prepare('SELECT details FROM category_steps WHERE id = ?').get(stepId)).toEqual(
      details,
    )
    expect(db.prepare('SELECT id FROM category_variants WHERE id = ?').get('legacy')).toEqual({
      id: 'legacy',
    })
    expect((await request(app, auth, 'PATCH', base, { name: 'Legacy Mock' })).statusCode).toBe(200)
    migrate(db)
    expect(db.prepare('SELECT id FROM category_modules WHERE id = ?').get('legacy')).toBeUndefined()
    expect(db.prepare('SELECT id FROM category_steps WHERE id = ?').get(stepId)).toEqual({
      id: stepId,
    })
  })

  it('rolls back reference removal when its audit fails and validates complete reorder sets', async () => {
    const { app, db } = await setup()
    const auth = await login(app)
    const c = await category(app, auth, 'Atomic Mock')
    const base = `/api/categories/${c.id}`
    const stepId = (
      await request(app, auth, 'POST', `${base}/steps`, { title: 'Atomic Mock Step' })
    ).json().step.id
    db.exec(
      "CREATE TRIGGER fail_ref_audit BEFORE INSERT ON audit_log WHEN NEW.detail LIKE 'ref_remove:%' BEGIN SELECT RAISE(ABORT, 'Mock audit failure'); END;",
    )
    expect((await request(app, auth, 'DELETE', `${base}/refs/base/${stepId}`)).statusCode).toBe(500)
    expect(db.prepare('SELECT step_id FROM base_step_refs WHERE step_id = ?').get(stepId)).toEqual({
      step_id: stepId,
    })
    db.exec('DROP TRIGGER fail_ref_audit')
    const before = db.prepare('SELECT * FROM base_step_refs').all()
    expect((await request(app, auth, 'PUT', `${base}/order/base`, { ids: [] })).statusCode).toBe(
      400,
    )
    expect(
      (await request(app, auth, 'PUT', `${base}/order/base`, { ids: [stepId, stepId] })).statusCode,
    ).toBe(400)
    expect(db.prepare('SELECT * FROM base_step_refs').all()).toEqual(before)
    expect(
      (await request(app, auth, 'PUT', `${base}/order/base`, { ids: [stepId] })).statusCode,
    ).toBe(200)
    expect(
      db.prepare('SELECT sort_order FROM base_step_refs WHERE step_id = ?').get(stepId),
    ).toEqual({ sort_order: 0 })
  })
})

it('persists isolated combination defaults, validates exact ownership/sets, reconciles stale IDs, and migrates without loss', async () => {
  const { app, db } = await setup()
  const admin = await login(app)
  db.prepare('UPDATE users SET can_manage_categories = 1 WHERE username = ?').run('clerk')
  const manager = await login(app, 'clerk')
  const normal = await login(app, 'viewer')
  const c = await category(app, admin, 'Combination Mock')
  const other = await category(app, admin, 'Foreign Mock')
  const base = `/api/categories/${c.id}`
  const ids: Record<string, string> = {}
  for (const title of ['A', 'B', 'C', 'D', 'J']) {
    const response = await request(app, manager, 'POST', `${base}/steps`, { title })
    expect(response.statusCode).toBe(201)
    ids[title] = response.json().step.id
  }
  for (const [moduleId, title, sortOrder] of [
    ['alcohol', 'D', 0],
    ['arrest', 'J', 1],
  ] as const) {
    expect(
      (
        await request(app, manager, 'POST', `${base}/modules/${moduleId}`, {
          name: moduleId,
          sortOrder,
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await request(app, manager, 'PUT', `${base}/refs/${moduleId}/${ids[title]}`, {
          stepId: ids[title],
          sortOrder: 0,
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (await request(app, manager, 'DELETE', `${base}/refs/base/${ids[title]}`)).statusCode,
    ).toBe(200)
  }
  const foreignStep = (
    await request(app, admin, 'POST', `/api/categories/${other.id}/steps`, { title: 'Foreign' })
  ).json().step.id
  await request(app, admin, 'POST', `/api/categories/${other.id}/modules/foreign-module`, {
    name: 'Foreign',
    sortOrder: 0,
  })
  const sourceSnapshot = () =>
    [
      'base_step_refs',
      'module_step_refs',
      'category_modules',
      'category_steps',
      'step_templates',
      'category_variants',
    ].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
  const before = sourceSnapshot()
  const payload = {
    moduleIds: ['arrest', 'alcohol', 'alcohol'],
    stepIds: [...'ADBJC'].map((id) => ids[id]!),
  }
  expect((await request(app, normal, 'PUT', `${base}/combination-order`, payload)).statusCode).toBe(
    403,
  )
  for (const invalid of [
    { ...payload, stepIds: payload.stepIds.slice(1) },
    { ...payload, stepIds: [...payload.stepIds, ids.A] },
    { ...payload, stepIds: [foreignStep, ...payload.stepIds.slice(1)] },
    { ...payload, stepIds: ['missing-step', ...payload.stepIds.slice(1)] },
    { ...payload, moduleIds: ['foreign-module'] },
    { ...payload, moduleIds: ['missing-module'] },
    { ...payload, caseValues: { mock: 'do not accept' } },
  ])
    expect(
      (await request(app, manager, 'PUT', `${base}/combination-order`, invalid)).statusCode,
    ).toBe(400)
  expect(db.prepare('SELECT * FROM category_combination_orders').all()).toEqual([])
  expect(
    (await request(app, manager, 'PUT', `${base}/combination-order`, payload)).statusCode,
  ).toBe(200)
  expect(db.prepare('SELECT module_key, step_ids FROM category_combination_orders').get()).toEqual({
    module_key: '["alcohol","arrest"]',
    step_ids: JSON.stringify(payload.stepIds),
  })
  const load = async () => (await request(app, normal, 'GET', base)).json().category
  expect((await load()).combinationOrders).toEqual([
    { moduleIds: ['alcohol', 'arrest'], stepIds: payload.stepIds },
  ])
  expect((await load()).baseSteps.map((r: { stepId: string }) => r.stepId)).toEqual([
    ids.A,
    ids.B,
    ids.C,
  ])
  expect(sourceSnapshot()).toEqual(before)
  const baseOnly = { moduleIds: [], stepIds: [...'CBA'].map((id) => ids[id]!) }
  expect(
    (await request(app, manager, 'PUT', `${base}/combination-order`, baseOnly)).statusCode,
  ).toBe(200)
  expect((await load()).combinationOrders).toHaveLength(2)
  // Repeated migration preserves existing config, entities, references, and documents.
  const orders = db.prepare('SELECT * FROM category_combination_orders ORDER BY module_key').all()
  db.exec('DROP TABLE category_combination_orders')
  migrate(db)
  migrate(db)
  expect(sourceSnapshot()).toEqual(before)
  for (const row of orders as { category_id: string; module_key: string; step_ids: string }[])
    db.prepare('INSERT INTO category_combination_orders VALUES (?, ?, ?)').run(
      row.category_id,
      row.module_key,
      row.step_ids,
    )
  migrate(db)
  migrate(db)
  expect(db.prepare('SELECT * FROM category_combination_orders ORDER BY module_key').all()).toEqual(
    orders,
  )
  expect(sourceSnapshot()).toEqual(before)
  expect(db.pragma('foreign_key_check')).toEqual([])
  // Audit failure rolls back the upsert as well.
  db.exec(
    "CREATE TRIGGER fail_combo_audit BEFORE INSERT ON audit_log WHEN NEW.detail LIKE 'combination_order:%' BEGIN SELECT RAISE(ABORT, 'Mock audit failure'); END;",
  )
  expect(
    (
      await request(app, manager, 'PUT', `${base}/combination-order`, {
        ...payload,
        stepIds: [...payload.stepIds].reverse(),
      })
    ).statusCode,
  ).toBe(500)
  expect(db.prepare('SELECT * FROM category_combination_orders ORDER BY module_key').all()).toEqual(
    orders,
  )
  db.exec('DROP TRIGGER fail_combo_audit')
  // Removing a reference and deleting its entity cannot invalidate saved configurations.
  await request(app, manager, 'DELETE', `${base}/refs/alcohol/${ids.D}`)
  expect(
    (await request(app, admin, 'DELETE', `${base}/steps/${ids.D}`, { confirm: true })).statusCode,
  ).toBe(204)
  expect(db.prepare('SELECT id FROM category_steps WHERE id = ?').get(ids.D)).toBeUndefined()
  expect((await request(app, manager, 'POST', `${base}/steps`, { title: 'E' })).statusCode).toBe(
    201,
  )
  expect(
    (await load()).steps.map((s: { id: string; title: string }) => ({ id: s.id, title: s.title })),
  ).not.toContainEqual({ id: ids.D, title: 'D' })
  expect((await load()).steps.some((s: { title: string }) => s.title === 'E')).toBe(true)
  expect(db.prepare('SELECT * FROM category_combination_orders ORDER BY module_key').all()).toEqual(
    orders,
  )
  expect(
    db
      .prepare(
        "SELECT actor_username, category_id, detail FROM audit_log WHERE detail LIKE 'combination_order:%' ORDER BY id",
      )
      .all(),
  ).toEqual([
    {
      actor_username: 'clerk',
      category_id: c.id,
      detail: `combination_order:["alcohol","arrest"]:${JSON.stringify(payload.stepIds)}`,
    },
    {
      actor_username: 'clerk',
      category_id: c.id,
      detail: `combination_order:[]:${JSON.stringify(baseOnly.stepIds)}`,
    },
  ])
})

it('defaults parallel hints off, authorizes maintenance, rejects non-booleans/foreign resources, and audits atomically', async () => {
  const { app, db } = await setup()
  const admin = await login(app)
  const normal = await login(app, 'viewer')
  db.prepare('UPDATE users SET can_manage_categories = 1 WHERE username = ?').run('clerk')
  const manager = await login(app, 'clerk')
  const c = await category(app, admin, 'Parallel Mock')
  const other = await category(app, admin, 'Other Parallel Mock')
  const base = `/api/categories/${c.id}`
  const created = await request(app, manager, 'POST', `${base}/steps`, { title: 'D' })
  expect(created.statusCode).toBe(201)
  const step = created.json().step
  expect(step.canRunInParallel).toBe(false)
  const url = `${base}/steps/${step.id}`
  expect((await request(app, normal, 'PATCH', url, { canRunInParallel: true })).statusCode).toBe(
    403,
  )
  expect(
    (
      await request(app, normal, 'POST', `${base}/steps`, {
        title: 'Denied',
        canRunInParallel: true,
      })
    ).statusCode,
  ).toBe(403)
  expect(
    (
      await request(app, normal, 'PUT', base, {
        name: 'Denied',
        steps: [{ ...step, canRunInParallel: true }],
      })
    ).statusCode,
  ).toBe(403)
  for (const invalid of ['true', 'false', 0, 1, null, [], {}]) {
    expect(
      (await request(app, manager, 'PATCH', url, { canRunInParallel: invalid })).statusCode,
    ).toBe(400)
    expect(
      (
        await request(app, manager, 'POST', `${base}/steps`, {
          title: 'Invalid',
          canRunInParallel: invalid,
        })
      ).statusCode,
    ).toBe(400)
  }
  expect(
    (
      await request(app, manager, 'PATCH', `/api/categories/${other.id}/steps/${step.id}`, {
        canRunInParallel: true,
      })
    ).statusCode,
  ).toBe(404)
  expect(
    (await request(app, manager, 'PATCH', url, { categoryId: other.id, canRunInParallel: true }))
      .statusCode,
  ).toBe(400)
  const updated = await request(app, manager, 'PATCH', url, { canRunInParallel: true })
  expect(updated.statusCode).toBe(200)
  expect(updated.json().step.canRunInParallel).toBe(true)
  expect(
    (await request(app, manager, 'PATCH', url, { note: 'Keep setting' })).json().step
      .canRunInParallel,
  ).toBe(true)
  expect((await request(app, normal, 'GET', base)).json().category.steps[0].canRunInParallel).toBe(
    true,
  )
  expect(
    db
      .prepare(
        "SELECT actor_username, category_id, detail FROM audit_log WHERE detail LIKE 'step_parallel:%'",
      )
      .all(),
  ).toEqual([
    { actor_username: 'clerk', category_id: c.id, detail: `step_parallel:${step.id}:true` },
  ])
  db.exec(
    "CREATE TRIGGER fail_parallel_audit BEFORE INSERT ON audit_log WHEN NEW.detail LIKE 'step_parallel:%' BEGIN SELECT RAISE(ABORT, 'Mock audit failure'); END;",
  )
  expect((await request(app, manager, 'PATCH', url, { canRunInParallel: false })).statusCode).toBe(
    500,
  )
  expect((await request(app, normal, 'GET', base)).json().category.steps[0].canRunInParallel).toBe(
    true,
  )
  db.exec('DROP TRIGGER fail_parallel_audit')
  expect(
    (await request(app, manager, 'PATCH', url, { canRunInParallel: false })).json().step
      .canRunInParallel,
  ).toBe(false)
  expect(
    db
      .prepare("SELECT detail FROM audit_log WHERE detail LIKE 'step_parallel:%' ORDER BY id")
      .all(),
  ).toEqual([
    { detail: `step_parallel:${step.id}:true` },
    { detail: `step_parallel:${step.id}:false` },
  ])
})

it('persists standalone base ownership without output, preserves legacy ownership and rejects invalid or unauthorized writes', async () => {
  const { app, db } = await setup()
  const admin = await login(app)
  await request(app, admin, 'PATCH', '/api/members/user-clerk', { canManageCategories: true })
  const auth = await login(app, 'clerk')
  const c = await category(app, auth, 'Mock standalone base')
  const base = `/api/categories/${c.id}`
  const fields = [
    { id: 'standalone', key: '身分證', name: 'Mock ID', type: 'text', scope: 'base' },
    { id: 'legacy', key: 'LegacyScenario', name: 'Mock legacy', type: 'number' },
  ]
  const result = await request(app, auth, 'PATCH', base, { name: 'Mock standalone base', fields })
  expect(result.statusCode).toBe(200)
  expect(result.json().category.fields).toEqual(fields.map((f) => ({ ...f, categoryId: c.id })))
  migrate(db)
  expect(createQueries(db).getCategory(c.id)!.fields).toEqual(result.json().category.fields)
  // A round trip from an older client must not erase newly persisted base ownership.
  const oldClientFields = fields.map((field) => {
    const copy = { ...field }
    delete copy.scope
    return copy
  })
  expect(
    (
      await request(app, auth, 'PATCH', base, {
        name: 'Mock standalone base',
        fields: oldClientFields,
      })
    ).statusCode,
  ).toBe(200)
  expect((await request(app, auth, 'GET', `${base}/fields`)).json().fields).toEqual(
    result.json().category.fields,
  )
  const before = db.prepare('SELECT * FROM category_fields ORDER BY id').all()
  for (const field of [
    { ...fields[0], key: '__proto__' },
    { ...fields[0], key: 'bad key' },
    { ...fields[0], name: '' },
    { ...fields[0], name: 'a'.repeat(81) },
    { ...fields[0], type: 'date' },
    { ...fields[0], scope: 'scenario' },
    { ...fields[0], value: 'Mock forbidden persistence' },
  ]) {
    expect(
      (await request(app, auth, 'PATCH', base, { name: 'Mock standalone base', fields: [field] }))
        .statusCode,
    ).toBe(400)
  }
  const viewer = await login(app, 'viewer')
  expect(
    (await request(app, viewer, 'PATCH', base, { name: 'Mock denied', fields })).statusCode,
  ).toBe(403)
  expect(
    (await app.inject({ method: 'PATCH', url: base, payload: { name: 'Mock denied', fields } }))
      .statusCode,
  ).toBeGreaterThanOrEqual(400)
  const other = await category(app, auth, 'Mock other')
  expect(
    (
      await request(app, auth, 'PATCH', `/api/categories/${other.id}`, {
        name: 'Mock other',
        fields,
      })
    ).statusCode,
  ).toBe(400)
  expect(db.prepare('SELECT * FROM category_fields ORDER BY id').all()).toEqual(before)
})

it('returns built-in settings on category APIs, permits manual name and base fields only to maintainers, and reflects recovery', async () => {
  const { app, db } = await setup()
  const admin = await login(app)
  const user = await login(app, 'clerk')
  const managerId = createQueries(db).findUserByUsername('clerk')!.id
  const c = await category(app, admin, 'Mock 步驟欄位')
  const url = `/api/categories/${c.id}`
  expect((await request(app, user, 'GET', url)).json().category.builtinFields).toEqual({
    姓名: false,
  })
  expect(
    (await request(app, user, 'GET', '/api/categories'))
      .json()
      .categories.find((item: { id: string }) => item.id === c.id).builtinFields,
  ).toEqual({ 姓名: false })
  const fields = [
    { id: 'unit', key: '承辦單位', type: 'text', scope: 'base' },
    { id: 'manual-name', key: '姓名', type: 'text', scope: 'base' },
  ]
  expect(
    (await request(app, user, 'PATCH', url, { name: 'Mock 步驟欄位', fields })).statusCode,
  ).toBe(403)
  db.prepare('UPDATE users SET can_manage_categories = 1 WHERE id = ?').run(managerId)
  expect(
    (await request(app, user, 'PATCH', url, { name: 'Mock 步驟欄位', fields })).statusCode,
  ).toBe(200)
  const stored = (await request(app, user, 'GET', url)).json().category
  expect(stored.fields.map((field: { key: string }) => field.key)).toEqual(['承辦單位', '姓名'])
  expect(stored.builtinFields).toEqual({ 姓名: false })
  // Model an existing category with absent setting before the once-only adjustment.
  const { applyRemoveBaseName, removeBaseNameId, revertRemoveBaseName } =
    await import('./builtinFields.ts')
  db.prepare('DELETE FROM data_adjustments WHERE id = ?').run(removeBaseNameId)
  db.prepare('DELETE FROM category_builtin_fields WHERE category_id = ?').run(c.id)
  applyRemoveBaseName(db)
  expect((await request(app, user, 'GET', url)).json().category.builtinFields).toEqual({
    姓名: false,
  })
  revertRemoveBaseName(db, 'Mock admin')
  expect((await request(app, user, 'GET', url)).json().category.builtinFields).toEqual({
    姓名: true,
  })
  migrate(db)
  expect((await request(app, user, 'GET', url)).json().category.builtinFields).toEqual({
    姓名: true,
  })
  expect(
    (await request(app, user, 'PATCH', url, { builtinFields: { 日期: false } })).statusCode,
  ).toBe(400)
  const viewer = await login(app, 'viewer')
  const disableName = { builtinFields: { 姓名: false } }
  expect((await request(app, viewer, 'PATCH', url, disableName)).statusCode).toBe(403)
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url,
        payload: disableName,
        headers: {
          origin,
          'x-csrf-token': viewer.headers['x-csrf-token'],
          cookie: `csrf=${viewer.cookies.csrf}`,
        },
      })
    ).statusCode,
  ).toBe(401)
  expect((await request(app, user, 'PATCH', url, disableName)).statusCode).toBe(200)
  expect((await request(app, user, 'GET', url)).json().category.builtinFields).toEqual({
    姓名: false,
  })
  expect(
    db
      .prepare(
        'SELECT enabled FROM category_builtin_fields WHERE category_id = ? AND field_key = ?',
      )
      .get(c.id, '姓名'),
  ).toEqual({ enabled: 0 })
  expect(
    db
      .prepare(
        "SELECT action, actor_username AS actor FROM audit_log WHERE category_id = ? AND action = 'category_update' ORDER BY id DESC LIMIT 1",
      )
      .get(c.id),
  ).toEqual({ action: 'category_update', actor: 'clerk' })
  expect(
    (await request(app, admin, 'PATCH', url, { builtinFields: { 姓名: true } })).statusCode,
  ).toBe(200)
  expect((await request(app, admin, 'GET', url)).json().category.builtinFields).toEqual({
    姓名: true,
  })
})
