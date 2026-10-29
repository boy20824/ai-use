import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { buildApp } from './app.ts'
import { loadConfig, resolveServerPath, type AppConfig, type SeedPasswords } from './config.ts'
import { createQueries, migrate, openDatabase } from './db.ts'
import { templateFilePath } from './files.ts'
import { seedReferenceData } from './seed.ts'
import { createShutdown } from './shutdown.ts'

const passwords: SeedPasswords = {
  clerk: 'clerk-pass',
  admin: 'admin-pass',
  viewer: 'viewer-pass',
}
const samplePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../public/samples/field-note.docx',
)
const scratch = mkdtempSync(path.join(tmpdir(), 'ai-use-deploy-'))
const longSecret = 'a'.repeat(32)

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function appConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    databasePath: ':memory:',
    uploadDir: mkdtempSync(path.join(scratch, 'up-')),
    sessionSecret: '',
    sessionTtlHours: 1,
    cookieSecure: false,
    corsOrigins: [],
    maxUploadBytes: 1024 * 1024,
    maxZipEntries: 8,
    maxZipUncompressedBytes: 64 * 1024,
    loginMaxFailures: 5,
    loginLockoutMinutes: 15,
    loginRatePerMinute: 20,
    sampleTemplatePath: samplePath,
    staticDir: undefined,
    trustProxy: false,
    passwords,
    ...overrides,
  }
}

const baseProductionEnv = {
  NODE_ENV: 'production',
  SESSION_SECRET: longSecret,
  SEED_USER_CLERK_PASSWORD: 'clerk-pass-prod',
  SEED_USER_ADMIN_PASSWORD: 'admin-pass-prod',
  SEED_USER_VIEWER_PASSWORD: 'viewer-pass-prod',
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
        DATABASE_PATH: 'data/app.sqlite',
        UPLOAD_DIR: 'data/uploads',
      },
      () => {
        const config = loadConfig()
        expect(config.host).toBe('127.0.0.1')
        expect(
          config.databasePath.endsWith(`${path.sep}server${path.sep}data${path.sep}app.sqlite`),
        ).toBe(true)
        expect(
          config.uploadDir.endsWith(`${path.sep}server${path.sep}data${path.sep}uploads`),
        ).toBe(true)
        expect(config.sessionSecret).toBe('dev-only-change-me')
        expect(config.staticDir).toBeUndefined()
        expect(config.trustProxy).toBe(false)
        expect(config.corsOrigins).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173'])
      },
    )
  })

  it('refuses a missing, short, or demo session secret and demo seed passwords in production', () => {
    const staticDir = path.join(scratch, 'static-ok')
    mkdirSync(staticDir, { recursive: true })
    writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>ok</title>')
    const cases: Record<string, string | undefined>[] = [
      { SESSION_SECRET: undefined },
      { SESSION_SECRET: 'short-secret' },
      { SESSION_SECRET: 'dev-only-change-me' },
      { SESSION_SECRET: 'dev-only-change-me-dev-only-change-me' },
      { SESSION_SECRET: 'clerk-demo' },
      { SEED_USER_ADMIN_PASSWORD: 'admin-demo' },
    ]
    for (const overrides of cases) {
      withEnv({ ...baseProductionEnv, STATIC_DIR: staticDir, ...overrides }, () => {
        expect(() => loadConfig()).toThrow(/fly secrets set/)
      })
    }
    withEnv({ ...baseProductionEnv, STATIC_DIR: staticDir }, () => {
      const config = loadConfig()
      expect(config.sessionSecret).toBe(longSecret)
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

  it('uses WAL on a file database and closes it on shutdown', async () => {
    const databasePath = path.join(scratch, 'wal.sqlite')
    const db = openDatabase(databasePath)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    migrate(db)
    migrate(db)
    const uploadDir = mkdtempSync(path.join(scratch, 'seed-'))
    const queries = createQueries(db)
    seedReferenceData(queries, passwords, samplePath, uploadDir)
    const adminHash = queries.findUserByUsername('admin')?.passwordHash
    db.prepare('DELETE FROM users WHERE username = ?').run('clerk')
    seedReferenceData(queries, { ...passwords, clerk: 'replacement-pass' }, samplePath, uploadDir)
    expect(queries.countUsers()).toBe(3)
    expect(queries.findUserByUsername('admin')?.passwordHash).toBe(adminHash)
    expect(queries.findUserByUsername('clerk')?.passwordHash).not.toBe(adminHash)
    expect(
      readFileSync(templateFilePath(uploadDir, 'sample-field-note')).byteLength,
    ).toBeGreaterThan(0)
    const app = await buildApp(db, appConfig({ uploadDir, databasePath }))
    const shutdown = createShutdown(app, db)
    await shutdown()
    await shutdown()
    expect(() => db.prepare('SELECT 1').get()).toThrow()
  })

  it('serves health, same-origin API, and the built frontend', async () => {
    const uploadDir = mkdtempSync(path.join(scratch, 'up-'))
    const staticDir = path.join(scratch, 'spa')
    mkdirSync(path.join(staticDir, 'assets'), { recursive: true })
    writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><div id="app">工作台</div>')
    writeFileSync(path.join(staticDir, 'assets', 'app.js'), 'console.log("app")')
    const db = openDatabase(':memory:')
    migrate(db)
    seedReferenceData(createQueries(db), passwords, samplePath, uploadDir)
    const app = await buildApp(
      db,
      appConfig({
        uploadDir,
        staticDir,
        sessionSecret: longSecret,
        trustProxy: true,
        corsOrigins: [],
      }),
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

    const crossSite = await app.inject({
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

    const loggedIn = await app.inject({
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
