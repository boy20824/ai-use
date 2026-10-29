import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import PizZip from 'pizzip'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
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
const scratch = mkdtempSync(path.join(tmpdir(), 'ai-use-permissions-'))
const secretMarker = 'CASE-SECRET-VALUE'
const personMarker = '王小明'

function config(): AppConfig {
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
    loginMaxFailures: 5,
    loginLockoutMinutes: 15,
    loginRatePerMinute: 30,
    sampleTemplatePath: samplePath,
    seedSampleData: false,
    staticDir: undefined,
    trustProxy: false,
    seedDemoUsers: true,
    passwords,
  }
}

function docx(text: string) {
  const zip = new PizZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  )
  return zip.generate({ type: 'nodebuffer' }) as Uint8Array
}

function multipart(name: string, data: Uint8Array) {
  const boundary = '----permissions'
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

async function login(app: Awaited<ReturnType<typeof boot>>['app'], username: keyof SeedPasswords) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: passwords[username] },
  })
}

function auth(response: { cookies: { name: string; value: string }[] }) {
  const session = response.cookies.find((cookie) => cookie.name === 'session')?.value ?? ''
  const csrf = response.cookies.find((cookie) => cookie.name === 'csrf')?.value ?? ''
  return {
    cookies: { session, csrf },
    headers: { origin, 'x-csrf-token': csrf },
  }
}

