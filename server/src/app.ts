import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import bcrypt from 'bcryptjs'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from './config.ts'
import {
  hasZipHeader,
  isAllowedDocxMime,
  listPlaceholders,
  normalizeDocx,
  sanitizeTemplateFileName,
} from './docx.ts'
import {
  createQueries,
  isUniqueConstraint,
  type AppDatabase,
  type AppQueries,
  type AuditAction,
  type CategoryRecord,
  type FeedbackRecord,
  type MemberUpdateError,
  type Role,
  type StepInput,
  type TemplateRecord,
  type UserRecord,
} from './db.ts'
import { readTemplateBytes, removeTemplateFile, writeTemplateFile } from './files.ts'

export interface AuthUser {
  id: string
  username: string
  displayName: string
  nickname: string
  role: Role
  canManageCategories: boolean
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

const stepIdSchema = z.string().regex(/^[a-z0-9-]{1,64}$/)

const categoryBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    code: z.string().trim().max(32).optional(),
    summary: z.string().trim().max(400).optional(),
    steps: z
      .array(
        z
          .object({
            id: stepIdSchema.optional(),
            body: z.string().trim().min(1).max(500),
            templateIds: z.array(templateIdSchema).max(30).optional(),
          })
          .strict(),
      )
      .max(30)
      .optional(),
  })
  .strict()

const personNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value))

const usernameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/)

const passwordSchema = z.string().min(8).max(200)

const registerSchema = z
  .object({
    name: personNameSchema,
    nickname: personNameSchema,
    username: usernameSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1).max(200),
  })
  .strict()
  .refine((value) => value.password === value.confirmPassword, { path: ['confirmPassword'] })

const memberIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,64}$/)

const memberCreateSchema = z
  .object({
    name: personNameSchema,
    nickname: personNameSchema,
    username: usernameSchema,
    password: passwordSchema,
  })
  .strict()

const memberPatchSchema = z
  .object({
    active: z.boolean().optional(),
    canManageCategories: z.boolean().optional(),
    role: z.enum(['sysadmin', 'user']).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.active !== undefined ||
      value.canManageCategories !== undefined ||
      value.role !== undefined,
  )

const feedbackIdSchema = z.string().regex(/^[a-f0-9]{32}$/)

const feedbackStatusSchema = z.enum(['pending', 'in_progress', 'done'])

function plainText(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !value.includes('\u0000'))
}

const feedbackCreateSchema = z
  .object({
    title: plainText(80),
    content: plainText(2000),
  })
  .strict()

const feedbackUpdateSchema = z
  .object({
    title: plainText(80).optional(),
    content: plainText(2000).optional(),
    status: feedbackStatusSchema.optional(),
    adminReply: z
      .string()
      .trim()
      .max(2000)
      .refine((value) => !value.includes('\u0000'))
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.content !== undefined ||
      value.status !== undefined ||
      value.adminReply !== undefined,
  )

const feedbackQuerySchema = z
  .object({
    status: feedbackStatusSchema.optional(),
  })
  .strict()

function publicUser(user: AuthUser | UserRecord) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    nickname: user.nickname,
    role: user.role,
    canManageCategories: user.canManageCategories,
  }
}

function publicMember(user: UserRecord) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    nickname: user.nickname,
    role: user.role,
    active: user.active,
    canManageCategories: user.canManageCategories,
    createdAt: user.createdAt,
  }
}

function publicFeedback(post: FeedbackRecord) {
  return {
    id: post.id,
    authorId: post.authorId,
    authorNickname: post.authorNickname,
    title: post.title,
    content: post.content,
    status: post.status,
    adminReply: post.adminReply,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  }
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
    usages: template.usages,
  }
}

function fail(reply: FastifyReply, status: number, error: string, message: string) {
  return reply.code(status).send({ error, message })
}

function categoryInputMessage(error: { issues: { path: PropertyKey[] }[] }): string {
  if (error.issues.some((issue) => issue.path[0] === 'name')) return '請填寫類別名稱。'
  return '輸入格式不正確。'
}

