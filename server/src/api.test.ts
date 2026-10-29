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
    loginRatePerMinute: 30,
    sampleTemplatePath: samplePath,
    staticDir: undefined,
    trustProxy: false,
    seedDemoUsers: true,
    passwords,
    ...overrides,
  }
}

async function createApp() {
  const config = testConfig()
  const db = openDatabase(':memory:')
  migrate(db)
  seedReferenceData(createQueries(db), passwords, samplePath, config.uploadDir)
  const app = await buildApp(db, config)
  return { app, db }
}

async function login(
  app: Awaited<ReturnType<typeof createApp>>['app'],
  username: string,
  password: string,
) {
  const response = await app.inject({
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
      username: 'clerk',
      displayName: '示範承辦',
      role: 'clerk',
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
    expect(categories.json().categories.map((item: { id: string }) => item.id)).toContain(
      'general-assist',
    )

    const seeded = await app.inject({
      method: 'GET',
      url: '/api/templates',
      cookies: { session: viewerToken },
    })
    expect(seeded.statusCode).toBe(200)
    expect(
      seeded.json().templates.some((item: { id: string }) => item.id === 'sample-field-note'),
    ).toBe(true)

    const upload = multipart(
      { categoryId: 'doc-summary' },
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
    expect(clerkUpload.statusCode).toBe(201)
    const templateId = clerkUpload.json().template.id as string
    expect(clerkUpload.json().template.placeholders).toEqual(['姓名', '日期'])

    const badType = multipart(
      { categoryId: 'doc-summary' },
      { name: 'notes.txt', type: 'text/plain', data: Buffer.from('hello') },
    )
    const rejectedType = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: clerkAuth.cookies,
      headers: { ...badType.headers, ...clerkAuth.headers },
      payload: badType.payload,
    })
    expect(rejectedType.statusCode).toBe(400)

    const badMagic = multipart(
      { categoryId: 'doc-summary' },
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

  it('rejects an oversized upload', async () => {
    const config = testConfig({ maxUploadBytes: 32 })
    const db = openDatabase(':memory:')
    migrate(db)
    seedReferenceData(createQueries(db), passwords, samplePath, config.uploadDir)
    const app = await buildApp(db, config)
    const loggedIn = await login(app, 'admin', passwords.admin)
    const adminAuth = authFrom(loggedIn)
    const body = multipart(
      { categoryId: 'general-assist' },
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