describe('admin-only mutations', () => {
  const databases: AppDatabase[] = []
  afterEach(() => {
    for (const db of databases.splice(0)) db.close()
  })
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  it('returns 403 for clerk and viewer, 401 for anonymous, and audits each denial', async () => {
    const { app, db } = await boot()
    databases.push(db)
    const adminAuth = auth(await login(app, 'admin'))
    const clerkAuth = auth(await login(app, 'clerk'))
    const viewerAuth = auth(await login(app, 'viewer'))
    const created = await app.inject({
      method: 'POST',
      url: '/api/categories',
      ...adminAuth,
      payload: {
        name: '竊盜案',
        code: 'A-01',
        summary: '財物遭竊',
        steps: [{ body: '製作筆錄' }],
      },
    })
    expect(created.statusCode).toBe(201)
    const categoryId = created.json().category.id as string
    const stepId = created.json().category.steps[0].id as string
    const file = multipart('筆錄.docx', docx(`${personMarker} {{姓名}} ${secretMarker}`))
    const uploaded = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: adminAuth.cookies,
      headers: { ...file.headers, ...adminAuth.headers },
      payload: file.payload,
    })
    expect(uploaded.statusCode).toBe(201)
    const templateId = uploaded.json().template.id as string
    const before = createQueries(db).getCategory(categoryId)

    const probe = await app.inject({ method: 'GET', url: '/api/categories' })
    const csrf = probe.cookies.find((cookie) => cookie.name === 'csrf')?.value ?? ''
    const anonymous = {
      cookies: { csrf },
      headers: { origin, 'x-csrf-token': csrf },
    }

    const tamperedCategory = {
      name: '不該改名',
      role: 'admin',
      summary: secretMarker,
      steps: [{ id: stepId, body: personMarker, templateIds: [templateId] }],
    }
    const routes: {
      method: 'POST' | 'PATCH' | 'DELETE'
      url: string
      action: string
      payload?: object
      file?: boolean
      categoryId?: string
      templateId?: string
    }[] = [
      {
        method: 'POST',
        url: '/api/categories',
        action: 'category_create',
        payload: {
          name: '不該建立',
          role: 'admin',
          summary: secretMarker,
          steps: [{ body: personMarker }],
        },
      },
      {
        method: 'PATCH',
        url: `/api/categories/${categoryId}`,
        action: 'category_update',
        payload: tamperedCategory,
        categoryId,
      },
      {
        method: 'DELETE',
        url: `/api/categories/${categoryId}`,
        action: 'category_delete',
        categoryId,
      },
      { method: 'POST', url: '/api/templates', action: 'upload', file: true },
      {
        method: 'DELETE',
        url: `/api/templates/${templateId}`,
        action: 'delete',
        templateId,
      },
    ]

    async function send(
      actor: { cookies: Record<string, string>; headers: Record<string, string> },
      route: (typeof routes)[number],
    ) {
      if (route.file) {
        return app.inject({
          method: 'POST',
          url: route.url,
          cookies: actor.cookies,
          headers: { ...file.headers, ...actor.headers },
          payload: file.payload,
        })
      }
      return app.inject({
        method: route.method,
        url: route.url,
        cookies: actor.cookies,
        headers: actor.headers,
        payload: route.payload,
      })
    }

    for (const route of routes) {
      const response = await send(anonymous, route)
      expect(response.statusCode, `${route.method} ${route.url} anonymous`).toBe(401)
    }
    expect(deniedRows(db)).toEqual([])

    for (const actor of [
      { name: 'clerk', auth: clerkAuth },
      { name: 'viewer', auth: viewerAuth },
    ]) {
      for (const route of routes) {
        const response = await send(actor.auth, route)
        expect(response.statusCode, `${actor.name} ${route.method} ${route.url}`).toBe(403)
        expect(response.json().error).toBe('forbidden')
      }
    }

    const denied = deniedRows(db)
    expect(denied).toHaveLength(routes.length * 2)
    for (const row of denied) {
      expect(['clerk', 'viewer']).toContain(row.actor_username)
      expect(row.result).toBe('denied')
      expect(row.detail).toBe('')
      expect(row.file_name).toBe('')
    }
    const serialized = JSON.stringify(denied)
    expect(serialized).not.toContain(secretMarker)
    expect(serialized).not.toContain(personMarker)
    expect(serialized).not.toContain('不該建立')
    expect(serialized).not.toContain('不該改名')
    expect(serialized).not.toContain('role')

    for (const action of [
      'category_create',
      'category_update',
      'category_delete',
      'upload',
      'delete',
    ]) {
      expect(
        denied.filter((row) => row.actor_username === 'clerk' && row.action === action),
      ).toHaveLength(1)
      expect(
        denied.filter((row) => row.actor_username === 'viewer' && row.action === action),
      ).toHaveLength(1)
    }
    expect(
      denied.find((row) => row.actor_username === 'clerk' && row.action === 'category_update')
        ?.category_id,
    ).toBe(categoryId)
    expect(
      denied.find((row) => row.actor_username === 'clerk' && row.action === 'delete')?.template_id,
    ).toBe(templateId)
    expect(
      denied.find((row) => row.actor_username === 'viewer' && row.action === 'category_create')
        ?.category_id,
    ).toBe('')
    expect(
      denied.find((row) => row.actor_username === 'viewer' && row.action === 'upload')?.template_id,
    ).toBe('')

    expect(createQueries(db).getCategory(categoryId)).toEqual(before)
    expect(createQueries(db).getTemplateFile(templateId)?.fileName).toBe('筆錄.docx')
    const actions = db.prepare('SELECT DISTINCT action FROM audit_log').all() as {
      action: string
    }[]
    expect(actions.map((row) => row.action).sort()).toEqual(
      ['category_create', 'category_delete', 'category_update', 'delete', 'upload'].sort(),
    )

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { session: clerkAuth.cookies.session },
    })
    expect(me.json().user.role).toBe('clerk')
    const storedRole = db.prepare('SELECT role FROM users WHERE username = ?').get('clerk') as {
      role: string
    }
    expect(storedRole.role).toBe('clerk')

    const readable = await app.inject({
      method: 'GET',
      url: `/api/templates/${templateId}/file`,
      cookies: { session: clerkAuth.cookies.session },
    })
    expect(readable.statusCode).toBe(200)
    expect(readable.body).toContain(personMarker)
  })

  it('rejects forged CSRF and unauthenticated template downloads', async () => {
    const { app, db } = await boot()
    databases.push(db)
    const adminAuth = auth(await login(app, 'admin'))
    const file = multipart('筆錄.docx', docx(`${personMarker} {{姓名}}`))
    const uploaded = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: adminAuth.cookies,
      headers: { ...file.headers, ...adminAuth.headers },
      payload: file.payload,
    })
    expect(uploaded.statusCode).toBe(201)
    const templateId = uploaded.json().template.id as string
    const beforeAudit = deniedRows(db).length

    const forged = await app.inject({
      method: 'POST',
      url: '/api/categories',
      cookies: adminAuth.cookies,
      headers: { origin, 'x-csrf-token': 'forged-token' },
      payload: { name: '不該建立', role: 'admin', summary: secretMarker },
    })
    expect(forged.statusCode).toBe(403)
    expect(forged.json().error).toBe('csrf')

    const missing = await app.inject({
      method: 'POST',
      url: '/api/categories',
      cookies: { session: adminAuth.cookies.session },
      headers: { origin },
      payload: { name: '不該建立', role: 'viewer' },
    })
    expect(missing.statusCode).toBe(403)
    expect(missing.json().error).toBe('csrf')
    expect(createQueries(db).listCategories()).toEqual([])
    expect(deniedRows(db)).toHaveLength(beforeAudit)

    const anonymousFile = await app.inject({
      method: 'GET',
      url: `/api/templates/${templateId}/file`,
    })
    expect(anonymousFile.statusCode).toBe(401)
    expect(anonymousFile.body).not.toContain(personMarker)

    const guessed = await app.inject({
      method: 'GET',
      url: '/api/templates/does-not-exist/file',
    })
    expect(guessed.statusCode).toBe(401)
    expect(guessed.body).not.toContain(personMarker)

    const emptySession = await app.inject({
      method: 'GET',
      url: `/api/templates/${templateId}/file`,
      cookies: { session: 'f'.repeat(64) },
    })
    expect(emptySession.statusCode).toBe(401)
    expect(emptySession.body).not.toContain(personMarker)
  })
})

function deniedRows(db: AppDatabase) {
  return db
    .prepare(
      `SELECT actor_username, action, template_id, file_name, category_id, detail, result
       FROM audit_log
       WHERE result = 'denied'
       ORDER BY id`,
    )
    .all() as {
    actor_username: string
    action: string
    template_id: string
    file_name: string
    category_id: string
    detail: string
    result: string
  }[]
}
