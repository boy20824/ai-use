import { afterEach, describe, expect, it, vi } from 'vitest'
import PizZip from 'pizzip'
import bcrypt from 'bcryptjs'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { assertSafeZip, listPlaceholders, normalizeDocx, normalizeWordXml } from './docxXml.ts'
import { createQueries, migrate, openDatabase } from './db.ts'
import { buildApp } from './app.ts'
import type { AppConfig } from './config.ts'

const limits = { maxEntries: 64, maxUncompressedBytes: 1024 * 1024 }
const mainType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
const contentNS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const relNS = 'http://schemas.openxmlformats.org/package/2006/relationships'
function zip(extra: Record<string, string> = {}, type = mainType) {
  const z = new PizZip()
  z.file(
    '[Content_Types].xml',
    `<Types xmlns="${contentNS}"><Override PartName="/word/document.xml" ContentType="${type}"/></Types>`,
  )
  z.file(
    'word/document.xml',
    '<w:document xmlns:w="urn:word"><w:p><w:r><w:t>{{name}}</w:t></w:r></w:p></w:document>',
  )
  for (const [key, value] of Object.entries(extra)) z.file(key, value)
  return z.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
}
function central(data: Buffer) {
  return data.indexOf(Buffer.from('504b0102', 'hex'))
}
function addZipFlags(data: Buffer, method: number, flags: number) {
  let patched = 0
  for (let n = central(data); data.readUInt32LE(n) === 0x02014b50;) {
    if (data.readUInt16LE(n + 10) === method) {
      const local = data.readUInt32LE(n + 42)
      expect(data.readUInt32LE(local)).toBe(0x04034b50)
      data.writeUInt16LE(data.readUInt16LE(local + 6) | flags, local + 6)
      data.writeUInt16LE(data.readUInt16LE(n + 8) | flags, n + 8)
      patched++
    }
    n += 46 + data.readUInt16LE(n + 28) + data.readUInt16LE(n + 30) + data.readUInt16LE(n + 32)
  }
  expect(patched).toBeGreaterThan(0)
  return data
}

