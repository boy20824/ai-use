import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import bcrypt from 'bcryptjs'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from './config.ts'
import {
  assertSafeZip,
  hasZipHeader,
  isAllowedDocxMime,
  listPlaceholders,
  sanitizeTemplateFileName,
} from './docx.ts'
import {
  createQueries,
  type AppDatabase,
  type AppQueries,
  type CategoryRecord,
  type Role,
  type TemplateRecord,
} from './db.ts'

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

const categoryIdSchema = z.string().regex(/^[a-z0-9-]{1,64}$/)
const templateIdSchema = z.string().regex(/^[a-zA-Z0-9-]{1,64}$/)

const categoryQuerySchema = z
  .object({
    categoryId: categoryIdSchema.optional(),
  })
  .strict()

const categoryBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    code: z.string().trim().max(32).optional(),
    summary: z.string().trim().max(400).optional(),
    steps: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
  })
  .strict()

const linkBodySchema = z
  .object({
    templateIds: z.array(templateIdSchema).max(30),
  })
  .strict()

function publicUser(user: AuthUser) {
  return { username: user.username, displayName: user.displayName, role: user.role }
}

function publicCategory(category: CategoryRecord) {
  return {
    id: category.id,
    code: category.code,
    name: category.name,
    summary: category.summary,
    updatedAt: category.updatedAt,
    steps: category.steps,
    templateCount: category.templateCount,
  }
}

function publicTemplate(template: TemplateRecord) {
  return {
    id: template.id,
    fileName: template.fileName,
    mimeType: template.mimeType,
    sizeBytes: template.sizeBytes,
    addedAt: template.addedAt,
    placeholders: template.placeholders,
    origin: template.origin,
    categories: template.categories,
  }
}

function fail(reply: FastifyReply, status: number, error: string, message: string) {
  return reply.code(status).send({ error, message })
}

function categoryInputMessage(error: { issues: { path: PropertyKey[] }[] }): string {
  if (error.issues.some((issue) => issue.path[0] === 'name')) return '請填寫類別名稱。'
  return '輸入格式不正確。'
}

function stamp(date = new Date()): string {
  return date.toISOString().slice(0, 16).replace('T', ' ')
}

