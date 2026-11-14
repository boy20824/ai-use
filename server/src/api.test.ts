import { loginWithCsrf } from './loginTestHelper.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import PizZip from 'pizzip'
import bcrypt from 'bcryptjs'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from './app.ts'
import type { AppConfig, SeedPasswords } from './config.ts'
import { createQueries, migrate, openDatabase, type AppDatabase } from './db.ts'
import { buildMockPdf } from '../../shared/mockPdfFixture'
import { templateFilePath } from './files.ts'
import { existsSync, readFileSync } from 'node:fs'
import { seedReferenceData } from './seed.ts'

const passwords: SeedPasswords = {
  clerk: 'clerk-pass',
  admin: 'admin-pass',
  viewer: 'viewer-pass',
}

const samplePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../public/samples/field-note.docx',
)

function buildDocx(text: string) {
  const zip = new PizZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
</w:document>`,
  )
  return zip.generate({ type: 'nodebuffer' }) as Uint8Array
}

function multipart(
  fields: Record<string, string>,
  file: { name: string; type: string; data: Uint8Array },
) {
  const boundary = '----ai-use-test'
  const chunks: Uint8Array[] = Object.entries(fields).map(([key, value]) =>
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
    ),
  )
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
    ),
  )
  chunks.push(file.data)
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`))
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

const allowedOrigin = 'http://localhost:5173'
const scratch = mkdtempSync(path.join(tmpdir(), 'ai-use-api-'))

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    databasePath: ':memory:',
    uploadDir: mkdtempSync(path.join(scratch, 'up-')),
    sessionSecret: '',
    sessionTtlHours: 1,
    cookieSecure: false,
    corsOrigins: [allowedOrigin],
    maxUploadBytes: 1024 * 1024,
    maxZipEntries: 32,
    maxZipUncompressedBytes: 8 * 1024 * 1024,
    loginMaxFailures: 5,
    loginLockoutMinutes: 15,
    globalRatePerMinute: 120,
    loginRatePerMinute: 30,
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

async function createApp(overrides: Partial<AppConfig> = {}) {
  const config = testConfig(overrides)
  const db = openDatabase(':memory:')
  migrate(db)
  seedReferenceData(createQueries(db), passwords, samplePath, config.uploadDir, false)
  const app = await buildApp(db, config)
  return { app, db }
}

async function login(
  app: Awaited<ReturnType<typeof createApp>>['app'],
  username: string,
  password: string,
) {
  const response = await loginWithCsrf(app, {
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  })
  return response
}

function sessionCookie(response: {
  cookies: { name: string; value: string; httpOnly?: boolean; sameSite?: string }[]
}) {
  return response.cookies.find((cookie) => cookie.name === 'session')
}

function authFrom(response: { cookies: { name: string; value: string }[] }) {
  const session = response.cookies.find((cookie) => cookie.name === 'session')?.value ?? ''
  const csrf = response.cookies.find((cookie) => cookie.name === 'csrf')?.value ?? ''
  return {
    cookies: { session, csrf },
    headers: { origin: allowedOrigin, 'x-csrf-token': csrf },
  }
}