describe('bounded ZIP and passive DOCX', () => {
  it.each([0x2, 0x4, 0x6])('accepts Deflate compression hints %#', (flags) => {
    const data = addZipFlags(zip(), 8, flags)
    expect(() => assertSafeZip(data, limits)).not.toThrow()
    const normalized = normalizeDocx(data, limits)
    expect(listPlaceholders(normalized.data, limits)).toEqual(['name'])
  })
  it.each([0x1, 0x40, 0x2000, 0x10])('rejects unsupported Deflate flags %#', (flags) => {
    const data = addZipFlags(zip(), 8, flags | 0x6)
    expect(() => assertSafeZip(data, limits)).toThrow('unsupported-zip')
    expect(() => normalizeDocx(data, limits)).toThrow('unsupported-zip')
  })
  it.each([0x2, 0x4, 0x6])('rejects Deflate compression hints on stored entries %#', (flags) => {
    const stored = new PizZip(zip()).generate({
      type: 'nodebuffer',
      compression: 'STORE',
    }) as Buffer
    const data = addZipFlags(stored, 0, flags)
    expect(() => assertSafeZip(data, limits)).toThrow('unsupported-zip')
    expect(() => normalizeDocx(data, limits)).toThrow('unsupported-zip')
  })
  it('requires local flags to match the central directory even for allowed Deflate hints', () => {
    const data = addZipFlags(zip(), 8, 0x6)
    const n = central(data)
    const local = data.readUInt32LE(n + 42)
    data.writeUInt16LE(data.readUInt16LE(n + 8) & ~0x6, local + 6)
    expect(() => assertSafeZip(data, limits)).toThrow('bad-local')
    expect(() => normalizeDocx(data, limits)).toThrow('bad-local')
  })
  it('keeps a valid compressed document within 8 MiB after a small formatting repair', () => {
    const maxCompressedBytes = 8 * 1024 * 1024
    const uploadLimits = { ...limits, maxCompressedBytes, maxUncompressedBytes: 32 * 1024 * 1024 }
    const document = new PizZip(zip())
    document.file(
      'word/document.xml',
      '<w:document xmlns:w="urn:word"><w:p><w:r><w:t>{{na</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>me}}</w:t></w:r></w:p></w:document>',
    )
    // A deterministic passive binary part with a moderate, non-bomb compression ratio.
    const media = new Uint8Array(9 * 1024 * 1024)
    let seed = 42
    for (let i = 0; i < media.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      media[i] = seed >>> 28
    }
    document.file('word/media/image.png', media)
    expect(document.generate({ type: 'uint8array', compression: 'STORE' }).length).toBeGreaterThan(
      maxCompressedBytes,
    )
    const data = document.generate({ type: 'uint8array', compression: 'DEFLATE' })
    expect(data.length).toBeLessThan(maxCompressedBytes)
    assertSafeZip(data, uploadLimits)
    const normalized = normalizeDocx(data, uploadLimits)
    expect(normalized.notices).toEqual(['name'])
    expect(Buffer.from(normalized.data).equals(data)).toBe(false)
    expect(normalized.data.length).toBeLessThan(maxCompressedBytes)
    assertSafeZip(normalized.data, uploadLimits)
    expect(listPlaceholders(normalized.data, uploadLimits)).toEqual(['name'])
    expect(
      Buffer.from(new PizZip(normalized.data).file('word/media/image.png')!.asUint8Array()).equals(
        media,
      ),
    ).toBe(true)
    expect(() =>
      normalizeDocx(data, { ...uploadLimits, maxUncompressedBytes: maxCompressedBytes }),
    ).toThrow('too-large')
    expect(() =>
      normalizeDocx(data, { ...uploadLimits, maxCompressedBytes: data.length - 1 }),
    ).toThrow()
  }, 15000)
  it('accepts passive DOCX and detects actual directory count, local metadata, disks and ZIP64', () => {
    const data = zip()
    expect(normalizeDocx(data, limits).data).toEqual(data)
    for (const mutate of [
      (b: Buffer) => b.writeUInt16LE(0, b.length - 12),
      (b: Buffer) => b.writeUInt16LE(1, b.length - 18),
      (b: Buffer) => b.writeUInt16LE(65535, b.length - 12),
      (b: Buffer) => b.writeUInt32LE(0xffffffff, central(b) + 42),
      (b: Buffer) => b.writeUInt32LE(0, b.length - 10),
      (b: Buffer) => b.writeUInt16LE(1, central(b) + 34),
      (b: Buffer) => b.writeUInt32LE(1, 18),
    ]) {
      const forged = Buffer.from(data)
      mutate(forged)
      expect(() => assertSafeZip(forged, limits)).toThrow()
    }
    expect(() => assertSafeZip(data, { ...limits, maxEntries: 1 })).toThrow()
    expect(() => normalizeDocx(zip({ '../escape': 'x' }), limits)).toThrow()
  })
  it('stops forged inflation at the output budget rather than trusting declared sizes', () => {
    const z = new PizZip()
    z.file('payload', 'x'.repeat(8192))
    const data = z.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
    data.writeUInt32LE(1, 22)
    data.writeUInt32LE(1, central(data) + 24)
    expect(() => assertSafeZip(data, { maxEntries: 1, maxUncompressedBytes: 1024 })).toThrow(
      /larger than|too-large/i,
    )
  })
  it('rejects active paths, content types, namespace and casing variants, unsafe XML', () => {
    for (const extra of [
      { 'WORD/VbApRoJeCt.BIN': 'marker' },
      { 'word/ActiveX/item.bin': 'marker' },
      { 'word/embeddings/item.bin': 'marker' },
      {
        'word/_rels/document.xml.rels': `<r:Relationships xmlns:r="${relNS}"><r:Relationship Target="https://invalid.example/" TargetMode="eXtErNaL"/></r:Relationships>`,
      },
      {
        'word/_rels/document.xml.rels': `<Relationships xmlns="${relNS}"><Relationship Target="&#104;ttps://invalid.example/"/></Relationships>`,
      },
      {
        'word/_rels/document.xml.rels':
          '<Relationships xmlns="urn:unknown"><Relationship Target="local"/></Relationships>',
      },
      { 'word/_rels/document.xml.rels': '<broken' },
      { 'word/document.xml': '<'.repeat(100000) },
      { 'word/document.xml': '<!DOCTYPE a [<!ENTITY x "x">]><a/>' },
      { 'word/document.xml': '<a>'.repeat(65) + '</a>'.repeat(65) },
      { 'word/document.xml': '<a>' + '<b/>'.repeat(20001) + '</a>' },
      { '[Content_Types].xml': '<Types/>' },
      {
        '[Content_Types].xml': `<p:Types xmlns:p="urn:wrong"><p:Override PartName="/word/document.xml" ContentType="${mainType}"/></p:Types>`,
      },
      { 'word/document.xml': '<a xmlns:q="urn:variant"><q:OLEObject/></a>' },
    ] as Record<string, string>[])
      expect(() => normalizeDocx(zip(extra), limits)).toThrow()
    expect(() =>
      normalizeDocx(zip({}, 'application/vnd.ms-word.document.macroEnabled.main+xml'), limits),
    ).toThrow()
    expect(() => normalizeWordXml('<w:p>' + 'x'.repeat(65537) + '</w:p>')).toThrow()
  })
})

