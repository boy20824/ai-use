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
const scratch = mkdtempSync(path.join(tmpdir(), 'ai-use-v12-'))
const xssPayload = '<img src=x onerror="alert(1)"><script>alert(1)</script>'

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
  const boundary = '----v12'
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

async function boot(overrides: Partial<AppConfig> = {}) {
  const appConfig = config(overrides)
  const db = openDatabase(':memory:')
  migrate(db)
  seedReferenceData(createQueries(db), passwords, samplePath, appConfig.uploadDir, false)
  const app = await buildApp(db, appConfig)
  return { app, db, queries: createQueries(db) }
}

type Injected = {
  cookies: { name: string; value: string }[]
  statusCode: number
  json: () => { user?: { id: string; role: string; canManageCategories: boolean } }
  body: string
  headers: Record<string, string | string[] | undefined>
}

function cookieValue(response: { cookies: { name: string; value: string }[] }, name: string) {
  return response.cookies.find((cookie) => cookie.name === name)?.value ?? ''
}

async function csrfToken(app: Awaited<ReturnType<typeof boot>>['app']) {
  const probe = await app.inject({ method: 'GET', url: '/api/auth/me' })
  return cookieValue(probe, 'csrf')
}

function authOf(response: { cookies: { name: string; value: string }[] }, csrf: string) {
  return {
    cookies: { session: cookieValue(response, 'session'), csrf },
    headers: { origin, 'x-csrf-token': csrf },
  }
}

async function login(
  app: Awaited<ReturnType<typeof boot>>['app'],
  username: string,
  password: string,
) {
  return app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } })
}

function account(username: string, extra: Record<string, unknown> = {}) {
  return {
    name: '測試人員',
    nickname: '小測',
    username,
    password: 'password1',
    confirmPassword: 'password1',
    ...extra,
  }
}

