import { loginWithCsrf } from './loginTestHelper.ts'
import {
  buildMinimalDocx,
  makeConfig,
  testPasswords as passwords,
  testSamplePath as samplePath,
} from './testSupport.ts'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import bcrypt from 'bcryptjs'
import { docxMimeType } from '../../shared/templateUpload.ts'
import { buildApp } from './app.ts'
import { loadConfig, resolveServerPath } from './config.ts'
import { createQueries, migrate, openDatabase } from './db.ts'
import { readPhotoBlock } from './docxXml.ts'
import { removeTemplateFile, templateFilePath, writeTemplateFile } from './files.ts'
import { seedBuiltinTemplates, seedReferenceData } from './seed.ts'
import { createShutdown } from './shutdown.ts'

// Configuration tests use only explicit mock env values, never local .env files.
vi.mock('dotenv', () => ({ config: vi.fn() }))

const scratch = mkdtempSync(path.join(tmpdir(), 'ai-use-deploy-'))
const longSecret = 'a'.repeat(32)
const builtinDir = fileURLToPath(new URL('../../public/templates', import.meta.url))
const deliveryId = 'builtin-delivery-certificate-photos'
const deliveryFileName = 'delivery-certificate-photos-template.docx'
const sceneId = 'builtin-scene-photos'
const sceneFileName = 'scene-photos-template.docx'
const deploymentDefaults = {
  corsOrigins: [],
  maxZipEntries: 8,
  maxZipUncompressedBytes: 64 * 1024,
  loginRatePerMinute: 20,
}

function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

const baseProductionEnv = {
  NODE_ENV: 'production',
  SESSION_SECRET: longSecret,
  SEED_DEMO_USERS: undefined,
  SEED_USER_CLERK_PASSWORD: undefined,
  SEED_USER_ADMIN_PASSWORD: undefined,
  SEED_USER_VIEWER_PASSWORD: undefined,
  HOST: undefined,
  PORT: undefined,
  DATABASE_PATH: '/data/app.sqlite',
  UPLOAD_DIR: '/data/uploads',
  STATIC_DIR: undefined,
  TRUST_PROXY: undefined,
  CORS_ORIGINS: undefined,
  CORS_ORIGIN: undefined,
  COOKIE_SECURE: undefined,
  SAMPLE_TEMPLATE_PATH: undefined,
  BUILTIN_TEMPLATE_DIR: undefined,
  SEED_SAMPLE_DATA: undefined,
}