function registerMessage(error: { issues: { path: PropertyKey[]; code?: string }[] }): string {
  const issue = error.issues[0]
  const field = issue?.path[0]
  if (field === 'confirmPassword') return '兩次密碼不一致。'
  if (field === 'password' && issue?.code === 'too_small') return '密碼至少需要 8 個字元。'
  if (field === 'username') return '帳號格式不正確。'
  if (field === 'name') return '請填寫名稱。'
  if (field === 'nickname') return '請填寫暱稱。'
  return '輸入格式不正確。'
}

function memberFailure(reply: FastifyReply, error: MemberUpdateError) {
  if (error === 'not-found') return fail(reply, 404, 'not-found', '找不到這位會員。')
  if (error === 'self-disable') return fail(reply, 400, 'invalid-input', '不能停用自己的帳號。')
  if (error === 'self-demote') {
    return fail(reply, 400, 'invalid-input', '不能取消自己的系統管理員身分。')
  }
  return fail(reply, 400, 'invalid-input', '至少要保留一位啟用中的系統管理員。')
}

function stamp(date = new Date()): string {
  return date.toISOString().slice(0, 16).replace('T', ' ')
}

function normalizeSteps(
  queries: AppQueries,
  categoryId: string,
  steps: { id?: string; body: string; templateIds?: string[] }[],
): StepInput[] {
  const owned = new Set(queries.stepIdsFor(categoryId))
  const used = new Set<string>()
  return steps.map((step) => {
    const reusable = step.id && owned.has(step.id) && !used.has(step.id) ? step.id : ''
    const id = reusable || randomBytes(16).toString('hex')
    used.add(id)
    return { id, body: step.body, templateIds: step.templateIds ?? [] }
  })
}