describe('api', () => {
  const databases: AppDatabase[] = []

  afterEach(() => {
    for (const db of databases.splice(0)) db.close()
  })

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  it('requires login CSRF and Origin checks while accepting legacy cost-10 passwords', async () => {
    const { app, db } = await createApp()
    databases.push(db)
    try {
      const stored = createQueries(db).findUserByUsername('admin')!
      expect(bcrypt.getRounds(stored.passwordHash)).toBe(10)
      const page = await app.inject({ url: '/login' })
      const csrf = page.cookies.find((cookie) => cookie.name === 'csrf')!.value
      const payload = { username: 'admin', password: passwords.admin }
      for (const options of [
        {},
        { cookies: { csrf } },
        { headers: { 'x-csrf-token': csrf } },
        { cookies: { csrf }, headers: { 'x-csrf-token': 'wrong' } },
        { cookies: { csrf }, headers: { 'x-csrf-token': csrf, origin: 'https://evil.example' } },
      ]) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload,
          ...options,
        })
        expect(response.statusCode).toBe(403)
        expect(response.json().error).toBe('csrf')
      }
      expect((await app.inject({ url: '/api/release-notes' })).statusCode).toBe(401)
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload,
        cookies: { csrf },
        headers: { origin: allowedOrigin, 'x-csrf-token': csrf },
      })
      expect(response.statusCode).toBe(200)
      const session = sessionCookie(response)!.value
      expect(
        (await app.inject({ url: '/api/release-notes', cookies: { session } })).statusCode,
      ).toBe(200)
    } finally {
      await app.close()
    }
  })

  it.each(['a', '12345678', ' a '])(
    'accepts short non-blank password %j and stores cost-12 hashes with immediate account access',
    async (password) => {
      const { app, db } = await createApp()
      databases.push(db)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('')))
      try {
        const queries = createQueries(db)
        const admin = authFrom(await login(app, 'admin', passwords.admin))
        const account = { name: 'Mock User', nickname: 'Mock', username: 'mock-new' }
        const register = (secret: string) =>
          app.inject({
            method: 'POST',
            url: '/api/auth/register',
            ...admin,
            payload: { ...account, password: secret, confirmPassword: secret },
          })
        for (const secret of ['', '   ', '密'.repeat(25)]) {
          const rejected = await register(secret)
          expect(rejected.statusCode).toBe(400)
          if (!secret) expect(rejected.json().message).toBe('請填寫密碼。')
        }
        const created = await register(password)
        expect(created.statusCode).toBe(201)
        const user = queries.findUserByUsername(account.username)!
        expect(user.active).toBe(true)
        expect(bcrypt.getRounds(user.passwordHash)).toBe(12)
        const session = sessionCookie(created)!.value
        expect((await app.inject({ url: '/api/auth/me', cookies: { session } })).statusCode).toBe(
          200,
        )
        expect((await login(app, account.username, password)).statusCode).toBe(200)
        const member = (secret: string) =>
          app.inject({
            method: 'POST',
            url: '/api/members',
            ...admin,
            payload: { ...account, username: 'mock-member', password: secret },
          })
        for (const secret of ['', '   ', '密'.repeat(25)]) {
          expect((await member(secret)).statusCode).toBe(400)
        }
        expect((await member(password)).statusCode).toBe(201)
        const memberHash = queries.findUserByUsername('mock-member')!.passwordHash
        expect(bcrypt.getRounds(memberHash)).toBe(12)
        expect(bcrypt.compareSync(password, memberHash)).toBe(true)
        const change = (newPassword: string) =>
          app.inject({
            method: 'POST',
            url: '/api/auth/change-password',
            ...admin,
            payload: { currentPassword: passwords.admin, newPassword },
          })
        for (const secret of ['', '   ', '密'.repeat(25)]) {
          expect((await change(secret)).statusCode).toBe(400)
        }
        expect((await change(password)).statusCode).toBe(204)
        expect(bcrypt.getRounds(queries.findUserByUsername('admin')!.passwordHash)).toBe(12)
        expect((await login(app, 'admin', password)).statusCode).toBe(200)
      } finally {
        vi.unstubAllGlobals()
        await app.close()
      }
    },
  )

  it('accepts generic Mock upload MIME, rejects bad bytes, and lists corrupt placeholders safely', async () => {
    const { app, db } = await createApp()
    databases.push(db)
    // Busboy maps a missing/empty multipart Content-Type to text/plain.
    // Also exercise a truly empty parsed mimetype independently of that fallback.
    app.addHook('preHandler', async (request) => {
      if (request.headers['x-mock-empty-mime'] === '1') {
        const file = await request.file()
        if (file) vi.spyOn(request, 'file').mockResolvedValue({ ...file, mimetype: '' })
      }
    })
    try {
      const admin = authFrom(await login(app, 'admin', passwords.admin))
      const send = async (name: string, type: string, data: Uint8Array) => {
        const upload = multipart({}, { name, type: type || 'application/octet-stream', data })
        return app.inject({
          method: 'POST',
          url: '/api/templates',
          cookies: admin.cookies,
          headers: {
            ...admin.headers,
            ...upload.headers,
            ...(type === '' ? { 'x-mock-empty-mime': '1' } : {}),
          },
          payload: upload.payload,
        })
      }
      const ids: string[] = []
      for (const type of ['', 'application/x-zip-compressed', 'application/x-zip', 'text/plain']) {
        const response = await send('Mock.docx', type, buildDocx('{{MockField}}'))
        expect(response.statusCode, `${type}: ${response.body}`).toBe(201)
        expect(response.json().template.placeholders).toEqual(['MockField'])
        ids.push(response.json().template.id)
      }
      expect(
        (await send('Mock.docx', 'application/javascript', buildDocx('Mock'))).statusCode,
      ).toBe(400)
      for (const type of ['', 'text/plain']) {
        expect((await send('Mock.docx', type, Buffer.from('Mock invalid ZIP'))).statusCode).toBe(
          400,
        )
        // ZIP magic alone cannot bypass the server Word parser.
        expect(
          (await send('Mock.docx', type, Buffer.from('PKxxMock invalid archive'))).statusCode,
        ).toBe(400)
        expect((await send('Mock.pdf', type, buildMockPdf())).statusCode).toBe(201)
        expect((await send('Mock.pdf', type, Buffer.from('Mock invalid PDF'))).statusCode).toBe(400)
      }
      db.prepare('UPDATE templates SET placeholders = ? WHERE id = ?').run('not-json', ids[0]!)
      db.prepare('UPDATE templates SET placeholders = ? WHERE id = ?').run(
        '{"Mock":"value"}',
        ids[1]!,
      )
      const response = await app.inject({ url: '/api/templates', cookies: admin.cookies })
      expect(response.statusCode).toBe(200)
      expect(response.json().templates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: ids[0], placeholders: [] }),
          expect.objectContaining({ id: ids[1], placeholders: [] }),
          expect.objectContaining({ id: ids[2], placeholders: ['MockField'] }),
        ]),
      )
    } finally {
      await app.close()
    }
  })

  it('stores Mock PDFs as reference documents, serves exact bytes to viewers, and cascades deletion', async () => {
    const { app, db } = await createApp()
    databases.push(db)
    try {
      const admin = authFrom(await login(app, 'admin', passwords.admin))
      const viewer = authFrom(await login(app, 'viewer', passwords.viewer))
      const category = await app.inject({
        method: 'POST',
        url: '/api/categories',
        ...admin,
        payload: { name: 'Mock PDF', summary: '', steps: [{ body: 'Mock step', templateIds: [] }] },
      })
      expect(category.statusCode).toBe(201)
      const { id: categoryId, steps } = category.json().category
      const data = buildMockPdf()
      const upload = multipart(
        { stepId: steps[0].id },
        { name: '作業規定（Mock）.pdf', type: 'application/pdf', data },
      )
      const uploaded = await app.inject({
        method: 'POST',
        url: '/api/templates',
        cookies: admin.cookies,
        headers: { ...admin.headers, ...upload.headers },
        payload: upload.payload,
      })
      expect(uploaded.statusCode).toBe(201)
      const template = uploaded.json().template
      expect(template).toMatchObject({
        kind: 'pdf',
        fileName: '作業規定（Mock）.pdf',
        mimeType: 'application/pdf',
        placeholders: [],
        sizeBytes: data.length,
      })
      expect(uploaded.json().formatNotices).toEqual([])
      const list = await app.inject({
        url: `/api/templates?categoryId=${categoryId}`,
        cookies: viewer.cookies,
      })
      expect(list.json().templates).toEqual([
        expect.objectContaining({ id: template.id, kind: 'pdf', placeholders: [] }),
      ])
      for (const query of ['', '?inline=1', '?disposition=inline']) {
        const url = `/api/templates/${template.id}/file${query}`
        expect((await app.inject({ url })).statusCode).toBe(401)
        const file = await app.inject({ url, cookies: viewer.cookies })
        expect(file.statusCode).toBe(200)
        expect(file.headers['content-disposition']).toMatch(query ? /^inline;/ : /^attachment;/)
        expect(file.headers['content-disposition']).toContain(encodeURIComponent(template.fileName))
        expect(file.headers['content-type']).toBe('application/pdf')
        expect(file.headers['x-content-type-options']).toBe('nosniff')
        expect(file.rawPayload).toEqual(Buffer.from(data))
      }
      for (const query of [
        '?inline=0',
        '?inline=anything',
        '?disposition=attachment',
        '?disposition=anything',
        '?inline=1&inline=1',
      ]) {
        expect(
          (
            await app.inject({
              url: `/api/templates/${template.id}/file${query}`,
              cookies: viewer.cookies,
            })
          ).statusCode,
        ).toBe(400)
      }
      const attached = await app.inject({
        url: `/api/categories/${categoryId}`,
        cookies: viewer.cookies,
      })
      expect(attached.json().category.steps[0].templateIds).toEqual([template.id])
      expect(
        (await app.inject({ method: 'DELETE', url: `/api/templates/${template.id}`, ...viewer }))
          .statusCode,
      ).toBe(403)
      expect(
        (await app.inject({ method: 'DELETE', url: `/api/templates/${template.id}`, ...admin }))
          .statusCode,
      ).toBe(204)
      const unlinked = await app.inject({
        url: `/api/categories/${categoryId}`,
        cookies: viewer.cookies,
      })
      expect(unlinked.json().category.steps[0].templateIds).toEqual([])
      expect(
        (await app.inject({ url: `/api/templates/${template.id}/file`, cookies: viewer.cookies }))
          .statusCode,
      ).toBe(404)
      expect(
        db
          .prepare(
            "SELECT action FROM audit_log WHERE template_id = ? AND result = 'allowed' ORDER BY id",
          )
          .all(template.id),
      ).toEqual([{ action: 'upload' }, { action: 'delete' }])
    } finally {
      await app.close()
    }
  })

  it.each([64, 2048])(
    'rejects incorrect PDF magic, extension and MIME, enforces per-kind limits, and counts PDF quota bytes (Word cap %i)',
    async (maxUploadBytes) => {
      const data = buildMockPdf()
      const config = testConfig({
        maxUploadBytes,
        maxPdfUploadBytes: data.length,
        templateBytesGlobal: data.length,
      })
      const db = openDatabase(':memory:')
      migrate(db)
      databases.push(db)
      seedReferenceData(createQueries(db), passwords, samplePath, config.uploadDir, false)
      const app = await buildApp(db, config)
      try {
        const admin = authFrom(await login(app, 'admin', passwords.admin))
        const post = async (name: string, type: string, bytes: Uint8Array) => {
          const file = multipart({}, { name, type, data: bytes })
          return app.inject({
            method: 'POST',
            url: '/api/templates',
            cookies: admin.cookies,
            headers: { ...admin.headers, ...file.headers },
            payload: file.payload,
          })
        }
        for (const [name, type, bytes] of [
          ['Mock.pdf', 'application/pdf', new TextEncoder().encode('Mock non-PDF')],
          ['Mock.pdf', 'application/pdf', new TextEncoder().encode(' %PDF-1.4')],
          ['Mock.pdf', 'application/javascript', data],
          ['Mock.pdf', 'application/octet-stream', data],
          ['Mock.docx', 'application/pdf', data],
          ['Mock.txt', 'application/pdf', data],
        ] as const) {
          const rejected = await post(name, type, bytes)
          expect(rejected.statusCode).toBe(400)
          expect(rejected.json().message).toMatch(/PDF|MIME|docx/)
        }
        const tooLarge = await post(
          'Mock.pdf',
          'application/pdf',
          Buffer.concat([data, Buffer.from('Mock')]),
        )
        expect(tooLarge.statusCode).toBe(413)
        expect(tooLarge.json().message).toContain('大小')
        // PDF may exceed the Word cap, but still uses a random .pdf storage path.
        const accepted = await post('Mock.pdf', 'application/pdf', data)
        expect(accepted.statusCode).toBe(201)
        const id = accepted.json().template.id
        expect(readFileSync(templateFilePath(config.uploadDir, id, 'pdf'))).toEqual(
          Buffer.from(data),
        )
        expect(existsSync(templateFilePath(config.uploadDir, id))).toBe(false)
        expect((await post('Mock.pdf', 'application/pdf', data)).statusCode).toBe(429)
      } finally {
        await app.close()
      }
    },
  )

  it('replaces reference bytes only with the same kind and keeps legacy Word paths', async () => {
    const { app, db } = await createApp()
    databases.push(db)
    try {
      const admin = authFrom(await login(app, 'admin', passwords.admin))
      const send = async (
        method: 'POST' | 'PUT',
        url: string,
        name: string,
        type: string,
        data: Uint8Array,
      ) => {
        const file = multipart({}, { name, type, data })
        return app.inject({
          method,
          url,
          cookies: admin.cookies,
          headers: { ...admin.headers, ...file.headers },
          payload: file.payload,
        })
      }
      const data = buildMockPdf()
      const pdf = await send('POST', '/api/templates', 'Mock.pdf', 'application/pdf', data)
      const wordMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      const docx = await send(
        'POST',
        '/api/templates',
        'Mock.docx',
        wordMime,
        buildDocx('{{MockField}}'),
      )
      expect(pdf.statusCode).toBe(201)
      expect(docx.statusCode).toBe(201)
      expect(docx.json().template).toMatchObject({ kind: 'docx', placeholders: ['MockField'] })
      const pdfUrl = `/api/templates/${pdf.json().template.id}/file`
      const docxUrl = `/api/templates/${docx.json().template.id}/file`
      expect((await send('PUT', pdfUrl, 'Mock.docx', wordMime, buildDocx('Mock'))).statusCode).toBe(
        400,
      )
      expect((await send('PUT', docxUrl, 'Mock.pdf', 'application/pdf', data)).statusCode).toBe(400)
      const replacement = Buffer.concat([data, Buffer.from('% Mock replacement\n')])
      expect(
        (await send('PUT', pdfUrl, 'Mock-new.pdf', 'application/pdf', replacement)).statusCode,
      ).toBe(200)
      expect((await app.inject({ url: pdfUrl, cookies: admin.cookies })).rawPayload).toEqual(
        replacement,
      )
      expect(
        (await send('PUT', docxUrl, 'Mock-new.docx', wordMime, buildDocx('{{MockNew}}')))
          .statusCode,
      ).toBe(200)
      const file = await app.inject({ url: docxUrl, cookies: admin.cookies })
      expect(file.statusCode).toBe(200)
      expect(file.headers['content-type']).toBe(wordMime)
      expect(file.headers['x-content-type-options']).toBe('nosniff')
    } finally {
      await app.close()
    }
  })

  it('adds kind to existing SQLite rows without altering legacy Word bytes or links', () => {
    const db = openDatabase(':memory:')
    migrate(db)
    databases.push(db)
    const q = createQueries(db)
    const data = Buffer.from(buildDocx('{{MockField}}'))
    q.insertTemplate({
      kind: 'docx',
      id: 'mock-legacy',
      fileName: 'Mock.docx',
      mimeType: 'application/zip',
      sizeBytes: data.length,
      addedAt: 'Mock',
      placeholders: ['MockField'],
      origin: 'upload',
      usages: [],
      data,
    })
    q.createCategory(
      {
        id: 'mock-category',
        code: '',
        name: 'Mock',
        summary: '',
        updatedAt: 'Mock',
        steps: [{ id: 'mock-step', body: 'Mock', templateIds: ['mock-legacy'] }],
      },
      'Mock',
    )
    db.exec('ALTER TABLE templates DROP COLUMN kind')
    migrate(db)
    migrate(db)
    expect(createQueries(db).getTemplateFile('mock-legacy')).toMatchObject({
      kind: 'docx',
      data,
      placeholders: ['MockField'],
    })
    expect(createQueries(db).getCategory('mock-category')!.steps[0]!.templateIds).toEqual([
      'mock-legacy',
    ])
    expect(() => db.prepare('UPDATE templates SET kind = ?').run('other')).toThrow()
  })

  it('limits requests per IP across routes and resets after one minute', async () => {
    const db = openDatabase(':memory:')
    migrate(db)
    const app = await buildApp(db, testConfig({ globalRatePerMinute: 2 }))
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      expect((await app.inject('/api/auth/me')).statusCode).toBe(401)
      expect((await app.inject('/api/categories')).statusCode).toBe(401)
      const blocked = await app.inject('/api/auth/me')
      expect(blocked.statusCode).toBe(429)
      expect(blocked.json()).toEqual({
        error: 'rate-limited',
        message: '請求過多，請稍後再試。',
      })
      expect(blocked.headers['retry-after']).toBe('60')
      expect(
        (await app.inject({ url: '/api/auth/me', remoteAddress: '192.0.2.1' })).statusCode,
      ).toBe(401)
      clock.mockReturnValue(now + 60_000)
      expect((await app.inject('/api/auth/me')).statusCode).toBe(401)
    } finally {
      clock.mockRestore()
      await app.close()
      db.close()
    }
  })

  it('exempts health checks, including query strings, from consuming the quota', async () => {
    const db = openDatabase(':memory:')
    migrate(db)
    const app = await buildApp(db, testConfig({ globalRatePerMinute: 1 }))
    try {
      for (let index = 0; index < 3; index += 1) {
        const health = await app.inject('/healthz?probe=1')
        expect(health.statusCode).toBe(200)
        expect(health.json()).toEqual({ ok: true })
      }
      expect((await app.inject('/api/auth/me')).statusCode).toBe(401)
      expect((await app.inject('/api/auth/me')).statusCode).toBe(429)
      const health = await app.inject('/healthz')
      expect(health.statusCode).toBe(200)
      expect(health.json()).toEqual({ ok: true })
    } finally {
      await app.close()
      db.close()
    }
  })

  it('logs in with a bcrypt hash, restores the session, and logs out', async () => {
    const { app, db } = await createApp()
    databases.push(db)
    const stored = createQueries(db).findUserByUsername('clerk')
    expect(stored?.passwordHash.startsWith('$2')).toBe(true)
    expect(stored?.passwordHash).not.toContain(passwords.clerk)

    const failed = await login(app, "' OR 1=1 --", passwords.clerk)
    expect(failed.statusCode).toBe(400)
    expect(JSON.stringify(failed.json())).not.toContain('stack')

    const loggedIn = await login(app, 'clerk', passwords.clerk)
    expect(loggedIn.statusCode).toBe(200)
    expect(loggedIn.json().user).toEqual({
      id: 'user-clerk',
      username: 'clerk',
      displayName: '示範承辦',
      nickname: '承辦',
      role: 'user',
      canManageCategories: false,
    })
    expect(JSON.stringify(loggedIn.json())).not.toContain('password')
    const cookie = sessionCookie(loggedIn)
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('Strict')

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { session: cookie!.value },
    })
    expect(me.statusCode).toBe(200)
    expect(me.json().user.username).toBe('clerk')

    const loggedOut = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      ...authFrom(loggedIn),
    })
    expect(loggedOut.statusCode).toBe(204)
    const after = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { session: cookie!.value },
    })
    expect(after.statusCode).toBe(401)
  })

  it('lists categories and enforces template roles', async () => {
    const { app, db } = await createApp()
    databases.push(db)
    const anonymous = await app.inject({ method: 'GET', url: '/api/categories' })
    expect(anonymous.statusCode).toBe(401)

    const clerk = await login(app, 'clerk', passwords.clerk)
    const admin = await login(app, 'admin', passwords.admin)
    const viewer = await login(app, 'viewer', passwords.viewer)
    const clerkAuth = authFrom(clerk)
    const adminAuth = authFrom(admin)
    const viewerAuth = authFrom(viewer)
    const viewerToken = viewerAuth.cookies.session

    const categories = await app.inject({
      method: 'GET',
      url: '/api/categories',
      cookies: { session: viewerToken },
    })
    expect(categories.statusCode).toBe(200)
    expect(categories.json().categories).toEqual([])

    const created = await app.inject({
      method: 'POST',
      url: '/api/categories',
      ...adminAuth,
      payload: { name: '文件摘要', code: 'SUM', summary: '摘要用', steps: [{ body: '核對原文' }] },
    })
    expect(created.statusCode).toBe(201)
    const categoryId = created.json().category.id as string

    const seeded = await app.inject({
      method: 'GET',
      url: '/api/templates',
      cookies: { session: viewerToken },
    })
    expect(seeded.statusCode).toBe(200)
    expect(seeded.json().templates).toEqual([])

    const upload = multipart(
      { categoryId },
      {
        name: 'summary.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        data: buildDocx('申請人：{{姓名}}　日期：{{日期}}'),
      },
    )
    const viewerUpload = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: viewerAuth.cookies,
      headers: { ...upload.headers, ...viewerAuth.headers },
      payload: upload.payload,
    })
    expect(viewerUpload.statusCode).toBe(403)

    const clerkUpload = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: clerkAuth.cookies,
      headers: { ...upload.headers, ...clerkAuth.headers },
      payload: upload.payload,
    })
    expect(clerkUpload.statusCode).toBe(403)
    expect(clerkUpload.json().error).toBe('forbidden')

    const adminUpload = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: adminAuth.cookies,
      headers: { ...upload.headers, ...adminAuth.headers },
      payload: upload.payload,
    })
    expect(adminUpload.statusCode).toBe(201)
    const templateId = adminUpload.json().template.id as string
    expect(adminUpload.json().template.placeholders).toEqual(['姓名', '日期'])

    const badType = multipart(
      { categoryId },
      { name: 'notes.txt', type: 'text/plain', data: Buffer.from('hello') },
    )
    const rejectedType = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: adminAuth.cookies,
      headers: { ...badType.headers, ...adminAuth.headers },
      payload: badType.payload,
    })
    expect(rejectedType.statusCode).toBe(400)

    const badMagic = multipart(
      { categoryId },
      {
        name: 'fake.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        data: Buffer.from('this is not a zip'),
      },
    )
    const rejectedMagic = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: adminAuth.cookies,
      headers: { ...badMagic.headers, ...adminAuth.headers },
      payload: badMagic.payload,
    })
    expect(rejectedMagic.statusCode).toBe(400)

    const file = await app.inject({
      method: 'GET',
      url: `/api/templates/${templateId}/file`,
      cookies: { session: viewerToken },
    })
    expect(file.statusCode).toBe(200)
    expect(file.body.includes('姓名')).toBe(true)

    const clerkDelete = await app.inject({
      method: 'DELETE',
      url: `/api/templates/${templateId}`,
      ...clerkAuth,
    })
    expect(clerkDelete.statusCode).toBe(403)

    const adminDelete = await app.inject({
      method: 'DELETE',
      url: `/api/templates/${templateId}`,
      ...adminAuth,
    })
    expect(adminDelete.statusCode).toBe(204)

    const columns = db.prepare("SELECT name FROM pragma_table_info('templates')").all() as {
      name: string
    }[]
    expect(columns.map((column) => column.name)).not.toContain('姓名')
    expect(columns.map((column) => column.name)).not.toContain('case_values')
  })

  it('accepts a template larger than the JSON body limit within the upload limit', async () => {
    const config = testConfig({ maxUploadBytes: 2 * 1024 * 1024 })
    const db = openDatabase(':memory:')
    migrate(db)
    seedReferenceData(createQueries(db), passwords, samplePath, config.uploadDir, false)
    const app = await buildApp(db, config)
    try {
      const adminAuth = authFrom(await login(app, 'admin', passwords.admin))
      // Large passive payload, with bounded XML paragraph complexity.
      const archive = new PizZip(buildDocx('large document'))
      archive.file('word/media/image.png', Buffer.alloc(1024 * 1024))
      const data = archive.generate({ type: 'nodebuffer' }) as Uint8Array
      expect(data.byteLength).toBeGreaterThan(1024 * 1024)
      const body = multipart(
        {},
        {
          name: 'large.docx',
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          data,
        },
      )
      const response = await app.inject({
        method: 'POST',
        url: '/api/templates',
        cookies: adminAuth.cookies,
        headers: { ...body.headers, ...adminAuth.headers },
        payload: body.payload,
      })
      expect(response.statusCode).toBe(201)
    } finally {
      await app.close()
      db.close()
    }
  })

  it('rejects a JSON body above 1 MiB with the existing JSON error format', async () => {
    const { app, db } = await createApp()
    try {
      const response = await loginWithCsrf(app, {
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'a'.repeat(1024 * 1024), password: 'password' },
      })
      expect(response.statusCode).toBe(413)
      expect(response.json().error).toBe('payload-too-large')
    } finally {
      await app.close()
      db.close()
    }
  })

  it('rejects an oversized upload', async () => {
    const config = testConfig({ maxUploadBytes: 32 })
    const db = openDatabase(':memory:')
    migrate(db)
    seedReferenceData(createQueries(db), passwords, samplePath, config.uploadDir, false)
    const app = await buildApp(db, config)
    const loggedIn = await login(app, 'admin', passwords.admin)
    const adminAuth = authFrom(loggedIn)
    const body = multipart(
      {},
      {
        name: 'big.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        data: Buffer.alloc(64, 1),
      },
    )
    const response = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: adminAuth.cookies,
      headers: { ...body.headers, ...adminAuth.headers },
      payload: body.payload,
    })
    expect(response.statusCode).toBe(413)
    await app.close()
    db.close()
  })
})