const disposers: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
  vi.restoreAllMocks()
})
async function boot(overrides: Partial<AppConfig> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hardening-'))
  const db = openDatabase(':memory:')
  migrate(db)
  disposers.push(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const queries = createQueries(db)
  for (const id of ['admin', 'other'])
    queries.insertUser({
      id,
      username: id,
      passwordHash: bcrypt.hashSync('p'.repeat(73), 4),
      displayName: id,
      nickname: id,
      role: id === 'admin' ? 'sysadmin' : 'user',
    })
  const config: AppConfig = {
    host: '127.0.0.1',
    port: 0,
    databasePath: ':memory:',
    uploadDir: dir,
    sessionSecret: '',
    sessionTtlHours: 1,
    cookieSecure: false,
    corsOrigins: ['http://localhost'],
    maxUploadBytes: 1024 * 1024,
    maxZipEntries: 64,
    maxZipUncompressedBytes: 1024 * 1024,
    loginMaxFailures: 3,
    loginLockoutMinutes: 15,
    globalRatePerMinute: 1000,
    loginRatePerMinute: 1000,
    registerIpLimit: 100,
    registerGlobalLimit: 100,
    registerWindowMs: 3600000,
    sampleTemplatePath: '',
    seedSampleData: false,
    staticDir: undefined,
    trustProxy: false,
    seedDemoUsers: false,
    passwords: undefined,
    ...overrides,
  }
  const app = await buildApp(db, config)
  disposers.push(() => app.close())
  async function auth(username = 'admin') {
    const result = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password: 'p'.repeat(73) },
    })
    expect(result.statusCode).toBe(200)
    const cookies = Object.fromEntries(result.cookies.map((c) => [c.name, c.value]))
    return { cookies, headers: { origin: 'http://localhost', 'x-csrf-token': cookies.csrf! } }
  }
  return { db, app, queries, auth, dir, config }
}

it('normalizes historical and alternating ASCII login names for counting and clearing', async () => {
  const { db, queries, app } = await boot()
  db.prepare('INSERT INTO login_events(username, ip, success, created_at) VALUES (?, ?, 0, ?)').run(
    'AdMiN',
    'old',
    Date.now(),
  )
  migrate(db)
  expect(queries.recentFailures('ADMIN', 0)).toBe(1)
  for (const username of ['aDmIn', 'ADmin']) {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { username, password: 'wrong' },
        })
      ).statusCode,
    ).toBe(401)
  }
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'ADMIN', password: 'p'.repeat(73) },
      })
    ).statusCode,
  ).toBe(429)
  queries.clearFailures('AdMiN')
  expect(queries.recentFailures('admin', 0)).toBe(0)
})

it('rejects over-72-byte new passwords at every entry point while preserving legacy login', async () => {
  const { app, auth } = await boot()
  const admin = await auth()
  for (const password of ['a'.repeat(73), '密'.repeat(25)]) {
    const account = { name: '測試', nickname: '測試', username: 'newuser', password }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/register',
          ...admin,
          payload: { ...account, confirmPassword: password },
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (await app.inject({ method: 'POST', url: '/api/members', ...admin, payload: account }))
        .statusCode,
    ).toBe(400)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/change-password',
          ...admin,
          payload: { currentPassword: 'p'.repeat(73), newPassword: password },
        })
      ).statusCode,
    ).toBe(400)
  }
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        ...admin,
        payload: {
          name: '測試',
          nickname: '測試',
          username: 'boundary',
          password: '密'.repeat(24),
          confirmPassword: '密'.repeat(24),
        },
      })
    ).statusCode,
  ).toBe(201)
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: 'p'.repeat(72) },
      })
    ).statusCode,
  ).toBe(200)
})