function templateListError(queries: AppQueries, steps: StepInput[]): string | null {
  for (const step of steps) {
    if (new Set(step.templateIds).size !== step.templateIds.length) return '輸入格式不正確。'
    if (step.templateIds.some((templateId) => !queries.hasTemplate(templateId))) {
      return '找不到這份範本。'
    }
  }
  return null
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
  if (row.active !== 1) {
    queries.deleteSession(token)
    return null
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    nickname: row.nickname,
    role: row.role,
    canManageCategories: row.can_manage_categories === 1,
  }
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

function scopedId(schema: z.ZodType<string>, raw: unknown): string {
  const parsed = schema.safeParse(raw)
  return parsed.success ? parsed.data : ''
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

  function deny(
    user: AuthUser,
    reply: FastifyReply,
    action: AuditAction,
    message: string,
    target: { templateId?: string; categoryId?: string; targetUsername?: string } = {},
  ) {
    queries.insertAudit(
      user.username,
      action,
      target.templateId ?? '',
      '',
      target.categoryId ?? '',
      '',
      'denied',
      target.targetUsername ?? '',
    )
    fail(reply, 403, 'forbidden', message)
  }

  function requireCategoryManager(
    request: FastifyRequest,
    reply: FastifyReply,
    action: AuditAction,
    target: { templateId?: string; categoryId?: string },
  ) {
    const user = requireUser(request, reply)
    if (!user) return null
    if (user.role === 'sysadmin' || user.canManageCategories) return user
    deny(user, reply, action, '只有系統管理員或被授權的使用者可以變更案件類別與範本。', target)
    return null
  }

  function requireSysadmin(
    request: FastifyRequest,
    reply: FastifyReply,
    action: AuditAction,
    message: string,
    target: { templateId?: string; categoryId?: string; targetUsername?: string } = {},
  ) {
    const user = requireUser(request, reply)
    if (!user) return null
    if (user.role === 'sysadmin') return user
    deny(user, reply, action, message, target)
    return null
  }

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
    if (!user || !matches || !user.active) {
      queries.recordLogin(username, ip, false)
      if (user && matches && !user.active) queries.deleteUserSessions(user.id)
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

  app.post('/api/auth/register', async (request, reply) => {
    const ip = request.ip || 'unknown'
    const now = Date.now()
    const allowed = queries.consumeRegisterAttempt(
      ip,
      now,
      now - config.registerWindowMs,
      config.registerIpLimit,
      config.registerGlobalLimit,
    )
    if (!allowed) return fail(reply, 429, 'rate-limited', '註冊嘗試過多，請稍後再試。')
    const parsed = registerSchema.safeParse(request.body)
    if (!parsed.success) return fail(reply, 400, 'invalid-input', registerMessage(parsed.error))
    const passwordHash = bcrypt.hashSync(parsed.data.password, 10)
    const id = randomBytes(16).toString('hex')
    try {
      queries.insertUser({
        id,
        username: parsed.data.username,
        passwordHash,
        displayName: parsed.data.name,
        nickname: parsed.data.nickname,
        role: 'user',
        canManageCategories: false,
        active: true,
      })
    } catch (error) {
      if (isUniqueConstraint(error)) {
        return fail(reply, 400, 'invalid-input', '無法完成註冊，請確認資料後再試。')
      }
      throw error
    }
    const created = queries.findUserById(id)
    if (!created) return fail(reply, 500, 'internal', '伺服器暫時無法完成這項操作。')
    queries.recordLogin(created.username, ip, true)
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(now + config.sessionTtlHours * 60 * 60 * 1000).toISOString()
    queries.insertSession(token, created.id, expiresAt)
    setSessionCookie(reply, config, token)
    return reply.code(201).send({ user: publicUser(created) })
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
    const user = requireCategoryManager(request, reply, 'category_create', {})
    if (!user) return
    const parsed = categoryBodySchema.safeParse(request.body)
    if (!parsed.success)
      return fail(reply, 400, 'invalid-input', categoryInputMessage(parsed.error))
    const name = parsed.data.name
    if (queries.nameTaken(name)) {
      return fail(reply, 409, 'conflict', '這個類別名稱已經存在。')
    }
    const id = randomBytes(16).toString('hex')
    const steps = normalizeSteps(queries, id, parsed.data.steps ?? [])
    const templateError = templateListError(queries, steps)
    if (templateError) return fail(reply, 400, 'invalid-input', templateError)
    const saved = queries.createCategory(
      {
        id,
        code: parsed.data.code ?? '',
        name,
        summary: parsed.data.summary ?? '',
        updatedAt: stamp(),
        steps,
      },
      user.username,
    )
    if (!saved) return fail(reply, 409, 'conflict', '這個類別名稱已經存在。')
    const category = queries.getCategory(id)
    if (!category) return fail(reply, 500, 'internal', '伺服器暫時無法完成這項操作。')
    return reply.code(201).send({ category: publicCategory(category) })
  })

  app.patch('/api/categories/:id', async (request, reply) => {
    const user = requireCategoryManager(request, reply, 'category_update', {
      categoryId: scopedId(categoryIdSchema, requestId(request)),
    })
    if (!user) return
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
    const steps = normalizeSteps(queries, id.data, parsed.data.steps ?? [])
    const templateError = templateListError(queries, steps)
    if (templateError) return fail(reply, 400, 'invalid-input', templateError)
    const saved = queries.updateCategory(
      {
        id: id.data,
        code: parsed.data.code ?? '',
        name: parsed.data.name,
        summary: parsed.data.summary ?? '',
        updatedAt: stamp(),
        steps,
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

  app.delete('/api/categories/:id', async (request, reply) => {
    const user = requireSysadmin(request, reply, 'category_delete', '只有系統管理員可以刪除。', {
      categoryId: scopedId(categoryIdSchema, requestId(request)),
    })
    if (!user) return
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
    const user = requireCategoryManager(request, reply, 'upload', {})
    if (!user) return

    const file = await request.file()
    if (!file) return fail(reply, 400, 'invalid-input', '請選擇 .docx 檔案。')
    const stepField = file.fields.stepId
    const rawStep =
      stepField && typeof stepField === 'object' && 'value' in stepField ? stepField.value : ''
    const stepText = typeof rawStep === 'string' ? rawStep.trim() : ''
    let linkedStepId: string | null = null
    let linkedCategoryId = ''
    if (stepText) {
      const stepId = stepIdSchema.safeParse(stepText)
      const step = stepId.success ? queries.getStep(stepId.data) : null
      if (!step) return fail(reply, 400, 'invalid-input', '找不到這個填寫步驟。')
      linkedStepId = step.id
      linkedCategoryId = step.categoryId
    }
    const fileName = sanitizeTemplateFileName(file.filename)
    if (!fileName || !isAllowedDocxMime(file.mimetype)) {
      return fail(reply, 400, 'bad-upload', '只接受 Word .docx 範本。')
    }

    const data = await file.toBuffer()
    if (!hasZipHeader(data)) return fail(reply, 400, 'bad-upload', '檔案內容不是 Word 文件。')
    let placeholders: string[]
    let storedBytes = data
    let formatNotices: string[] = []
    try {
      const normalized = normalizeDocx(data, {
        maxEntries: config.maxZipEntries,
        maxUncompressedBytes: config.maxZipUncompressedBytes,
      })
      storedBytes = Buffer.from(normalized.data)
      formatNotices = normalized.notices
      placeholders = listPlaceholders(storedBytes)
    } catch {
      return fail(reply, 400, 'bad-upload', '無法讀取這份 Word 範本。')
    }

    const record = {
      id: randomBytes(16).toString('hex'),
      fileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: storedBytes.byteLength,
      addedAt: stamp(),
      placeholders,
      origin: 'upload' as const,
      usages: [],
      data: storedBytes,
    }
    writeTemplateFile(config.uploadDir, record.id, storedBytes)
    try {
      queries.insertTemplate(record, linkedStepId ?? undefined)
    } catch (error) {
      removeTemplateFile(config.uploadDir, record.id)
      throw error
    }
    queries.insertAudit(user.username, 'upload', record.id, record.fileName, linkedCategoryId)
    const stored = queries.getTemplateFile(record.id)
    if (!stored) return fail(reply, 500, 'internal', '伺服器暫時無法完成這項操作。')
    return reply.code(201).send({ template: publicTemplate(stored), formatNotices })
  })

  app.delete('/api/templates/:id', async (request, reply) => {
    const user = requireSysadmin(request, reply, 'delete', '只有系統管理員可以刪除。', {
      templateId: scopedId(templateIdSchema, requestId(request)),
    })
    if (!user) return
    const parsed = templateIdSchema.safeParse(requestId(request))
    if (!parsed.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    const existing = queries.getTemplateFile(parsed.data)
    if (!existing) return fail(reply, 404, 'not-found', '找不到這份範本。')
    const linkedNames = existing.usages
      .map((item) => `${item.categoryName} → ${item.stepBody}`)
      .join('、')
    queries.deleteTemplate(parsed.data)
    removeTemplateFile(config.uploadDir, parsed.data)
    queries.insertAudit(
      user.username,
      'delete',
      existing.id,
      existing.fileName,
      existing.usages[0]?.categoryId ?? '',
      linkedNames,
    )
    return reply.code(204).send()
  })

  app.get('/api/members', async (request, reply) => {
    const user = requireSysadmin(request, reply, 'member_list', '只有系統管理員可以管理會員。')
    if (!user) return
    return { members: queries.listUsers().map(publicMember) }
  })

  app.post('/api/members', async (request, reply) => {
    const user = requireSysadmin(request, reply, 'member_create', '只有系統管理員可以管理會員。')
    if (!user) return
    const parsed = memberCreateSchema.safeParse(request.body)
    if (!parsed.success) return fail(reply, 400, 'invalid-input', registerMessage(parsed.error))
    const id = randomBytes(16).toString('hex')
    try {
      queries.insertUser({
        id,
        username: parsed.data.username,
        passwordHash: bcrypt.hashSync(parsed.data.password, 10),
        displayName: parsed.data.name,
        nickname: parsed.data.nickname,
        role: 'user',
        canManageCategories: false,
        active: true,
      })
    } catch (error) {
      if (isUniqueConstraint(error)) return fail(reply, 409, 'conflict', '這個帳號已經存在。')
      throw error
    }
    const created = queries.findUserById(id)
    if (!created) return fail(reply, 500, 'internal', '伺服器暫時無法完成這項操作。')
    queries.insertAudit(
      user.username,
      'member_create',
      '',
      '',
      '',
      '新增會員',
      'allowed',
      created.username,
    )
    return reply.code(201).send({ member: publicMember(created) })
  })

  app.patch('/api/members/:id', async (request, reply) => {
    const target = scopedId(memberIdSchema, requestId(request))
    const user = requireSysadmin(request, reply, 'member_update', '只有系統管理員可以管理會員。', {
      targetUsername: target,
    })
    if (!user) return
    const id = memberIdSchema.safeParse(requestId(request))
    if (!id.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    const parsed = memberPatchSchema.safeParse(request.body)
    if (!parsed.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    const result = queries.updateMember(user.id, id.data, {
      active: parsed.data.active,
      canManageCategories: parsed.data.canManageCategories,
      role: parsed.data.role,
    })
    if (!result.ok) return memberFailure(reply, result.error)
    return { member: publicMember(result.user) }
  })

  app.get('/api/feedback', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const parsed = feedbackQuerySchema.safeParse(request.query)
    if (!parsed.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    return { posts: queries.listFeedback(parsed.data.status).map(publicFeedback) }
  })

  app.post('/api/feedback', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const parsed = feedbackCreateSchema.safeParse(request.body)
    if (!parsed.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    const id = randomBytes(16).toString('hex')
    const createdAt = new Date().toISOString()
    queries.insertFeedback({
      id,
      authorId: user.id,
      title: parsed.data.title,
      content: parsed.data.content,
      createdAt,
    })
    const post = queries.getFeedback(id)
    if (!post) return fail(reply, 500, 'internal', '伺服器暫時無法完成這項操作。')
    return reply.code(201).send({ post: publicFeedback(post) })
  })

  app.patch('/api/feedback/:id', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const id = feedbackIdSchema.safeParse(requestId(request))
    if (!id.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    const parsed = feedbackUpdateSchema.safeParse(request.body)
    if (!parsed.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    const post = queries.getFeedback(id.data)
    if (!post) return fail(reply, 404, 'not-found', '找不到這則留言。')
    const owner = post.authorId === user.id
    const sysadmin = user.role === 'sysadmin'
    const editsBody = parsed.data.title !== undefined || parsed.data.content !== undefined
    const moderates = parsed.data.status !== undefined || parsed.data.adminReply !== undefined
    if (editsBody && !owner) {
      deny(user, reply, 'feedback_update', '只能修改自己的留言。', { targetUsername: post.id })
      return
    }
    if (moderates && !sysadmin) {
      deny(user, reply, 'feedback_moderate', '只有系統管理員可以變更處理狀態或回覆。', {
        targetUsername: post.id,
      })
      return
    }
    if (!owner && !sysadmin) {
      deny(user, reply, 'feedback_update', '只能修改自己的留言。', { targetUsername: post.id })
      return
    }
    const updated = queries.updateFeedback(post.id, {
      title: owner ? parsed.data.title : undefined,
      content: owner ? parsed.data.content : undefined,
      status: sysadmin ? parsed.data.status : undefined,
      adminReply: sysadmin ? parsed.data.adminReply : undefined,
    })
    if (!updated) return fail(reply, 404, 'not-found', '找不到這則留言。')
    return { post: publicFeedback(updated) }
  })

  app.delete('/api/feedback/:id', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const id = feedbackIdSchema.safeParse(requestId(request))
    if (!id.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    const post = queries.getFeedback(id.data)
    if (!post) return fail(reply, 404, 'not-found', '找不到這則留言。')
    if (post.authorId !== user.id && user.role !== 'sysadmin') {
      deny(user, reply, 'feedback_delete', '只能刪除自己的留言。', { targetUsername: post.id })
      return
    }
    queries.deleteFeedback(post.id)
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
