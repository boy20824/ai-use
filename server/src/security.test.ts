import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import PizZip from 'pizzip'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    globalRatePerMinute: 120,
    loginRatePerMinute: 20,
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

function docx(text: string, extraFiles = 0) {
  const zip = new PizZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  )
  for (let index = 0; index < extraFiles; index += 1) zip.file(`word/extra-${index}.xml`, '<x/>')
  return zip.generate({ type: 'nodebuffer' }) as Uint8Array
}

function multipart(name: string, type: string, data: Uint8Array, categoryId?: string) {
  const boundary = '----security'
  const chunks: Uint8Array[] = []
  if (categoryId) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="categoryId"\r\n\r\n${categoryId}\r\n`,
      ),
    )
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  )
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

async function boot(overrides: Partial<AppConfig> = {}) {
  const appConfig = config(overrides)
  const db = openDatabase(':memory:')
  migrate(db)
  seedReferenceData(createQueries(db), passwords, samplePath, appConfig.uploadDir, false)
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
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`${'0'.repeat(35)}:0`)))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    for (const db of databases.splice(0)) db.close()
  })
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  it('rejects incorrect current passwords and short new passwords without changing credentials', async () => {
    const { app, db } = await boot()
    databases.push(db)
    try {
      const current = auth(await login(app, 'clerk', passwords.clerk))
      const original = createQueries(db).findUserByUsername('clerk')!.passwordHash
      const change = (currentPassword: string, newPassword: string) =>
        app.inject({
          method: 'POST',
          url: '/api/auth/change-password',
          ...current,
          payload: { currentPassword, newPassword },
        })
      const wrong = await change('incorrect-password', 'new-password-12345')
      const short = await change(passwords.clerk, 'short')
      const tooManyBytes = await change(passwords.clerk, '密'.repeat(25))
      expect(wrong.statusCode).toBe(400)
      expect(short.statusCode).toBe(400)
      expect(tooManyBytes.statusCode).toBe(400)
      expect(wrong.json()).toEqual(short.json())
      expect(fetch).not.toHaveBeenCalled()
      expect(createQueries(db).findUserByUsername('clerk')!.passwordHash).toBe(original)
      expect((await app.inject({ url: '/api/auth/me', cookies: current.cookies })).statusCode).toBe(
        200,
      )
      const audit = db.prepare("SELECT * FROM audit_log WHERE action = 'password_change'").all()
      expect(audit).toHaveLength(3)
      expect(JSON.stringify(audit)).not.toContain(passwords.clerk)
      expect(JSON.stringify(audit)).not.toContain('incorrect-password')
    } finally {
      await app.close()
    }
  })

  it.each(['compromised', 'unavailable'])(
    'handles %s breach checks without leaking audit details',
    async (outcome) => {
      const { app, db } = await boot()
      databases.push(db)
      const newPassword = 'test-only-replacement-password'
      const sha1 = createHash('sha1').update(newPassword).digest('hex').toUpperCase()
      const details = 'private upstream response details'
      vi.mocked(fetch).mockImplementation(async () => {
        if (outcome === 'unavailable') throw new Error(`${details}:${newPassword}:${sha1}`)
        return new Response(`${sha1.slice(5)}:42`)
      })
      try {
        const current = auth(await login(app, 'clerk', passwords.clerk))
        const original = createQueries(db).findUserByUsername('clerk')!.passwordHash
        const response = await app.inject({
          method: 'POST',
          url: '/api/auth/change-password',
          ...current,
          payload: { currentPassword: passwords.clerk, newPassword },
        })
        expect(response.statusCode).toBe(outcome === 'compromised' ? 400 : 204)
        const updated = createQueries(db).findUserByUsername('clerk')!.passwordHash
        if (outcome === 'compromised') {
          expect(response.json()).toEqual({
            error: 'breached-password',
            message: '新密碼曾出現在資料外洩中，請使用其他密碼。',
          })
          expect(updated).toBe(original)
        } else {
          expect(bcrypt.compareSync(newPassword, updated)).toBe(true)
        }
        const audit = db.prepare('SELECT * FROM audit_log').all()
        expect(
          db
            .prepare(
              'SELECT detail, template_id, file_name, category_id, target_username FROM audit_log WHERE action = ?',
            )
            .all('breach_check_unavailable'),
        ).toEqual(
          outcome === 'unavailable'
            ? [
                {
                  detail: '',
                  template_id: '',
                  file_name: '',
                  category_id: '',
                  target_username: '',
                },
              ]
            : [],
        )
        for (const secret of [
          newPassword,
          passwords.clerk,
          sha1,
          sha1.slice(0, 5),
          sha1.slice(5),
          original,
          updated,
          details,
        ]) {
          expect(JSON.stringify(audit)).not.toContain(secret)
        }
        expect(
          (await app.inject({ url: '/api/auth/me', cookies: current.cookies })).statusCode,
        ).toBe(200)
      } finally {
        await app.close()
      }
    },
  )

  it('updates the bcrypt hash, revokes other sessions, and retains the current and other users sessions', async () => {
    const { app, db } = await boot()
    databases.push(db)
    try {
      const current = auth(await login(app, 'clerk', passwords.clerk))
      const otherUser = auth(await login(app, 'viewer', passwords.viewer))
      const queries = createQueries(db)
      const user = queries.findUserByUsername('clerk')!
      const otherTokens = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')]
      for (const token of otherTokens) {
        queries.insertSession(token, user.id, new Date(Date.now() + 60_000).toISOString())
      }
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        ...current,
        payload: { currentPassword: passwords.clerk, newPassword: 'replacement-password-123' },
      })
      expect(response.statusCode).toBe(204)
      expect(response.cookies).toHaveLength(0)
      const hash = queries.findUserById(user.id)!.passwordHash
      expect(hash).not.toBe(user.passwordHash)
      expect(bcrypt.compareSync('replacement-password-123', hash)).toBe(true)
      expect(bcrypt.compareSync(passwords.clerk, hash)).toBe(false)
      for (const token of otherTokens) {
        expect(
          (await app.inject({ url: '/api/auth/me', cookies: { session: token } })).statusCode,
        ).toBe(401)
      }
      for (const cookies of [current.cookies, otherUser.cookies]) {
        expect((await app.inject({ url: '/api/auth/me', cookies })).statusCode).toBe(200)
      }
      expect(
        db.prepare("SELECT result FROM audit_log WHERE action = 'password_change'").all(),
      ).toEqual([{ result: 'allowed' }])
      const audit = JSON.stringify(db.prepare('SELECT * FROM audit_log').all())
      expect(audit).not.toContain('replacement-password-123')
      expect(audit).not.toContain(hash)
      expect((await login(app, 'clerk', passwords.clerk)).statusCode).toBe(401)
      expect((await login(app, 'clerk', 'replacement-password-123')).statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })

  it('requires login and CSRF and limits password changes per user and IP across app restarts', async () => {
    const { app, db } = await boot()
    databases.push(db)
    const payload = { currentPassword: 'wrong-password', newPassword: 'replacement-password-123' }
    const current = auth(await login(app, 'clerk', passwords.clerk))
    const otherUser = auth(await login(app, 'viewer', passwords.viewer))
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/change-password',
          ...current,
          cookies: { csrf: current.cookies.csrf },
          payload,
        })
      ).statusCode,
    ).toBe(401)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/change-password',
          cookies: current.cookies,
          payload,
        })
      ).statusCode,
    ).toBe(403)
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/auth/change-password',
            ...current,
            payload,
          })
        ).statusCode,
      ).toBe(400)
    }
    // A different IP cannot bypass the per-user limit; another user cannot bypass the IP limit.
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/change-password',
          ...current,
          remoteAddress: '192.0.2.40',
          payload,
        })
      ).statusCode,
    ).toBe(429)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/change-password',
          ...otherUser,
          payload,
        })
      ).statusCode,
    ).toBe(429)
    await app.close()
    const restarted = await buildApp(db, config())
    const clock = vi.spyOn(Date, 'now')
    try {
      expect(
        (
          await restarted.inject({
            method: 'POST',
            url: '/api/auth/change-password',
            ...current,
            payload,
          })
        ).statusCode,
      ).toBe(429)
      clock.mockReturnValue(Date.now() + 15 * 60_000 + 1)
      expect(
        (
          await restarted.inject({
            method: 'POST',
            url: '/api/auth/change-password',
            ...current,
            payload,
          })
        ).statusCode,
      ).toBe(400)
    } finally {
      clock.mockRestore()
      await restarted.close()
    }
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
    expect(missingToken.json().error).toBe('csrf')

    const forged = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: clerkAuth.cookies,
      headers: {
        ...file.headers,
        origin,
        'x-csrf-token': '0'.repeat(64),
      },
      payload: file.payload,
    })
    expect(forged.statusCode).toBe(403)
    expect(forged.json().error).toBe('csrf')

    const viewerUpload = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: auth(viewer).cookies,
      headers: { ...file.headers, ...auth(viewer).headers },
      payload: file.payload,
    })
    expect(viewerUpload.statusCode).toBe(403)

    const clerkUpload = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: clerkAuth.cookies,
      headers: { ...file.headers, ...clerkAuth.headers },
      payload: file.payload,
    })
    expect(clerkUpload.statusCode).toBe(403)
    expect(clerkUpload.json().error).toBe('forbidden')

    const adminAuth = auth(admin)
    const uploaded = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: adminAuth.cookies,
      headers: { ...file.headers, ...adminAuth.headers },
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
      ...adminAuth,
    })
    expect(removed.statusCode).toBe(204)
    const audit = db
      .prepare(
        'SELECT actor_username, action, template_id, file_name, category_id, detail, result FROM audit_log ORDER BY id',
      )
      .all() as {
      actor_username: string
      action: string
      file_name: string
      detail: string
      result: string
    }[]
    expect(audit.filter((row) => row.result === 'allowed').map((row) => row.action)).toEqual([
      'upload',
      'delete',
    ])
    expect(audit.filter((row) => row.result === 'denied').map((row) => row.action)).toEqual([
      'upload',
      'upload',
      'delete',
    ])
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
    // Local splitter previews must work with the deployed policy, without broadening it.
    expect(
      policy
        .split(';')
        .find((directive) => directive.trim().startsWith('img-src'))
        ?.trim(),
    ).toBe("img-src 'self'")
    expect(policy).not.toMatch(/blob:|data:/)
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