it('enforces account/global quotas, bounded pages, and keeps shared reading', async () => {
  const { app, auth, queries } = await boot({ feedbackPerAccount: 1, feedbackGlobal: 1 })
  const admin = await auth(),
    other = await auth('other')
  const payload = { title: 'test', content: 'content' }
  expect(
    (await app.inject({ method: 'POST', url: '/api/feedback', ...admin, payload })).statusCode,
  ).toBe(201)
  for (const account of [admin, other])
    expect(
      (await app.inject({ method: 'POST', url: '/api/feedback', ...account, payload })).statusCode,
    ).toBe(429)
  expect((await app.inject({ url: '/api/feedback?limit=1', ...other })).json().posts).toHaveLength(
    1,
  )
  expect((await app.inject({ url: '/api/feedback?offset=1', ...admin })).json().posts).toHaveLength(
    0,
  )
  expect((await app.inject({ url: '/api/templates?limit=101', ...admin })).statusCode).toBe(400)
  expect((await app.inject({ url: '/api/feedback?offset=-1', ...admin })).statusCode).toBe(400)
  const record = {
    id: 't',
    fileName: 't.docx',
    mimeType: 'application/zip',
    sizeBytes: 10,
    addedAt: new Date().toISOString(),
    placeholders: [],
    origin: 'upload' as const,
    usages: [],
    data: Buffer.alloc(10),
  }
  queries.insertTemplate(record)
  queries.setTemplateOwner('t', 'admin')
  expect(queries.templateQuota('admin', 1, '', 1, 10, 100, 100)).toBe(false)
  expect(queries.templateQuota('other', 1, '', 10, 1, 100, 100)).toBe(false)
  expect(queries.templateQuota('admin', 101, 't', 1, 1, 100, 100)).toBe(false)
  expect(queries.templateQuota('admin', 10, 't', 1, 1, 10, 10)).toBe(true)
  expect(
    (await app.inject({ url: '/api/templates?limit=1', ...other })).json().templates,
  ).toHaveLength(1)
  expect(
    (await app.inject({ url: '/api/templates?offset=1', ...other })).json().templates,
  ).toHaveLength(0)
})

it('cleans only expired events/sessions and preserves audit without explicit archive configuration', async () => {
  const { db, queries } = await boot()
  queries.recordLogin('admin', 'test', false)
  db.prepare('INSERT INTO login_events(username, ip, success, created_at) VALUES (?, ?, 0, 0)').run(
    'admin',
    'old',
  )
  queries.insertSession('expired', 'admin', new Date(0).toISOString())
  queries.insertSession('live', 'admin', new Date(Date.now() + 100000).toISOString())
  queries.insertAudit('admin', 'upload', '', '', '')
  queries.cleanup(Date.now(), Date.now() - 10000)
  expect(queries.recentFailures('admin', 0)).toBe(1)
  expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 })
  expect(db.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 1 })
  expect(
    db.prepare("SELECT name FROM sqlite_master WHERE name = 'login_account_time'").get(),
  ).toBeTruthy()
})

it('warns and durably archives historical audit before removal', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { db, app, dir, config } = await boot()
  db.prepare(
    "INSERT INTO audit_log(created_at, actor_username, action) VALUES ('2000-01-01', 'admin', 'upload')",
  ).run()
  await app.close()
  const preserved = await buildApp(db, {
    ...config,
    trustProxy: false,
    corsOrigins: [],
    maxUploadBytes: 1024,
    auditRetentionDays: 1,
  })
  await preserved.close()
  expect(db.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 1 })
  const archiveDir = path.join(dir, 'archive')
  const archival = await buildApp(db, {
    ...config,
    trustProxy: false,
    corsOrigins: [],
    maxUploadBytes: 1024,
    auditRetentionDays: 1,
    auditArchiveDir: archiveDir,
  })
  await archival.close()
  expect(warning).toHaveBeenCalled()
  expect(readFileSync(path.join(archiveDir, readdirSync(archiveDir)[0]!), 'utf8')).toContain(
    '2000-01-01',
  )
  expect(db.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 0 })
})