describe('v1.2 access, registration, and feedback', () => {
  const databases: AppDatabase[] = []
  afterEach(() => {
    for (const db of databases.splice(0)) db.close()
  })
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  it('rejects privilege fields on register and logs the new user in as a normal user', async () => {
    const { app, db, queries } = await boot()
    databases.push(db)
    const csrf = await csrfToken(app)
    const before = queries.countUsers()
    const escalated = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      cookies: { csrf },
      headers: { origin, 'x-csrf-token': csrf },
      payload: account('eviluser', { role: 'sysadmin', canManageCategories: true, active: true }),
    })
    expect(escalated.statusCode).toBe(400)
    expect(escalated.body).not.toContain('sysadmin')
    expect(escalated.body).not.toContain('eviluser')
    expect(queries.countUsers()).toBe(before)
    expect(queries.findUserByUsername('eviluser')).toBeNull()

    const created = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      cookies: { csrf },
      headers: { origin, 'x-csrf-token': csrf },
      payload: account('newuser'),
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().user).toMatchObject({
      username: 'newuser',
      displayName: '測試人員',
      nickname: '小測',
      role: 'user',
      canManageCategories: false,
    })
    expect(JSON.stringify(created.json())).not.toContain('password')
    const stored = queries.findUserByUsername('NewUser')
    expect(stored).toMatchObject({ role: 'user', canManageCategories: false, active: true })
    expect(stored?.passwordHash.startsWith('$2')).toBe(true)
    expect(stored?.passwordHash).not.toContain('password1')

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      cookies: { csrf },
      headers: { origin, 'x-csrf-token': csrf },
      payload: account('NEWUSER', { nickname: '另一個' }),
    })
    expect(duplicate.statusCode).toBe(400)
    expect(duplicate.body).not.toContain('已存在')
    expect(duplicate.body).not.toContain('UNIQUE')
    expect(queries.findUserByUsername('newuser')?.nickname).toBe('小測')

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { session: cookieValue(created, 'session') },
    })
    expect(me.statusCode).toBe(200)
    expect(me.json().user?.username).toBe('newuser')

    const crossSite = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      cookies: { csrf },
      headers: { origin: 'https://evil.example', 'x-csrf-token': csrf },
      payload: account('crossuser'),
    })
    expect(crossSite.statusCode).toBe(403)
    expect(crossSite.json()).toMatchObject({ error: 'csrf' })
    const missing = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { origin },
      payload: account('nocsrf'),
    })
    expect(missing.statusCode).toBe(403)
    expect(queries.findUserByUsername('crossuser')).toBeNull()
    expect(queries.findUserByUsername('nocsrf')).toBeNull()
  })

  it('rate limits registration per IP and with a global cap', async () => {
    const perIp = await boot({ registerIpLimit: 3, registerGlobalLimit: 20 })
    databases.push(perIp.db)
    const ipToken = await csrfToken(perIp.app)
    for (let index = 0; index < 3; index += 1) {
      const response = await perIp.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        cookies: { csrf: ipToken },
        headers: { origin, 'x-csrf-token': ipToken },
        payload: account(`ipuser${index}`),
      })
      expect(response.statusCode, `ipuser${index}`).toBe(201)
    }
    const blocked = await perIp.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      cookies: { csrf: ipToken },
      headers: { origin, 'x-csrf-token': ipToken },
      payload: account('ipuser3'),
    })
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json()).toMatchObject({ error: 'rate-limited' })
    expect(perIp.queries.findUserByUsername('ipuser3')).toBeNull()

    const global = await boot({ registerIpLimit: 20, registerGlobalLimit: 3 })
    databases.push(global.db)
    const globalToken = await csrfToken(global.app)
    for (let index = 0; index < 3; index += 1) {
      const response = await global.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        cookies: { csrf: globalToken },
        headers: { origin, 'x-csrf-token': globalToken },
        payload: account(`global${index}`),
      })
      expect(response.statusCode).toBe(201)
    }
    const globalBlocked = await global.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      cookies: { csrf: globalToken },
      headers: { origin, 'x-csrf-token': globalToken },
      payload: account('global3'),
    })
    expect(globalBlocked.statusCode).toBe(429)
    expect(global.queries.findUserByUsername('global3')).toBeNull()
  })

  it('keeps member management to sysadmins and rejects disabling yourself', async () => {
    const { app, db, queries } = await boot()
    databases.push(db)
    const csrf = await csrfToken(app)
    const admin = authOf(await login(app, 'admin', passwords.admin), csrf)
    const clerk = authOf(await login(app, 'clerk', passwords.clerk), csrf)
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      cookies: { csrf },
      headers: { origin, 'x-csrf-token': csrf },
      payload: account('worker1'),
    })
    expect(registered.statusCode).toBe(201)
    const worker = authOf(registered, csrf)
    const workerId = queries.findUserByUsername('worker1')?.id ?? ''

    const listed = await app.inject({ method: 'GET', url: '/api/members', ...clerk })
    expect(listed.statusCode).toBe(403)
    expect(listed.json()).toMatchObject({ error: 'forbidden' })
    const anonymous = await app.inject({ method: 'GET', url: '/api/members' })
    expect(anonymous.statusCode).toBe(401)

    const escalated = await app.inject({
      method: 'PATCH',
      url: `/api/members/${workerId}`,
      ...clerk,
      payload: { role: 'sysadmin', canManageCategories: true, active: true },
    })
    expect(escalated.statusCode).toBe(403)
    expect(queries.findUserByUsername('worker1')).toMatchObject({
      role: 'user',
      canManageCategories: false,
      active: true,
    })
    const forgedCreate = await app.inject({
      method: 'POST',
      url: '/api/members',
      ...clerk,
      payload: account('planted', { role: 'sysadmin', canManageCategories: true }),
    })
    expect(forgedCreate.statusCode).toBe(403)
    expect(queries.findUserByUsername('planted')).toBeNull()

    const created = await app.inject({
      method: 'POST',
      url: '/api/members',
      ...admin,
      payload: {
        name: '新會員',
        nickname: '新',
        username: 'member2',
        password: 'memberpass',
        role: 'sysadmin',
        canManageCategories: true,
      },
    })
    expect(created.statusCode).toBe(400)
    expect(queries.findUserByUsername('member2')).toBeNull()
    const added = await app.inject({
      method: 'POST',
      url: '/api/members',
      ...admin,
      payload: { name: '新會員', nickname: '新', username: 'member2', password: 'memberpass' },
    })
    expect(added.statusCode).toBe(201)
    expect(added.json()).toMatchObject({
      member: { username: 'member2', role: 'user', canManageCategories: false, active: true },
    })
    expect(JSON.stringify(added.json())).not.toContain('memberpass')

    const adminId = queries.findUserByUsername('admin')?.id ?? ''
    const selfOff = await app.inject({
      method: 'PATCH',
      url: `/api/members/${adminId}`,
      ...admin,
      payload: { active: false },
    })
    expect(selfOff.statusCode).toBe(400)
    expect(selfOff.body).toContain('不能停用自己的帳號')
    expect(queries.findUserByUsername('admin')?.active).toBe(true)
    const stillIn = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { session: admin.cookies.session },
    })
    expect(stillIn.statusCode).toBe(200)

    const selfDemote = await app.inject({
      method: 'PATCH',
      url: `/api/members/${adminId}`,
      ...admin,
      payload: { role: 'user' },
    })
    expect(selfDemote.statusCode).toBe(400)
    expect(queries.findUserByUsername('admin')?.role).toBe('sysadmin')

    const granted = await app.inject({
      method: 'PATCH',
      url: `/api/members/${workerId}`,
      ...admin,
      payload: { canManageCategories: true },
    })
    expect(granted.statusCode).toBe(200)
    expect(queries.findUserByUsername('worker1')?.canManageCategories).toBe(true)

    const file = multipart('筆錄.docx', docx('hello'))
    const uploaded = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: worker.cookies,
      headers: { ...file.headers, ...worker.headers },
      payload: file.payload,
    })
    expect(uploaded.statusCode).toBe(201)
    const templateId = uploaded.json().template.id as string
    const category = await app.inject({
      method: 'POST',
      url: '/api/categories',
      ...worker,
      payload: { name: '授權類別', steps: [{ body: '步驟', templateIds: [templateId] }] },
    })
    expect(category.statusCode).toBe(201)
    const categoryId = category.json().category.id as string
    const workerDeleteTemplate = await app.inject({
      method: 'DELETE',
      url: `/api/templates/${templateId}`,
      ...worker,
    })
    expect(workerDeleteTemplate.statusCode).toBe(403)
    const workerDeleteCategory = await app.inject({
      method: 'DELETE',
      url: `/api/categories/${categoryId}`,
      ...worker,
    })
    expect(workerDeleteCategory.statusCode).toBe(403)
    expect(queries.getTemplateFile(templateId)?.fileName).toBe('筆錄.docx')
    expect(queries.getCategory(categoryId)?.name).toBe('授權類別')

    const disabled = await app.inject({
      method: 'PATCH',
      url: `/api/members/${workerId}`,
      ...admin,
      payload: { active: false },
    })
    expect(disabled.statusCode).toBe(200)
    expect(queries.findUserByUsername('worker1')?.active).toBe(false)
    const stale = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { session: worker.cookies.session },
    })
    expect(stale.statusCode).toBe(401)
    const staleList = await app.inject({
      method: 'GET',
      url: '/api/categories',
      cookies: { session: worker.cookies.session },
    })
    expect(staleList.statusCode).toBe(401)
    queries.insertSession(worker.cookies.session, workerId, '2099-01-01T00:00:00.000Z')
    const revived = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { session: worker.cookies.session },
    })
    expect(revived.statusCode).toBe(401)
    expect(queries.findSession(worker.cookies.session)).toBeUndefined()
    const relogin = await login(app, 'worker1', 'password1')
    expect(relogin.statusCode).toBe(401)

    const audit = db
      .prepare(
        `SELECT actor_username, action, detail, result, target_username
         FROM audit_log
         WHERE action LIKE 'member_%'
         ORDER BY id`,
      )
      .all() as {
      actor_username: string
      action: string
      detail: string
      result: string
      target_username: string
    }[]
    expect(audit.some((row) => row.actor_username === 'clerk' && row.result === 'denied')).toBe(
      true,
    )
    expect(
      audit.some(
        (row) =>
          row.action === 'member_update' &&
          row.result === 'allowed' &&
          row.target_username === 'worker1' &&
          row.detail.includes('可維護類別'),
      ),
    ).toBe(true)
    expect(
      audit.some(
        (row) =>
          row.action === 'member_update' &&
          row.result === 'allowed' &&
          row.detail.includes('停用') &&
          row.target_username === 'worker1',
      ),
    ).toBe(true)
    expect(JSON.stringify(audit)).not.toContain('password1')
    expect(JSON.stringify(audit)).not.toContain('memberpass')

    const last = queries.updateMember('u-missing', adminId, { role: 'user', active: false })
    expect(last).toEqual({ ok: false, error: 'last-sysadmin' })
    expect(queries.findUserByUsername('admin')?.role).toBe('sysadmin')
  })

  it('keeps feedback ownership on the server and stores text as text', async () => {
    const { app, db, queries } = await boot()
    databases.push(db)
    const csrf = await csrfToken(app)
    const author = authOf(await login(app, 'clerk', passwords.clerk), csrf)
    const other = authOf(await login(app, 'viewer', passwords.viewer), csrf)
    const admin = authOf(await login(app, 'admin', passwords.admin), csrf)

    const sneaky = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      ...author,
      payload: {
        title: '不該採用客戶暱稱',
        content: '本文',
        authorNickname: '冒充管理員',
        authorId: 'user-admin',
        status: 'done',
        adminReply: '不該寫入',
      },
    })
    expect(sneaky.statusCode).toBe(400)
    expect(queries.listFeedback()).toEqual([])

    const created = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      ...author,
      payload: { title: '建議', content: `第一行\n${xssPayload}` },
    })
    expect(created.statusCode).toBe(201)
    const post = created.json().post as {
      id: string
      authorId: string
      authorNickname: string
      content: string
      status: string
      adminReply: string
    }
    expect(post.authorId).toBe('user-clerk')
    expect(post.authorNickname).toBe('承辦')
    expect(post.status).toBe('pending')
    expect(post.adminReply).toBe('')
    expect(post.content).toBe(`第一行\n${xssPayload}`)
    expect(created.headers['content-type']).toContain('application/json')

    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/feedback/${post.id}`,
      ...other,
      payload: { title: '被改走', content: '被改走' },
    })
    expect(edited.statusCode).toBe(403)
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/feedback/${post.id}`,
      ...other,
    })
    expect(removed.statusCode).toBe(403)
    const moderate = await app.inject({
      method: 'PATCH',
      url: `/api/feedback/${post.id}`,
      ...author,
      payload: { status: 'done', adminReply: '自己回' },
    })
    expect(moderate.statusCode).toBe(403)
    expect(queries.getFeedback(post.id)).toMatchObject({
      title: '建議',
      content: `第一行\n${xssPayload}`,
      status: 'pending',
      adminReply: '',
    })

    const own = await app.inject({
      method: 'PATCH',
      url: `/api/feedback/${post.id}`,
      ...author,
      payload: { content: `更新\n${xssPayload}` },
    })
    expect(own.statusCode).toBe(200)
    const replied = await app.inject({
      method: 'PATCH',
      url: `/api/feedback/${post.id}`,
      ...admin,
      payload: { status: 'in_progress', adminReply: `已看到\n${xssPayload}` },
    })
    expect(replied.statusCode).toBe(200)
    expect(replied.json().post).toMatchObject({
      authorNickname: '承辦',
      status: 'in_progress',
      adminReply: `已看到\n${xssPayload}`,
      content: `更新\n${xssPayload}`,
    })

    const listed = (await app.inject({
      method: 'GET',
      url: '/api/feedback?status=in_progress',
      cookies: { session: other.cookies.session },
    })) as Injected
    expect(listed.statusCode).toBe(200)
    expect(String(listed.headers['content-type'])).toContain('application/json')
    const stored = listed.json() as { posts: { content: string; adminReply: string }[] }
    expect(stored.posts[0]?.content).toBe(`更新\n${xssPayload}`)
    expect(stored.posts[0]?.adminReply).toBe(`已看到\n${xssPayload}`)
    expect(listed.body.startsWith('<')).toBe(false)
    const pending = await app.inject({
      method: 'GET',
      url: '/api/feedback?status=pending',
      cookies: { session: other.cookies.session },
    })
    expect(pending.json().posts).toEqual([])

    const gone = await app.inject({
      method: 'DELETE',
      url: `/api/feedback/${post.id}`,
      ...author,
    })
    expect(gone.statusCode).toBe(204)
    expect(queries.getFeedback(post.id)).toBeNull()

    const denied = db
      .prepare(
        `SELECT action, result, detail, target_username FROM audit_log
         WHERE action LIKE 'feedback_%' AND result = 'denied'`,
      )
      .all() as { action: string; detail: string; target_username: string }[]
    expect(denied.length).toBeGreaterThanOrEqual(3)
    expect(denied.every((row) => row.detail === '')).toBe(true)
    expect(denied.every((row) => row.target_username === post.id)).toBe(true)
    expect(JSON.stringify(denied)).not.toContain(xssPayload)
  })
})
