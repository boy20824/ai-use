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
    for (const [resource, id] of [
      ['variants', variantId],
      ['fields', fieldId],
      ['steps', stepId],
    ]) {
      expect((await request(app, auth, 'GET', `${base}/${resource}`)).statusCode).toBe(200)
      expect((await request(app, auth, 'DELETE', `${base}/${resource}/${id}`)).statusCode).toBe(204)
      expect((await request(app, auth, 'GET', `${base}/${resource}`)).json()[resource]).toEqual([])
    }
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
    expect(combined.json().category.steps[0].variantIds).toEqual(['stop', 'crash'])
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
})