it('preserves every audit field across archive batches and retains rows on archive failure', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { db, app, dir, config } = await boot()
  await app.close()
  const insert = db.prepare(`INSERT INTO audit_log
    (created_at, actor_username, action, template_id, file_name, category_id, detail, result, target_username)
    VALUES ('2000-01-01', 'admin', 'upload', ?, '範本.docx', 'category', ?, 'denied', 'other')`)
  db.transaction(() => {
    for (let i = 0; i < 501; i++) insert.run(`template-${i}`, `detail-${i}`)
  })()
  createQueries(db).insertAudit('admin', 'upload', 'recent', '', '')
  const original = db.prepare('SELECT * FROM audit_log ORDER BY id').all()
  const archiveDir = path.join(dir, 'archive')
  // A regular file cannot serve as the archive directory.
  writeFileSync(archiveDir, 'blocked')
  const failed = await buildApp(db, {
    ...config,
    auditRetentionDays: 1,
    auditArchiveDir: archiveDir,
  })
  await failed.close()
  expect(db.prepare('SELECT * FROM audit_log ORDER BY id').all()).toEqual(original)
  rmSync(archiveDir)
  for (const remaining of [2, 1]) {
    const archival = await buildApp(db, {
      ...config,
      auditRetentionDays: 1,
      auditArchiveDir: archiveDir,
    })
    await archival.close()
    expect(db.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: remaining })
  }
  const archived = readdirSync(archiveDir).flatMap((file) =>
    readFileSync(path.join(archiveDir, file), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
  )
  expect(archived.sort((a, b) => a.id - b.id)).toEqual(original.slice(0, 501))
  expect(db.prepare('SELECT * FROM audit_log').all()).toEqual(original.slice(501))
})

it('rejects namespace-shadowed relationship attributes but permits passive theme object defaults', () => {
  const dangerous = zip({
    'word/_rels/document.xml.rels': `<Relationships xmlns="${relNS}" xmlns:x="urn:shadow"><Relationship TargetMode="External" x:TargetMode="Internal" Target="local"/></Relationships>`,
  })
  expect(() => normalizeDocx(dangerous, limits)).toThrow()
  expect(() =>
    normalizeDocx(
      zip({
        'word/theme/theme1.xml': '<a:theme xmlns:a="urn:theme"><a:objectDefaults/></a:theme>',
      }),
      limits,
    ),
  ).not.toThrow()
})

it('runs periodic cleanup and bounds default lists even for pre-existing data above quota', async () => {
  const { db, queries, app, auth } = await boot({ maintenanceIntervalMs: 20 })
  const admin = await auth()
  queries.insertSession('old', 'admin', new Date(0).toISOString())
  db.prepare('INSERT INTO register_events(ip, created_at) VALUES (?, 0)').run('old')
  for (let index = 0; index < 102; index++)
    queries.insertFeedback({
      id: String(index),
      authorId: 'admin',
      title: 'mock',
      content: 'mock',
      createdAt: new Date().toISOString(),
    })
  expect((await app.inject({ url: '/api/feedback', ...admin })).json().posts).toHaveLength(100)
  expect(
    (await app.inject({ url: '/api/feedback?offset=100', ...admin })).json().posts,
  ).toHaveLength(2)
  await vi.waitFor(
    () => expect(db.prepare('SELECT * FROM sessions WHERE id = ?').get('old')).toBeUndefined(),
    { timeout: 1000, interval: 20 },
  )
  expect(db.prepare('SELECT COUNT(*) AS n FROM register_events').get()).toEqual({ n: 0 })
})

it('applies upload quotas before writing files and permits size-neutral replacement', async () => {
  const { app, auth, db, dir, queries } = await boot({ templatesPerAccount: 1, templatesGlobal: 1 })
  const admin = await auth()
  const data = zip()
  const upload = (url = '/api/templates', method: 'POST' | 'PUT' = 'POST') =>
    app.inject({
      url,
      method,
      cookies: admin.cookies,
      headers: { ...admin.headers, 'content-type': 'multipart/form-data; boundary=security-test' },
      payload: Buffer.concat([
        Buffer.from(
          '--security-test\r\nContent-Disposition: form-data; name="file"; filename="test.docx"\r\nContent-Type: application/zip\r\n\r\n',
        ),
        data,
        Buffer.from('\r\n--security-test--\r\n'),
      ]),
    })
  const first = await upload()
  expect(first.statusCode).toBe(201)
  const id = first.json().template.id as string
  expect((await upload()).statusCode).toBe(429)
  expect((await upload(`/api/templates/${id}/file`, 'PUT')).statusCode).toBe(200)
  queries.setTemplateOwner(id, 'other')
  expect((await upload()).statusCode).toBe(429)
  expect(db.prepare('SELECT COUNT(*) AS n FROM templates').get()).toEqual({ n: 1 })
  expect(readdirSync(dir)).toHaveLength(1)
})