describe('deployment config', () => {
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  it('keeps absolute data paths and resolves dev paths under server/', () => {
    expect(resolveServerPath('/data/app.sqlite')).toBe('/data/app.sqlite')
    expect(resolveServerPath('data/app.sqlite')).toBe(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/app.sqlite'),
    )
    withEnv(
      {
        ...baseProductionEnv,
        NODE_ENV: 'development',
        SESSION_SECRET: 'dev-only-change-me',
        SEED_USER_CLERK_PASSWORD: 'clerk-demo',
        SEED_USER_ADMIN_PASSWORD: 'admin-demo',
        SEED_USER_VIEWER_PASSWORD: 'viewer-demo',
        GLOBAL_RATE_PER_MINUTE: '3',
        DATABASE_PATH: 'data/app.sqlite',
        UPLOAD_DIR: 'data/uploads',
      },
      () => {
        const config = loadConfig()
        expect(config.globalRatePerMinute).toBe(3)
        expect(config.host).toBe('127.0.0.1')
        expect(
          config.databasePath.endsWith(`${path.sep}server${path.sep}data${path.sep}app.sqlite`),
        ).toBe(true)
        expect(
          config.uploadDir.endsWith(`${path.sep}server${path.sep}data${path.sep}uploads`),
        ).toBe(true)
        expect(config.sessionSecret).toBe('dev-only-change-me')
        expect(config.seedDemoUsers).toBe(true)
        expect(config.passwords).toEqual({
          clerk: 'clerk-demo',
          admin: 'admin-demo',
          viewer: 'viewer-demo',
        })
        expect(config.staticDir).toBeUndefined()
        expect(config.builtinTemplateDir).toBe(builtinDir)
        expect(config.trustProxy).toBe(false)
        expect(config.corsOrigins).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173'])
      },
    )
  })

  it('ships the built-in templates in the runtime image and supports a directory override', () => {
    const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8')
    const runner = dockerfile.split(' AS runner\n')[1]
    expect(runner).toContain('BUILTIN_TEMPLATE_DIR=/app/public/templates')
    expect(runner).toContain('COPY --from=build /app/public/templates /app/public/templates')
    withEnv(
      {
        ...baseProductionEnv,
        NODE_ENV: 'test',
        SEED_DEMO_USERS: 'false',
        BUILTIN_TEMPLATE_DIR: scratch,
      },
      () => expect(loadConfig().builtinTemplateDir).toBe(scratch),
    )
  })

  it('seeds both mock photo templates in production and serves them to an ordinary user', async () => {
    const staticDir = mkdtempSync(path.join(scratch, 'builtin-static-'))
    writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>Mock</title>')
    const config = withEnv(
      {
        ...baseProductionEnv,
        STATIC_DIR: staticDir,
        UPLOAD_DIR: mkdtempSync(path.join(scratch, 'builtin-uploads-')),
      },
      loadConfig,
    )
    expect(config.seedSampleData).toBe(false)
    expect(config.builtinTemplateDir).toBe(builtinDir)
    const db = openDatabase(':memory:')
    try {
      migrate(db)
      const queries = createQueries(db)
      seedBuiltinTemplates(db, config.builtinTemplateDir, config.uploadDir)
      expect(queries.countUsers()).toBe(0)
      expect(queries.listCategories()).toEqual([])
      queries.insertUser({
        id: 'mock-reader',
        username: 'reader',
        passwordHash: bcrypt.hashSync(passwords.viewer, 4),
        displayName: 'Mock reader',
        nickname: 'Mock',
        role: 'user',
      })

      const app = await buildApp(db, config)
      try {
        const login = await loginWithCsrf(app, {
          method: 'POST',
          url: '/api/auth/login',
          payload: { username: 'reader', password: passwords.viewer },
        })
        expect(login.statusCode).toBe(200)
        const cookies = { session: login.cookies.find(({ name }) => name === 'session')!.value }
        const list = await app.inject({ url: '/api/templates', cookies })
        expect(list.statusCode).toBe(200)
        const { templates } = list.json()
        expect(templates).toHaveLength(2)
        for (const { id, fileName, placeholders } of [
          { id: deliveryId, fileName: deliveryFileName, placeholders: ['應受送達人'] },
          {
            id: sceneId,
            fileName: sceneFileName,
            placeholders: ['年', '月', '警局', '分局', '案次編號', '案由'],
          },
        ]) {
          const original = readFileSync(path.join(builtinDir, fileName))
          expect(templates).toContainEqual(
            expect.objectContaining({
              id,
              fileName,
              placeholders,
              origin: 'sample',
              kind: 'docx',
              mimeType: docxMimeType,
              sizeBytes: original.byteLength,
              usages: [],
              addedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
            }),
          )
          const stored = queries.getTemplateFile(id)!.data!
          expect(stored).toEqual(original)
          expect(readPhotoBlock(stored)?.photoCellsPerPage).toBe(2)
          expect(readFileSync(templateFilePath(config.uploadDir, id))).toEqual(original)
          const download = await app.inject({ url: `/api/templates/${id}/file`, cookies })
          expect(download.statusCode).toBe(200)
          expect(download.headers['content-type']).toBe(docxMimeType)
          expect(download.headers['content-disposition']).toContain(fileName)
          expect(download.rawPayload).toEqual(original)
        }
      } finally {
        await app.close()
      }
    } finally {
      db.close()
    }
  })

  it.each([
    { id: 'mock-upload', fileName: sceneFileName },
    { id: 'mock-upload', fileName: sceneFileName.toUpperCase() },
    { id: sceneId, fileName: 'renamed-upload.docx' },
  ])('preserves an existing upload ($id, $fileName)', ({ id, fileName }) => {
    const db = openDatabase(':memory:')
    try {
      migrate(db)
      const queries = createQueries(db)
      const uploadDir = mkdtempSync(path.join(scratch, 'existing-upload-'))
      const data = Buffer.from(buildMinimalDocx('{{Mock}}'))
      queries.insertTemplate({
        id,
        fileName,
        kind: 'docx',
        mimeType: docxMimeType,
        sizeBytes: data.byteLength,
        addedAt: '2026-01-01 00:00',
        placeholders: ['Mock'],
        origin: 'upload',
        usages: [],
        data,
      })
      writeTemplateFile(uploadDir, id, data)
      const before = queries.getTemplateFile(id)

      seedBuiltinTemplates(db, builtinDir, uploadDir)

      expect(queries.listTemplates().map((record) => record.id)).toEqual([deliveryId, id])
      expect(queries.getTemplateFile(id)).toEqual(before)
      expect(readFileSync(templateFilePath(uploadDir, id))).toEqual(data)
      expect(readdirSync(uploadDir).sort()).toEqual([`${deliveryId}.docx`, `${id}.docx`].sort())
    } finally {
      db.close()
    }
  })

  it('seeds only once per database, even after a built-in is deleted', () => {
    const databasePath = path.join(scratch, 'builtin-marker.sqlite')
    const uploadDir = mkdtempSync(path.join(scratch, 'builtin-marker-uploads-'))
    const db = openDatabase(databasePath)
    try {
      migrate(db)
      const queries = createQueries(db)
      seedBuiltinTemplates(db, builtinDir, uploadDir)
      const seeded = queries.listTemplates()
      expect(seeded).toHaveLength(2)
      seedBuiltinTemplates(db, builtinDir, uploadDir)
      expect(queries.listTemplates()).toEqual(seeded)
      expect(queries.deleteTemplate(deliveryId)).toBe(1)
      removeTemplateFile(uploadDir, deliveryId)
    } finally {
      db.close()
    }
    const reopened = openDatabase(databasePath)
    try {
      migrate(reopened)
      seedBuiltinTemplates(reopened, builtinDir, uploadDir)
      expect(
        createQueries(reopened)
          .listTemplates()
          .map(({ id }) => id),
      ).toEqual([sceneId])
      expect(readdirSync(uploadDir)).toEqual([`${sceneId}.docx`])
    } finally {
      reopened.close()
    }
  })

  it('rolls back rows and files and can retry after a missing built-in source is restored', () => {
    const db = openDatabase(':memory:')
    try {
      migrate(db)
      const templateDir = mkdtempSync(path.join(scratch, 'incomplete-builtins-'))
      const uploadDir = mkdtempSync(path.join(scratch, 'incomplete-uploads-'))
      copyFileSync(
        path.join(builtinDir, deliveryFileName),
        path.join(templateDir, deliveryFileName),
      )
      expect(() => seedBuiltinTemplates(db, templateDir, uploadDir)).toThrow()
      expect(createQueries(db).listTemplates()).toEqual([])
      expect(readdirSync(uploadDir)).toEqual([])

      seedBuiltinTemplates(db, builtinDir, uploadDir)
      expect(createQueries(db).listTemplates()).toHaveLength(2)
    } finally {
      db.close()
    }
  })

  it('refuses a missing, short, or demo session secret in production', () => {
    const staticDir = path.join(scratch, 'static-ok')
    mkdirSync(staticDir, { recursive: true })
    writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>ok</title>')
    const cases: Record<string, string | undefined>[] = [
      { SESSION_SECRET: undefined },
      { SESSION_SECRET: 'short-secret' },
      { SESSION_SECRET: 'dev-only-change-me' },
      { SESSION_SECRET: 'dev-only-change-me-dev-only-change-me' },
      { SESSION_SECRET: 'clerk-demo' },
    ]
    for (const overrides of cases) {
      withEnv({ ...baseProductionEnv, STATIC_DIR: staticDir, ...overrides }, () => {
        expect(() => loadConfig()).toThrow(/fly secrets set/)
      })
    }
    withEnv({ ...baseProductionEnv, STATIC_DIR: staticDir }, () => {
      const config = loadConfig()
      expect(config.sessionSecret).toBe(longSecret)
      expect(config.seedDemoUsers).toBe(false)
      expect(config.passwords).toBeUndefined()
      expect(config.host).toBe('0.0.0.0')
      expect(config.databasePath).toBe('/data/app.sqlite')
      expect(config.uploadDir).toBe('/data/uploads')
      expect(config.staticDir).toBe(staticDir)
      expect(config.trustProxy).toBe(true)
      expect(config.cookieSecure).toBe(true)
      expect(config.corsOrigins).toEqual([])
    })
    withEnv({ ...baseProductionEnv, STATIC_DIR: path.join(scratch, 'missing-static') }, () => {
      expect(() => loadConfig()).toThrow(/index\.html/)
    })
  })

  it('requires seed passwords only when SEED_DEMO_USERS=true', () => {
    const staticDir = path.join(scratch, 'static-seed')
    mkdirSync(staticDir, { recursive: true })
    writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>ok</title>')
    const prodPasswords = {
      SEED_USER_CLERK_PASSWORD: 'clerk-pass-prod',
      SEED_USER_ADMIN_PASSWORD: 'admin-pass-prod',
      SEED_USER_VIEWER_PASSWORD: 'viewer-pass-prod',
    }

    for (const flag of [undefined, 'false'] as const) {
      withEnv({ ...baseProductionEnv, STATIC_DIR: staticDir, SEED_DEMO_USERS: flag }, () => {
        const config = loadConfig()
        expect(config.seedDemoUsers).toBe(false)
        expect(config.passwords).toBeUndefined()
        expect(config.sessionSecret).toBe(longSecret)
      })
    }

    withEnv(
      {
        ...baseProductionEnv,
        STATIC_DIR: staticDir,
        SEED_DEMO_USERS: 'false',
        SEED_USER_CLERK_PASSWORD: 'clerk-demo',
        SEED_USER_ADMIN_PASSWORD: 'admin-demo',
        SEED_USER_VIEWER_PASSWORD: 'viewer-demo',
      },
      () => {
        const config = loadConfig()
        expect(config.seedDemoUsers).toBe(false)
        expect(config.passwords).toBeUndefined()
      },
    )

    withEnv({ ...baseProductionEnv, STATIC_DIR: staticDir, SEED_DEMO_USERS: 'true' }, () => {
      expect(() => loadConfig()).toThrow(/SEED_USER_CLERK_PASSWORD/)
    })
    withEnv(
      {
        ...baseProductionEnv,
        STATIC_DIR: staticDir,
        SEED_DEMO_USERS: 'true',
        ...prodPasswords,
        SEED_USER_ADMIN_PASSWORD: 'admin-demo',
      },
      () => {
        expect(() => loadConfig()).toThrow(/fly secrets set/)
      },
    )
    withEnv({ ...baseProductionEnv, STATIC_DIR: staticDir, SEED_DEMO_USERS: 'yes' }, () => {
      expect(() => loadConfig()).toThrow(/SEED_DEMO_USERS/)
    })
    withEnv(
      {
        ...baseProductionEnv,
        STATIC_DIR: staticDir,
        SEED_DEMO_USERS: 'true',
        ...prodPasswords,
        SEED_USER_CLERK_PASSWORD: longSecret,
        SESSION_SECRET: longSecret,
      },
      () => {
        expect(() => loadConfig()).toThrow(/fly secrets set/)
      },
    )
    withEnv(
      { ...baseProductionEnv, STATIC_DIR: staticDir, SEED_DEMO_USERS: 'true', ...prodPasswords },
      () => {
        const config = loadConfig()
        expect(config.seedDemoUsers).toBe(true)
        expect(config.passwords).toEqual({
          clerk: 'clerk-pass-prod',
          admin: 'admin-pass-prod',
          viewer: 'viewer-pass-prod',
        })
      },
    )

    withEnv(
      {
        ...baseProductionEnv,
        NODE_ENV: 'development',
        STATIC_DIR: undefined,
        SESSION_SECRET: 'dev-only-change-me',
        SEED_DEMO_USERS: 'false',
        DATABASE_PATH: 'data/app.sqlite',
        UPLOAD_DIR: 'data/uploads',
      },
      () => {
        const config = loadConfig()
        expect(config.seedDemoUsers).toBe(false)
        expect(config.passwords).toBeUndefined()
      },
    )
  })

  it('uses WAL on a file database and closes it on shutdown', async () => {
    const databasePath = path.join(scratch, 'wal.sqlite')
    const db = openDatabase(databasePath)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    migrate(db)
    migrate(db)
    const uploadDir = mkdtempSync(path.join(scratch, 'seed-'))
    const queries = createQueries(db)
    seedReferenceData(queries, passwords, samplePath, uploadDir, true)
    const adminHash = queries.findUserByUsername('admin')?.passwordHash
    db.prepare('DELETE FROM users WHERE username = ?').run('clerk')
    seedReferenceData(
      queries,
      { ...passwords, clerk: 'replacement-pass' },
      samplePath,
      uploadDir,
      true,
    )
    expect(queries.countUsers()).toBe(3)
    expect(queries.findUserByUsername('admin')?.passwordHash).toBe(adminHash)
    expect(queries.findUserByUsername('clerk')?.passwordHash).not.toBe(adminHash)
    expect(
      readFileSync(templateFilePath(uploadDir, 'sample-field-note')).byteLength,
    ).toBeGreaterThan(0)
    const app = await buildApp(
      db,
      makeConfig({ scratch }, { ...deploymentDefaults, uploadDir, databasePath }),
    )
    const shutdown = createShutdown(app, db)
    await shutdown()
    await shutdown()
    expect(() => db.prepare('SELECT 1').get()).toThrow()
  })

  it('leaves existing users in place when demo seeding is off', () => {
    const db = openDatabase(':memory:')
    migrate(db)
    const queries = createQueries(db)
    const uploadDir = mkdtempSync(path.join(scratch, 'noseed-'))
    queries.insertUser({
      id: 'user-kept',
      username: 'kept',
      passwordHash: 'hash-kept',
      displayName: '既有使用者',
      nickname: '既有',
      role: 'sysadmin',
    })
    seedReferenceData(queries, undefined, samplePath, uploadDir, true)
    expect(queries.countUsers()).toBe(1)
    expect(queries.findUserByUsername('kept')?.passwordHash).toBe('hash-kept')
    expect(queries.findUserByUsername('clerk')).toBeNull()
    expect(queries.findUserByUsername('admin')).toBeNull()
    expect(queries.findUserByUsername('viewer')).toBeNull()
    expect(queries.listCategories()).toEqual([])
    expect(queries.hasTemplate('sample-field-note')).toBe(true)

    seedReferenceData(queries, passwords, samplePath, uploadDir, true)
    expect(queries.countUsers()).toBe(4)
    const keptHash = queries.findUserByUsername('kept')?.passwordHash
    const adminHash = queries.findUserByUsername('admin')?.passwordHash
    const clerkHash = queries.findUserByUsername('clerk')?.passwordHash
    seedReferenceData(queries, undefined, samplePath, uploadDir, true)
    seedReferenceData(
      queries,
      { ...passwords, admin: 'other-admin-pass', clerk: 'other-clerk-pass' },
      samplePath,
      uploadDir,
      true,
    )
    expect(queries.countUsers()).toBe(4)
    expect(queries.findUserByUsername('kept')?.passwordHash).toBe(keptHash)
    expect(queries.findUserByUsername('admin')?.passwordHash).toBe(adminHash)
    expect(queries.findUserByUsername('clerk')?.passwordHash).toBe(clerkHash)
    db.close()
  })

  it('serves health, same-origin API, and the built frontend', async () => {
    const uploadDir = mkdtempSync(path.join(scratch, 'up-'))
    const staticDir = path.join(scratch, 'spa')
    mkdirSync(path.join(staticDir, 'assets'), { recursive: true })
    writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><div id="app">工作台</div>')
    writeFileSync(path.join(staticDir, 'assets', 'app.js'), 'console.log("app")')
    const db = openDatabase(':memory:')
    migrate(db)
    seedReferenceData(createQueries(db), passwords, samplePath, uploadDir, true)
    const app = await buildApp(
      db,
      makeConfig(
        { scratch },
        {
          ...deploymentDefaults,
          uploadDir,
          staticDir,
          sessionSecret: longSecret,
          trustProxy: true,
          corsOrigins: [],
        },
      ),
    )

    const health = await app.inject({ method: 'GET', url: '/healthz' })
    expect(health.statusCode).toBe(200)
    expect(health.json()).toEqual({ ok: true })
    expect(health.headers['set-cookie']).toBeUndefined()

    const home = await app.inject({ method: 'GET', url: '/' })
    expect(home.statusCode).toBe(200)
    expect(home.body).toContain('工作台')
    expect(String(home.headers['content-security-policy'])).toContain("script-src 'self'")
    expect(String(home.headers['cache-control'])).toContain('no-cache')

    const spa = await app.inject({ method: 'GET', url: '/categories/general-assist' })
    expect(spa.statusCode).toBe(200)
    expect(spa.body).toContain('工作台')

    const asset = await app.inject({ method: 'GET', url: '/assets/app.js' })
    expect(asset.statusCode).toBe(200)
    expect(asset.body).toContain('console.log')

    const missingFile = await app.inject({ method: 'GET', url: '/assets/missing.js' })
    expect(missingFile.statusCode).toBe(404)
    expect(missingFile.body).not.toContain('工作台')

    const missingApi = await app.inject({ method: 'GET', url: '/api/does-not-exist' })
    expect(missingApi.statusCode).toBe(404)
    expect(missingApi.json().error).toBe('not-found')

    const crossSite = await loginWithCsrf(app, {
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        origin: 'https://evil.example',
        host: 'ai-use.fly.dev',
        'x-forwarded-proto': 'https',
      },
      payload: { username: 'clerk', password: passwords.clerk },
    })
    expect(crossSite.statusCode).toBe(403)

    const loggedIn = await loginWithCsrf(app, {
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        origin: 'https://ai-use.fly.dev',
        host: 'ai-use.fly.dev',
        'x-forwarded-proto': 'https',
      },
      payload: { username: 'clerk', password: passwords.clerk },
    })
    expect(loggedIn.statusCode).toBe(200)
    const session = loggedIn.cookies.find((cookie) => cookie.name === 'session')
    expect(session?.value).toContain('.')
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { session: session!.value },
    })
    expect(me.statusCode).toBe(200)
    expect(me.json().user.username).toBe('clerk')

    await app.close()
    db.close()
  })
})
