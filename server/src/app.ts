import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import bcrypt from 'bcryptjs'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { z } from 'zod'
import { categoryIds } from './categories.ts'
import type { AppConfig } from './config.ts'
import {
  assertSafeZip,
  hasZipHeader,
  isAllowedDocxMime,
  listPlaceholders,
  sanitizeTemplateFileName,
} from './docx.ts'
import { createQueries, type AppDatabase, type AppQueries, type Role } from './db.ts'
import { readTemplateBytes, removeTemplateFile, writeTemplateFile } from './files.ts'

export interface AuthUser {
  id: string
  username: string
  displayName: string
  role: Role
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser | null
  }
}

const sessionCookieName = 'session'
const csrfCookieName = 'csrf'
const dummyHash = bcrypt.hashSync(randomBytes(16).toString('hex'), 10)
const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const loginSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[\w.-]+$/),
    password: z.string().min(1).max(200),
  })
  .strict()

const categoryQuerySchema = z
  .object({
    categoryId: z
      .string()
      .regex(/^[a-z0-9-]{1,64}$/)
      .optional(),
  })
  .strict()

const templateIdSchema = z.string().regex(/^[a-zA-Z0-9-]{1,64}$/)

function publicUser(user: AuthUser) {
  return { username: user.username, displayName: user.displayName, role: user.role }
}

function fail(reply: FastifyReply, status: number, error: string, message: string) {
  return reply.code(status).send({ error, message })
}

function tokensMatch(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function sessionToken(request: FastifyRequest, config: AppConfig): string | undefined {
  const raw = request.cookies?.[sessionCookieName]
  if (!raw) return undefined
  if (!config.sessionSecret) return raw
  const unsigned = request.unsignCookie(raw)
  return unsigned.valid && unsigned.value ? unsigned.value : undefined
}

function sameOrigin(request: FastifyRequest, origin: string) {
  const host = request.headers.host
  if (typeof host !== 'string' || host.length === 0) return false
  return origin === `${request.protocol}://${host}`
}

function readSession(queries: AppQueries, token: string | undefined): AuthUser | null {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null
  const row = queries.findSession(token)
  if (!row) return null
  if (Date.parse(row.expires_at) <= Date.now()) {
    queries.deleteSession(token)
    return null
  }
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role }
}

function cookieOptions(config: AppConfig, httpOnly: boolean) {
  return {
    httpOnly,
    sameSite: 'strict' as const,
    path: '/',
    secure: config.cookieSecure,
    maxAge: config.sessionTtlHours * 60 * 60,
  }
}

function setSessionCookie(reply: FastifyReply, config: AppConfig, token: string) {
  reply.setCookie(sessionCookieName, token, {
    ...cookieOptions(config, true),
    signed: config.sessionSecret.length > 0,
  })
}

function setCsrfCookie(reply: FastifyReply, config: AppConfig, token: string) {
  reply.setCookie(csrfCookieName, token, cookieOptions(config, false))
}

function clearSessionCookie(reply: FastifyReply, config: AppConfig) {
  reply.clearCookie(sessionCookieName, {
    path: '/',
    sameSite: 'strict',
    secure: config.cookieSecure,
  })
}

function requireUser(request: FastifyRequest, reply: FastifyReply) {
  if (!request.authUser) {
    fail(reply, 401, 'unauthorized', '請先登入。')
    return null
  }
  return request.authUser
}

function originAllowed(request: FastifyRequest, config: AppConfig) {
  const origin = request.headers.origin
  if (typeof origin === 'string') {
    return config.corsOrigins.includes(origin) || sameOrigin(request, origin)
  }
  const referer = request.headers.referer
  if (typeof referer === 'string') {
    try {
      return config.corsOrigins.includes(new URL(referer).origin)
    } catch {
      return false
    }
  }
  return request.headers['sec-fetch-site'] !== 'cross-site'
}

function csrfOk(request: FastifyRequest) {
  const cookie = request.cookies?.[csrfCookieName]
  const header = request.headers['x-csrf-token']
  if (typeof cookie !== 'string' || typeof header !== 'string') return false
  return tokensMatch(cookie, header)
}