function tokensMatch(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
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
  reply.setCookie(sessionCookieName, token, cookieOptions(config, true))
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

function canEditCategory(role: Role) {
  return role === 'admin' || role === 'clerk'
}

function originAllowed(request: FastifyRequest, config: AppConfig) {
  const origin = request.headers.origin
  if (typeof origin === 'string') return config.corsOrigins.includes(origin)
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
  const cookieToken = request.cookies?.[csrfCookieName]
  const header = request.headers['x-csrf-token']
  if (typeof cookieToken !== 'string' || typeof header !== 'string') return false
  return tokensMatch(cookieToken, header)
}

function contentDisposition(fileName: string) {
  const ascii = fileName.replace(/[^\w.\-]+/g, '_') || 'template.docx'
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

function requestId(request: FastifyRequest): unknown {
  return (request.params as { id?: unknown }).id
}

export async function buildApp(db: AppDatabase, config: AppConfig) {
  const queries = createQueries(db)
  const app = Fastify({ logger: false })
  app.decorateRequest('authUser', null)

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'none'"],
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
  await app.register(cookie)
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
    request.authUser = readSession(queries, request.cookies?.[sessionCookieName])
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
    const token = request.cookies?.[sessionCookieName]
    if (token) queries.deleteSession(token)
    clearSessionCookie(reply, config)
    return reply.code(204).send()
  })

  app.get('/api/categories', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    return { categories: queries.listCategories().map(publicCategory) }
  })

  app.get('/api/categories/:id', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const parsed = categoryIdSchema.safeParse(requestId(request))
    if (!parsed.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    const category = queries.getCategory(parsed.data)
    if (!category) return fail(reply, 404, 'not-found', '找不到這個案件類別。')
    return { category: publicCategory(category) }
  })

  app.post('/api/categories', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    if (!canEditCategory(user.role)) {
      return fail(reply, 403, 'forbidden', '唯讀身分不能建立或編輯案件類別。')
    }
    const parsed = categoryBodySchema.safeParse(request.body)
    if (!parsed.success)
      return fail(reply, 400, 'invalid-input', categoryInputMessage(parsed.error))
    const name = parsed.data.name
    if (queries.nameTaken(name)) {
      return fail(reply, 409, 'conflict', '這個類別名稱已經存在。')
    }
    const id = randomBytes(16).toString('hex')
    const saved = queries.createCategory(
      {
        id,
        code: parsed.data.code ?? '',
        name,
        summary: parsed.data.summary ?? '',
        updatedAt: stamp(),
        steps: parsed.data.steps ?? [],
      },
      user.username,
    )
    if (!saved) return fail(reply, 409, 'conflict', '這個類別名稱已經存在。')
    const category = queries.getCategory(id)
    if (!category) return fail(reply, 500, 'internal', '伺服器暫時無法完成這項操作。')
    return reply.code(201).send({ category: publicCategory(category) })
  })

  app.patch('/api/categories/:id', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    if (!canEditCategory(user.role)) {
      return fail(reply, 403, 'forbidden', '唯讀身分不能建立或編輯案件類別。')
    }
    const id = categoryIdSchema.safeParse(requestId(request))
    if (!id.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    const parsed = categoryBodySchema.safeParse(request.body)
    if (!parsed.success)
      return fail(reply, 400, 'invalid-input', categoryInputMessage(parsed.error))
    const existing = queries.getCategory(id.data)
    if (!existing) return fail(reply, 404, 'not-found', '找不到這個案件類別。')
    if (queries.nameTaken(parsed.data.name, id.data)) {
      return fail(reply, 409, 'conflict', '這個類別名稱已經存在。')
    }
    const saved = queries.updateCategory(
      {
        id: id.data,
        code: parsed.data.code ?? '',
        name: parsed.data.name,
        summary: parsed.data.summary ?? '',
        updatedAt: stamp(),
        steps: parsed.data.steps ?? [],
      },
      user.username,
    )
    if (!saved) {
      if (!queries.getCategory(id.data))
        return fail(reply, 404, 'not-found', '找不到這個案件類別。')
      return fail(reply, 409, 'conflict', '這個類別名稱已經存在。')
    }
    const category = queries.getCategory(id.data)
    if (!category) return fail(reply, 404, 'not-found', '找不到這個案件類別。')
    return { category: publicCategory(category) }
  })

  app.put('/api/categories/:id/templates', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    if (!canEditCategory(user.role)) {
      return fail(reply, 403, 'forbidden', '唯讀身分不能調整範本連結。')
    }
    const id = categoryIdSchema.safeParse(requestId(request))
    if (!id.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    const category = queries.getCategory(id.data)
    if (!category) return fail(reply, 404, 'not-found', '找不到這個案件類別。')
    const parsed = linkBodySchema.safeParse(request.body)
    if (!parsed.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    const templateIds = parsed.data.templateIds
    if (new Set(templateIds).size !== templateIds.length) {
      return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    }
    if (templateIds.some((templateId) => !queries.hasTemplate(templateId))) {
      return fail(reply, 400, 'invalid-input', '找不到這份範本。')
    }
    queries.replaceCategoryTemplates(id.data, templateIds, user.username, category.name, stamp())
    const updated = queries.getCategory(id.data)
    if (!updated) return fail(reply, 404, 'not-found', '找不到這個案件類別。')
    return { category: publicCategory(updated) }
  })

  app.delete('/api/categories/:id', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    if (user.role !== 'admin') {
      return fail(reply, 403, 'forbidden', '只有管理員可以刪除案件類別。')
    }
    const id = categoryIdSchema.safeParse(requestId(request))
    if (!id.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    const existing = queries.getCategory(id.data)
    if (!existing) return fail(reply, 404, 'not-found', '找不到這個案件類別。')
    queries.deleteCategory(id.data, user.username, existing.name)
    return reply.code(204).send()
  })

  app.get('/api/templates', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const parsed = categoryQuerySchema.safeParse(request.query)
    if (!parsed.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    if (parsed.data.categoryId && !queries.getCategory(parsed.data.categoryId)) {
      return fail(reply, 400, 'invalid-input', '找不到這個案件類別。')
    }
    return {
      templates: queries.listTemplates(parsed.data.categoryId).map(publicTemplate),
    }
  })

  app.get('/api/templates/:id/file', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const parsed = templateIdSchema.safeParse(requestId(request))
    if (!parsed.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    const template = queries.getTemplateFile(parsed.data)
    if (!template?.data) return fail(reply, 404, 'not-found', '找不到這份範本。')
    return reply
      .header('content-type', template.mimeType)
      .header('content-disposition', contentDisposition(template.fileName))
      .send(template.data)
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
    const categoryText = typeof rawCategory === 'string' ? rawCategory.trim() : ''
    let linkedCategory: string | null = null
    if (categoryText) {
      const categoryId = categoryIdSchema.safeParse(categoryText)
      if (!categoryId.success || !queries.getCategory(categoryId.data)) {
        return fail(reply, 400, 'invalid-input', '找不到這個案件類別。')
      }
      linkedCategory = categoryId.data
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
      fileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: data.byteLength,
      addedAt: stamp(),
      placeholders,
      origin: 'upload' as const,
      categories: [],
      data,
    }
    queries.insertTemplate(record, linkedCategory ?? undefined)
    queries.insertAudit(user.username, 'upload', record.id, record.fileName, linkedCategory ?? '')
    const stored = queries.getTemplateFile(record.id)
    if (!stored) return fail(reply, 500, 'internal', '伺服器暫時無法完成這項操作。')
    return reply.code(201).send({ template: publicTemplate(stored) })
  })

  app.delete('/api/templates/:id', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    if (user.role !== 'admin') {
      return fail(reply, 403, 'forbidden', '只有管理員可以移除範本。')
    }
    const parsed = templateIdSchema.safeParse(requestId(request))
    if (!parsed.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    const existing = queries.getTemplateFile(parsed.data)
    if (!existing) return fail(reply, 404, 'not-found', '找不到這份範本。')
    const linkedNames = existing.categories.map((item) => item.name).join('、')
    queries.deleteTemplate(parsed.data)
    queries.insertAudit(
      user.username,
      'delete',
      existing.id,
      existing.fileName,
      existing.categories[0]?.id ?? '',
      linkedNames,
    )
    return reply.code(204).send()
  })

  return app
}
