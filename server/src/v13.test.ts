import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import PizZip from 'pizzip'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import {
  buildDocx,
  differentRPr,
  kaiBoldRPr,
  paragraph,
  run,
  wordDocument,
} from '../../shared/docxFixture.ts'
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
const scratch = mkdtempSync(path.join(tmpdir(), 'ai-use-v13-'))

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

function splitYearDocx() {
  const body = paragraph(
    [
      run(kaiBoldRPr, '{{'),
      '<w:proofErr w:type="spellStart"/>',
      run(kaiBoldRPr, '年'),
      '<w:bookmarkStart w:id="1" w:name="_Ref"/>',
      run(differentRPr, '}}'),
      '<w:proofErr w:type="spellEnd"/>',
      '<w:bookmarkEnd w:id="1"/>',
    ].join(''),
  )
  return buildDocx({ document: wordDocument(body) })
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

async function login(app: Awaited<ReturnType<typeof boot>>['app']) {
  const csrfProbe = await app.inject({ method: 'GET', url: '/api/auth/me' })
  const csrf = cookieValue(csrfProbe, 'csrf')
  const signedIn = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'admin', password: passwords.admin },
  })
  return {
    cookies: { session: cookieValue(signedIn, 'session'), csrf },
    headers: { origin, 'x-csrf-token': csrf },
  }
}

function runContaining(xml: string, text: string): string {
  const found = [...xml.matchAll(/<w:r(?=[\s>])[^>]*>[\s\S]*?<\/w:r>/g)].find((match) =>
    match[0].includes(`>${text}</w:t>`),
  )
  return found?.[0] ?? ''
}

describe('v1.3 docx normalization', () => {
  const databases: AppDatabase[] = []
  afterEach(() => {
    for (const db of databases.splice(0)) db.close()
  })
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  it('上傳時合併被拆開的欄位、回傳格式通知，並用第一個字的格式產生', async () => {
    const { app, db } = await boot()
    databases.push(db)
    const admin = await login(app)
    const upload = multipart('年欄.docx', splitYearDocx())
    const created = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: admin.cookies,
      headers: { ...upload.headers, ...admin.headers },
      payload: upload.payload,
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().formatNotices).toEqual(['年'])
    expect(created.json().template.placeholders).toEqual(['年'])
    const templateId = created.json().template.id as string

    const file = await app.inject({
      method: 'GET',
      url: `/api/templates/${templateId}/file`,
      cookies: { session: admin.cookies.session },
    })
    expect(file.statusCode).toBe(200)
    const stored = new PizZip(file.rawPayload).file('word/document.xml')?.asText() ?? ''
    const merged = runContaining(stored, '{{年}}')
    expect(merged).toContain('w:eastAsia="標楷體"')
    expect(merged).toContain('<w:sz w:val="32"/>')
    expect(merged).toContain('<w:b/>')
    expect(merged).not.toContain('新細明體')
    expect(stored).toContain('w:proofErr')
    expect(stored).toContain('w:bookmarkStart')
    expect(stored).not.toContain('<w:t>{{</w:t>')

    const rendered = new PizZip(renderDocx(file.rawPayload, { 年: '115' }))
      .file('word/document.xml')
      ?.asText()
    const output = runContaining(rendered ?? '', '115')
    expect(output).toContain('w:eastAsia="標楷體"')
    expect(output).toContain('<w:sz w:val="32"/>')
    expect(output).toContain('<w:b/>')
    expect(output).not.toContain('新細明體')
    expect(rendered).toContain('<w:sectPr')
  })
})