function contentDisposition(fileName: string) {
  const ascii = fileName.replace(/[^\w.\-]+/g, '_') || 'template.docx'
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export async function buildApp(db: AppDatabase, config: AppConfig) {
  const queries = createQueries(db)
  const app = Fastify({
    logger: false,
    trustProxy: config.trustProxy,
  })
  app.decorateRequest('authUser', null)

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  })
  await app.register(cookie, config.sessionSecret ? { secret: config.sessionSecret } : {})
  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) {
        callback(null, true)
        return
      }
      callback(null, false)
    },
    credentials: true,
  })
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1 } })

  app.addHook('onRequest', async (request, reply) => {
    const pathOnly = request.url.split('?')[0] ?? ''
    if (pathOnly === '/healthz') return
    const last = pathOnly.split('/').pop() ?? ''
    if (last.includes('.')) return
    request.authUser = readSession(queries, sessionToken(request, config))
    if (!request.cookies?.[csrfCookieName]) {
      setCsrfCookie(reply, config, randomBytes(32).toString('hex'))
    }
    if (!mutatingMethods.has(request.method)) return
    if (!originAllowed(request, config)) {
      return fail(reply, 403, 'csrf', '這個來源不能變更資料。')
    }
    if (request.url === '/api/auth/login') return
    if (!csrfOk(request)) {
      return fail(reply, 403, 'csrf', '缺少或不相符的驗證權杖。')
    }
  })

  app.setErrorHandler((error: { code?: string }, _request, reply) => {
    if (reply.sent) return
    const code = error.code ?? ''
    if (code === 'FST_REQ_FILE_TOO_LARGE') {
      return fail(reply, 413, 'payload-too-large', '檔案超過大小限制。')
    }
    if (code.startsWith('FST_ERR_CTP')) {
      return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    }
    return fail(reply, 500, 'internal', '伺服器暫時無法完成這項操作。')
  })

  app.get('/healthz', async (_request, reply) => {
    try {
      db.prepare('SELECT 1 AS ok').get()
    } catch {
      return reply.code(503).send({ ok: false })
    }
    return { ok: true }
  })

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    const ip = request.ip || 'unknown'
    const username = parsed.data.username
    const now = Date.now()
    if (queries.recentAttempts(ip, now - 60_000) >= config.loginRatePerMinute) {
      return fail(reply, 429, 'rate-limited', '登入嘗試過多，請稍後再試。')
    }
    const lockoutAfter = now - config.loginLockoutMinutes * 60_000
    if (queries.recentFailures(username, lockoutAfter) >= config.loginMaxFailures) {
      return fail(reply, 429, 'locked', '登入嘗試過多，請稍後再試。')
    }

    const user = queries.findUserByUsername(username)
    const matches = bcrypt.compareSync(parsed.data.password, user?.passwordHash ?? dummyHash)
    if (!user || !matches) {
      queries.recordLogin(username, ip, false)
      return fail(reply, 401, 'unauthorized', '帳號或密碼不正確。')
    }

    queries.clearFailures(username)
    queries.recordLogin(username, ip, true)
    queries.deleteUserSessions(user.id)
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(now + config.sessionTtlHours * 60 * 60 * 1000).toISOString()
    queries.insertSession(token, user.id, expiresAt)
    setSessionCookie(reply, config, token)
    return { user: publicUser(user) }
  })

  app.get('/api/auth/me', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    return { user: publicUser(user) }
  })

  app.post('/api/auth/logout', async (request, reply) => {
    const token = sessionToken(request, config)
    if (token) queries.deleteSession(token)
    clearSessionCookie(reply, config)
    return reply.code(204).send()
  })

  app.get('/api/categories', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    return { categories: queries.listCategories() }
  })

  app.get('/api/templates', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const parsed = categoryQuerySchema.safeParse(request.query)
    if (!parsed.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    if (parsed.data.categoryId && !categoryIds.has(parsed.data.categoryId)) {
      return fail(reply, 400, 'invalid-input', '找不到這個案件類別。')
    }
    return {
      templates: queries.listTemplates(parsed.data.categoryId).map((item) => ({
        id: item.id,
        categoryId: item.categoryId,
        fileName: item.fileName,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        addedAt: item.addedAt,
        placeholders: item.placeholders,
        origin: item.origin,
      })),
    }
  })

  app.get('/api/templates/:id/file', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const parsed = templateIdSchema.safeParse((request.params as { id?: unknown }).id)
    if (!parsed.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    const template = queries.getTemplateFile(parsed.data)
    const data = template
      ? readTemplateBytes(config.uploadDir, template.id, template.data)
      : undefined
    if (!template || !data) return fail(reply, 404, 'not-found', '找不到這份範本。')
    return reply
      .header('content-type', template.mimeType)
      .header('content-disposition', contentDisposition(template.fileName))
      .send(data)
  })

  app.post('/api/templates', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    if (user.role === 'viewer') {
      return fail(reply, 403, 'forbidden', '唯讀身分不能上傳範本。')
    }

    const file = await request.file()
    if (!file) return fail(reply, 400, 'invalid-input', '請選擇 .docx 檔案。')
    const categoryField = file.fields.categoryId
    const rawCategory =
      categoryField && typeof categoryField === 'object' && 'value' in categoryField
        ? categoryField.value
        : ''
    const categoryId = z
      .string()
      .regex(/^[a-z0-9-]{1,64}$/)
      .safeParse(rawCategory)
    if (!categoryId.success || !categoryIds.has(categoryId.data)) {
      return fail(reply, 400, 'invalid-input', '找不到這個案件類別。')
    }
    const fileName = sanitizeTemplateFileName(file.filename)
    if (!fileName || !isAllowedDocxMime(file.mimetype)) {
      return fail(reply, 400, 'bad-upload', '只接受 Word .docx 範本。')
    }

    const data = await file.toBuffer()
    if (!hasZipHeader(data)) return fail(reply, 400, 'bad-upload', '檔案內容不是 Word 文件。')
    let placeholders: string[]
    try {
      assertSafeZip(data, {
        maxEntries: config.maxZipEntries,
        maxUncompressedBytes: config.maxZipUncompressedBytes,
      })
      placeholders = listPlaceholders(data)
    } catch {
      return fail(reply, 400, 'bad-upload', '無法讀取這份 Word 範本。')
    }

    const record = {
      id: randomBytes(16).toString('hex'),
      categoryId: categoryId.data,
      fileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: data.byteLength,
      addedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      placeholders,
      origin: 'upload' as const,
      data,
    }
    writeTemplateFile(config.uploadDir, record.id, data)
    try {
      queries.insertTemplate(record)
    } catch (error) {
      removeTemplateFile(config.uploadDir, record.id)
      throw error
    }
    queries.insertAudit(user.username, 'upload', record.id, record.fileName, record.categoryId)
    return reply.code(201).send({
      template: {
        id: record.id,
        categoryId: record.categoryId,
        fileName: record.fileName,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        addedAt: record.addedAt,
        placeholders: record.placeholders,
        origin: record.origin,
      },
    })
  })

  app.delete('/api/templates/:id', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    if (user.role !== 'admin') {
      return fail(reply, 403, 'forbidden', '只有管理員可以移除範本。')
    }
    const parsed = templateIdSchema.safeParse((request.params as { id?: unknown }).id)
    if (!parsed.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    const existing = queries.getTemplateFile(parsed.data)
    if (!existing) return fail(reply, 404, 'not-found', '找不到這份範本。')
    queries.deleteTemplate(parsed.data)
    removeTemplateFile(config.uploadDir, parsed.data)
    queries.insertAudit(
      user.username,
      'delete',
      existing.id,
      existing.fileName,
      existing.categoryId,
    )
    return reply.code(204).send()
  })

  if (config.staticDir) {
    await app.register(fastifyStatic, {
      root: config.staticDir,
      wildcard: false,
      index: ['index.html'],
      setHeaders(reply, filePath) {
        if (filePath.endsWith('.html')) reply.header('cache-control', 'no-cache')
      },
    })
    app.setNotFoundHandler((request, reply) => {
      const urlPath = request.url.split('?')[0] ?? '/'
      const last = urlPath.split('/').pop() ?? ''
      if (
        urlPath === '/healthz' ||
        urlPath === '/api' ||
        urlPath.startsWith('/api/') ||
        (request.method !== 'GET' && request.method !== 'HEAD') ||
        last.includes('.')
      ) {
        return fail(reply, 404, 'not-found', '找不到這個路徑。')
      }
      reply.header('cache-control', 'no-cache')
      return reply.sendFile('index.html')
    })
  }

  return app
}
