import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import PizZip from 'pizzip'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { buildApp } from './app.ts'
import type { AppConfig, SeedPasswords } from './config.ts'
import { cookieSecureFromEnv } from './config.ts'
import { sanitizeTemplateFileName } from './docx.ts'
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
const scratch = mkdtempSync(path.join(tmpdir(), 'ai-use-security-'))

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
    maxZipEntries: 4,
    maxZipUncompressedBytes: 64 * 1024,
    loginMaxFailures: 2,
    loginLockoutMinutes: 15,
    loginRatePerMinute: 20,
    sampleTemplatePath: samplePath,
    staticDir: undefined,
    trustProxy: false,
    passwords,
    ...overrides,
  }
}

function docx(text: string, extraFiles = 0) {
  const zip = new PizZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  )
  for (let index = 0; index < extraFiles; index += 1) zip.file(`word/extra-${index}.xml`, '<x/>')
  return zip.generate({ type: 'nodebuffer' }) as Uint8Array
}

function multipart(name: string, type: string, data: Uint8Array, categoryId = 'general-assist') {
  const boundary = '----security'
  const chunks: Uint8Array[] = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="categoryId"\r\n\r\n${categoryId}\r\n`,
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

async function boot(overrides: Partial<AppConfig> = {}) {
  const appConfig = config(overrides)
  const db = openDatabase(':memory:')
  migrate(db)
  seedReferenceData(createQueries(db), passwords, samplePath, appConfig.uploadDir)
  const app = await buildApp(db, appConfig)
  return { app, db }
}

async function login(
  app: Awaited<ReturnType<typeof boot>>['app'],
  username: string,
  password: string,
) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  })
}

function auth(response: { cookies: { name: string; value: string }[] }, originHeader = origin) {
  const session = response.cookies.find((cookie) => cookie.name === 'session')?.value ?? ''
  const csrf = response.cookies.find((cookie) => cookie.name === 'csrf')?.value ?? ''
  return {
    cookies: { session, csrf },
    headers: { origin: originHeader, 'x-csrf-token': csrf },
  }
}

describe('security controls', () => {
  const databases: AppDatabase[] = []
  afterEach(() => {
    for (const db of databases.splice(0)) db.close()
  })
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  it('locks login after repeated failures and limits the request rate', async () => {
    const { app, db } = await boot()
    databases.push(db)
    expect((await login(app, 'clerk', 'wrong-1')).statusCode).toBe(401)
    expect((await login(app, 'clerk', 'wrong-2')).statusCode).toBe(401)
    const locked = await login(app, 'clerk', passwords.clerk)
    expect(locked.statusCode).toBe(429)
    expect(locked.json()).toEqual({ error: 'locked', message: '登入嘗試過多，請稍後再試。' })
    expect(JSON.stringify(locked.json())).not.toContain('stack')

    const limited = await boot({ loginMaxFailures: 50, loginRatePerMinute: 2 })
    databases.push(limited.db)
    expect((await login(limited.app, 'clerk', passwords.clerk)).statusCode).toBe(200)
    expect((await login(limited.app, 'clerk', passwords.clerk)).statusCode).toBe(200)
    expect((await login(limited.app, 'clerk', passwords.clerk)).statusCode).toBe(429)
    await limited.app.close()
  })

  it('rotates the session on login and sets Secure in production', async () => {
    const { app, db } = await boot({ cookieSecure: true })
    databases.push(db)
    const first = await login(app, 'admin', passwords.admin)
    const second = await login(app, 'admin', passwords.admin)
    const oldSession = first.cookies.find((cookie) => cookie.name === 'session')
    const newSession = second.cookies.find((cookie) => cookie.name === 'session')
    expect(oldSession?.secure).toBe(true)
    expect(oldSession?.httpOnly).toBe(true)
    expect(oldSession?.sameSite).toBe('Strict')
    expect(newSession?.value).not.toBe(oldSession?.value)
    const stale = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { session: oldSession!.value },
    })
    expect(stale.statusCode).toBe(401)
    const current = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { session: newSession!.value },
    })
    expect(current.statusCode).toBe(200)
  })

  it('rejects cross-site mutations, missing CSRF tokens, and other roles', async () => {
    const { app, db } = await boot()
    databases.push(db)
    const clerk = await login(app, 'clerk', passwords.clerk)
    const viewer = await login(app, 'viewer', passwords.viewer)
    const admin = await login(app, 'admin', passwords.admin)
    const file = multipart(
      'note.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      docx('CASE-SECRET-VALUE {{姓名}}'),
    )
    const clerkAuth = auth(clerk)
    const crossSite = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: clerkAuth.cookies,
      headers: {
        ...file.headers,
        'x-csrf-token': clerkAuth.headers['x-csrf-token'],
        origin: 'https://evil.example',
      },
      payload: file.payload,
    })
    expect(crossSite.statusCode).toBe(403)
    expect(crossSite.json().error).toBe('csrf')

    const missingToken = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: { session: clerkAuth.cookies.session },
      headers: { ...file.headers, origin },
      payload: file.payload,
    })
    expect(missingToken.statusCode).toBe(403)

    const viewerUpload = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: auth(viewer).cookies,
      headers: { ...file.headers, ...auth(viewer).headers },
      payload: file.payload,
    })
    expect(viewerUpload.statusCode).toBe(403)

    const uploaded = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: clerkAuth.cookies,
      headers: { ...file.headers, ...clerkAuth.headers },
      payload: file.payload,
    })
    expect(uploaded.statusCode).toBe(201)
    const templateId = uploaded.json().template.id as string
    expect(uploaded.json().template.fileName).toBe('note.docx')

    const clerkDelete = await app.inject({
      method: 'DELETE',
      url: `/api/templates/${templateId}`,
      ...clerkAuth,
    })
    expect(clerkDelete.statusCode).toBe(403)

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/templates/${templateId}`,
      ...auth(admin),
    })
    expect(removed.statusCode).toBe(204)
    const audit = db
      .prepare('SELECT actor_username, action, template_id, file_name, category_id FROM audit_log')
      .all() as { actor_username: string; action: string; file_name: string }[]
    expect(audit.map((row) => row.action)).toEqual(['upload', 'delete'])
    expect(JSON.stringify(audit)).not.toContain('CASE-SECRET-VALUE')
    expect(JSON.stringify(audit)).not.toContain('password')
  })

  it('blocks malicious uploads, path traversal, zip bombs, and SQL injection', async () => {
    const { app, db } = await boot()
    databases.push(db)
    const admin = auth(await login(app, 'admin', passwords.admin))
    const traversal = multipart(
      '../../etc/passwd.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      docx('ok'),
    )
    const stored = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: admin.cookies,
      headers: { ...traversal.headers, ...admin.headers },
      payload: traversal.payload,
    })
    expect(stored.statusCode).toBe(201)
    expect(stored.json().template.fileName).toBe('passwd.docx')
    expect(stored.json().template.fileName).not.toContain('..')

    const bomb = multipart(
      'bomb.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      docx('too many', 8),
    )
    const rejectedBomb = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: admin.cookies,
      headers: { ...bomb.headers, ...admin.headers },
      payload: bomb.payload,
    })
    expect(rejectedBomb.statusCode).toBe(400)

    const injected = await app.inject({
      method: 'GET',
      url: "/api/templates?categoryId=' OR 1=1 --",
      cookies: { session: admin.cookies.session },
    })
    expect(injected.statusCode).toBe(400)
    expect(JSON.stringify(injected.json())).not.toContain('SQLITE')
    const badId = await app.inject({
      method: 'GET',
      url: '/api/templates/1%20OR%201%3D1/file',
      cookies: { session: admin.cookies.session },
    })
    expect(badId.statusCode).toBe(400)
    expect(createQueries(db).countUsers()).toBe(3)
    expect(sanitizeTemplateFileName('../secret.docx')).toBe('secret.docx')
    expect(sanitizeTemplateFileName('..\\..\\windows.docx')).toBe('windows.docx')
    expect(sanitizeTemplateFileName('..docx')).toBeNull()
  })

  it('sends a strict content security policy and an origin allowlist', async () => {
    const { app, db } = await boot()
    databases.push(db)
    const response = await app.inject({ method: 'GET', url: '/api/auth/me' })
    const policy = String(response.headers['content-security-policy'])
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("script-src 'self'")
    expect(policy).not.toContain('unsafe-inline')
    const evil = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { origin: 'https://evil.example' },
    })
    expect(evil.headers['access-control-allow-origin']).not.toBe('https://evil.example')
    expect(cookieSecureFromEnv('production', 'false')).toBe(true)
    expect(cookieSecureFromEnv('development', 'false')).toBe(false)
    expect(cookieSecureFromEnv('development', 'true')).toBe(true)
  })
})
