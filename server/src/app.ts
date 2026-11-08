import path from 'node:path'
import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs'
import { releaseNotes } from './releaseNotes.ts'
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
import { checkPasswordBreach } from './breachCheck.ts'

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
    // Preserve legacy bcrypt truncation for existing accounts; new secrets are byte limited.
    password: z.string().min(1).max(200),
  })
  .strict()

const passwordByteLimit = (value: string) => Buffer.byteLength(value, 'utf8') <= 72

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z
      .string()
      .min(12)
      .max(200)
      .refine(passwordByteLimit, '密碼不可超過 72 UTF-8 bytes。'),
  })
  .strict()

const categoryIdSchema = z.string().regex(/^[a-z0-9-]{1,64}$/)
const templateIdSchema = z.string().regex(/^[a-zA-Z0-9-]{1,64}$/)

const pagination = {
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
}

const categoryQuerySchema = z
  .object({
    categoryId: categoryIdSchema.optional(),
    ...pagination,
  })
  .strict()

const stepIdSchema = z.string().regex(/^[a-z0-9-]{1,64}$/)

const variantSchema = z
  .object({
    id: stepIdSchema,
    categoryId: categoryIdSchema.optional(),
    name: z.string().trim().min(1).max(80),
  })
  .strict()
const fieldSchema = z
  .object({
    scope: z.literal('base').optional(),
    id: stepIdSchema,
    categoryId: categoryIdSchema.optional(),
    name: z.string().trim().min(1).max(80).optional(),
    key: z.string().optional(),
    type: z.enum(['text', 'number']),
  })
  .strict()
  .transform((field) => ({
    ...field,
    key: (field.key ?? field.name ?? '')
      .trim()
      .replace(/^\{\{(.*)\}\}$/u, '$1')
      .trim(),
  }))
  .superRefine((field, ctx) => {
    if (
      !field.key ||
      field.key.length > 80 ||
      !/^[\p{L}\p{N}_]+$/u.test(field.key) ||
      ['__proto__', 'prototype', 'constructor'].includes(field.key)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['key'],
        message: '細項欄位鍵須為 1–80 個中文字、字母、數字或底線，且不可使用保留名稱。',
      })
  })
const stepSchema = z
  .object({
    canRunInParallel: z.boolean().optional(),
    categoryId: categoryIdSchema.optional(),
    id: stepIdSchema.optional(),
    body: z.string().trim().min(1).max(500).optional(),
    title: z.string().trim().min(1).max(500).optional(),
    order: z.number().int().min(0).max(10000).optional(),
    items: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
    note: z.string().trim().max(2000).optional(),
    variantIds: z.array(stepIdSchema).max(30).optional(),
    templateIds: z.array(templateIdSchema).max(30).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.title || v.body))
const categoryBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    // Accept legacy clients, but never use their code; existing DB codes remain intact.
    code: z.string().trim().max(32).optional(),
    group: z.enum(['criminal', 'admin', 'internal']).optional(),
    summary: z.string().trim().max(400).optional(),
    variants: z.array(variantSchema).max(30).optional(),
    fields: z
      .array(fieldSchema)
      .max(50)
      .refine(
        (fields) => new Set(fields.map((field) => field.key)).size === fields.length,
        '同一流程的細項欄位鍵不可重複。',
      )
      .optional(),
    steps: z.array(stepSchema).max(30).optional(),
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

const passwordSchema = z
  .string()
  .min(8)
  .max(200)
  .refine(passwordByteLimit, '密碼不可超過 72 UTF-8 bytes。')

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
    ...pagination,
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
    group: category.group,
    variants: category.variants,
    baseSteps: category.baseSteps,
    modules: category.modules,
    combinationOrders: category.combinationOrders,
    fields: category.fields,
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
    updatedAt: template.addedAt,
    linkedCategoryCount: new Set(template.usages.map((u) => u.categoryId)).size,
    placeholders: template.placeholders,
    origin: template.origin,
    usages: template.usages,
  }
}

function fail(reply: FastifyReply, status: number, error: string, message: string) {
  return reply.code(status).send({ error, message })
}

function categoryInputMessage(error: {
  issues: { path: PropertyKey[]; code?: string; message: string }[]
}): string {
  const fieldIssue = error.issues.find((issue) => issue.path[0] === 'fields')
  if (fieldIssue) {
    if (fieldIssue.code === 'custom') return fieldIssue.message
    return '細項欄位格式不正確：請提供名稱、有效的欄位鍵及文字或數字型別。'
  }
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
  steps: (Partial<StepInput> & { id?: string })[],
): StepInput[] {
  const owned = new Set(queries.stepIdsFor(categoryId))
  const used = new Set<string>()
  return steps.map((step) => {
    const reusable = step.id && owned.has(step.id) && !used.has(step.id) ? step.id : ''
    const id = reusable || randomBytes(16).toString('hex')
    used.add(id)
    return { ...step, id, body: step.title ?? step.body ?? '', templateIds: step.templateIds ?? [] }
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

function categoryExtras(queries: AppQueries, id: string, data: z.infer<typeof categoryBodySchema>) {
  const existing = queries.getCategory(id)
  const variants = (data.variants ?? existing?.variants ?? []).map((v) => ({
    ...v,
    categoryId: id,
  }))
  const fields = (data.fields ?? existing?.fields ?? []).map((f) => ({
    ...f,
    name: f.name ?? f.key,
    categoryId: id,
  }))
  return { group: data.group ?? existing?.group ?? 'criminal', variants, fields } as const
}
function extrasValid(
  queries: AppQueries,
  id: string,
  extras: ReturnType<typeof categoryExtras>,
  steps: StepInput[],
) {
  const all = queries.listCategories().filter((c) => c.id !== id)
  const ids = [...extras.variants, ...extras.fields].map((v) => v.id)
  if (new Set(ids).size !== ids.length) return false
  if (all.some((c) => [...c.variants, ...c.fields].some((v) => ids.includes(v.id)))) return false
  if (
    new Set(extras.variants.map((v) => v.name)).size !== extras.variants.length ||
    new Set(extras.fields.map((f) => f.key)).size !== extras.fields.length
  )
    return false
  return steps.every(
    (step) =>
      (!step.categoryId || step.categoryId === id) &&
      (step.variantIds ?? []).every((v) => extras.variants.some((x) => x.id === v)),
  )
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
    // Multipart files are streamed and retain their separate maxUploadBytes limit.
    bodyLimit: 1024 * 1024,
  })
  app.decorateRequest('authUser', null)

  const maintenance = () => {
    const now = Date.now()
    // Never shorten the security counting windows when configuring retention.
    const retention = Math.max(
      (config.eventRetentionDays ?? 7) * 86400000,
      config.loginLockoutMinutes * 60000,
      config.registerWindowMs,
      15 * 60000,
    )
    queries.cleanup(now, now - retention)
    if (config.auditRetentionDays !== undefined) {
      const cutoff = new Date(now - config.auditRetentionDays * 86400000).toISOString()
      const rows = queries.auditArchiveBatch(cutoff)
      if (rows.length) {
        // Preserve old trails unless a durable archive has been explicitly configured.
        console.warn('Audit retention: historical records eligible for archival:', rows.length)
        if (config.auditArchiveDir) {
          mkdirSync(config.auditArchiveDir, { recursive: true, mode: 0o700 })
          const archive = openSync(
            path.join(config.auditArchiveDir, `audit-${randomBytes(16).toString('hex')}.jsonl`),
            'wx',
            0o600,
          )
          try {
            writeFileSync(archive, rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
            fsyncSync(archive)
          } finally {
            closeSync(archive)
          }
          const directory = openSync(config.auditArchiveDir, 'r')
          try {
            fsyncSync(directory)
          } finally {
            closeSync(directory)
          }
          queries.removeArchivedAudit(rows.map((row) => row.id))
        }
      }
    }
  }
  const runMaintenance = () => {
    try {
      maintenance()
    } catch {
      console.warn('Security maintenance failed; audit records retained. Check archive storage.')
    }
  }
  runMaintenance()
  const maintenanceTimer = setInterval(runMaintenance, config.maintenanceIntervalMs ?? 3600000)
  maintenanceTimer.unref()
  app.addHook('onClose', async () => {
    clearInterval(maintenanceTimer)
  })

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
  const requestCounts = new Map<string, { count: number; expiresAt: number }>()
  let nextRateCleanup = 0
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.split('?')[0] === '/healthz') return
    const now = Date.now()
    if (now >= nextRateCleanup) {
      for (const [ip, entry] of requestCounts) {
        if (entry.expiresAt <= now) requestCounts.delete(ip)
      }
      nextRateCleanup = now + 60_000
    }
    const ip = request.ip
    let entry = requestCounts.get(ip)
    if (!entry || entry.expiresAt <= now) {
      entry = { count: 0, expiresAt: now + 60_000 }
      requestCounts.set(ip, entry)
    }
    if (entry.count >= config.globalRatePerMinute) {
      reply.header('retry-after', Math.ceil((entry.expiresAt - now) / 1000))
      return fail(reply, 429, 'rate-limited', '請求過多，請稍後再試。')
    }
    entry.count += 1
  })

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
    if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return fail(reply, 413, 'payload-too-large', '請求內容超過大小限制。')
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

  app.post('/api/auth/change-password', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const denied = () =>
      queries.insertAudit(user.username, 'password_change', '', '', '', '', 'denied', user.username)
    if (!queries.consumePasswordChangeAttempt(user.id, request.ip, Date.now())) {
      denied()
      reply.header('retry-after', 900)
      return fail(reply, 429, 'rate-limited', '請求過多，請稍後再試。')
    }
    const proposedPassword = (request.body as { newPassword?: unknown } | null)?.newPassword
    if (typeof proposedPassword === 'string' && !passwordByteLimit(proposedPassword)) {
      denied()
      return fail(reply, 400, 'invalid-input', '密碼不可超過 72 UTF-8 bytes。')
    }
    const parsed = changePasswordSchema.safeParse(request.body)
    const record = queries.findUserById(user.id)
    const token = sessionToken(request, config)
    if (
      !parsed.success ||
      !record ||
      !token ||
      !bcrypt.compareSync(parsed.data.currentPassword, record.passwordHash)
    ) {
      denied()
      return fail(reply, 400, 'invalid-input', '無法變更密碼，請確認輸入資料後再試。')
    }
    const breach = await checkPasswordBreach(parsed.data.newPassword)
    if (breach === 'compromised') {
      denied()
      return fail(reply, 400, 'breached-password', '新密碼曾出現在資料外洩中，請使用其他密碼。')
    }
    if (breach === 'unavailable') {
      queries.insertAudit(user.username, 'breach_check_unavailable', '', '', '', '')
    }
    const hash = bcrypt.hashSync(parsed.data.newPassword, 10)
    if (!queries.changePassword(record, token, hash)) {
      denied()
      return fail(reply, 400, 'invalid-input', '無法變更密碼，請確認輸入資料後再試。')
    }
    return reply.code(204).send()
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
    const proposedPassword = (request.body as { password?: unknown } | null)?.password
    if (typeof proposedPassword === 'string' && !passwordByteLimit(proposedPassword))
      return fail(reply, 400, 'invalid-input', '密碼不可超過 72 UTF-8 bytes。')
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
    if (!category) return fail(reply, 404, 'not-found', '找不到這個勤務流程。')
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
    const extras = categoryExtras(queries, id, parsed.data)
    if (!extrasValid(queries, id, extras, steps))
      return fail(reply, 400, 'invalid-input', '樣態或欄位設定不正確。')
    const templateError = templateListError(queries, steps)
    if (templateError) return fail(reply, 400, 'invalid-input', templateError)
    const saved = queries.createCategory(
      {
        id,
        code: id,
        name,
        summary: parsed.data.summary ?? '',
        updatedAt: stamp(),
        steps,
        ...extras,
      },
      user.username,
    )
    if (!saved) return fail(reply, 409, 'conflict', '這個類別名稱已經存在。')
    const category = queries.getCategory(id)
    if (!category) return fail(reply, 500, 'internal', '伺服器暫時無法完成這項操作。')
    return reply.code(201).send({ category: publicCategory(category) })
  })

  app.route({
    method: ['PATCH', 'PUT'],
    url: '/api/categories/:id',
    handler: async (request, reply) => {
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
      if (!existing) return fail(reply, 404, 'not-found', '找不到這個勤務流程。')
      if (queries.nameTaken(parsed.data.name, id.data)) {
        return fail(reply, 409, 'conflict', '這個類別名稱已經存在。')
      }
      const steps = normalizeSteps(queries, id.data, parsed.data.steps ?? existing.steps)
      const extras = categoryExtras(queries, id.data, parsed.data)
      if (!extrasValid(queries, id.data, extras, steps))
        return fail(reply, 400, 'invalid-input', '樣態或欄位設定不正確。')
      const templateError = templateListError(queries, steps)
      if (templateError) return fail(reply, 400, 'invalid-input', templateError)
      const saved = queries.updateCategory(
        {
          id: id.data,
          code: existing.code,
          name: parsed.data.name,
          summary: parsed.data.summary ?? existing.summary,
          updatedAt: stamp(),
          steps,
          ...extras,
        },
        user.username,
      )
      if (!saved) {
        if (!queries.getCategory(id.data))
          return fail(reply, 404, 'not-found', '找不到這個勤務流程。')
        return fail(reply, 409, 'conflict', '這個類別名稱已經存在。')
      }
      const category = queries.getCategory(id.data)
      if (!category) return fail(reply, 404, 'not-found', '找不到這個勤務流程。')
      return { category: publicCategory(category) }
    },
  })

  app.delete('/api/categories/:id', async (request, reply) => {
    const user = requireSysadmin(request, reply, 'category_delete', '只有系統管理員可以刪除。', {
      categoryId: scopedId(categoryIdSchema, requestId(request)),
    })
    if (!user) return
    const id = categoryIdSchema.safeParse(requestId(request))
    if (!id.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    const existing = queries.getCategory(id.data)
    if (!existing) return fail(reply, 404, 'not-found', '找不到這個勤務流程。')
    queries.deleteCategory(id.data, user.username, existing.name)
    return reply.code(204).send()
  })

  app.put('/api/categories/:id/combination-order', async (request, reply) => {
    const actor = requireCategoryManager(request, reply, 'category_update', {})
    if (!actor) return
    const id = categoryIdSchema.safeParse(requestId(request))
    const body = z
      .object({
        moduleIds: z.array(stepIdSchema).max(10000),
        stepIds: z
          .array(stepIdSchema)
          .max(10000)
          .refine((ids) => new Set(ids).size === ids.length),
      })
      .strict()
      .safeParse(request.body)
    if (!id.success || !body.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    const outcome = db.transaction(() => {
      const category = queries.getCategory(id.data)
      if (!category) return { status: 404, code: 'not-found', message: '找不到勤務流程。' }
      const moduleIds = [...new Set(body.data.moduleIds)].sort()
      if (
        moduleIds.some(
          (moduleId) =>
            !category.modules?.some((m) => m.id === moduleId && m.categoryId === id.data),
        )
      )
        return { status: 400, code: 'invalid-input', message: '模組須屬於本案類。' }
      const refs = [
        ...(category.baseSteps ?? []),
        ...(category.modules ?? []).filter((m) => moduleIds.includes(m.id)).flatMap((m) => m.steps),
      ]
      const expected = new Set(refs.map((r) => r.stepId))
      if (
        expected.size !== body.data.stepIds.length ||
        body.data.stepIds.some((stepId) => !expected.has(stepId)) ||
        refs.some((r) => !category.steps.some((s) => s.id === r.stepId))
      )
        return {
          status: 400,
          code: 'invalid-input',
          message: '排序須完整包含本組合全部步驟，且不可重複或跨案類。',
        }
      const key = JSON.stringify(moduleIds)
      queries.configWrite(
        id.data,
        actor.username,
        `combination_order:${key}:${JSON.stringify(body.data.stepIds)}`,
        () => {
          db.prepare(
            `INSERT INTO category_combination_orders(category_id, module_key, step_ids) VALUES (?, ?, ?)
          ON CONFLICT(category_id, module_key) DO UPDATE SET step_ids = excluded.step_ids`,
          ).run(id.data, key, JSON.stringify(body.data.stepIds))
        },
      )
      return { category: publicCategory(queries.getCategory(id.data)!) }
    })()
    if ('status' in outcome) return fail(reply, outcome.status!, outcome.code!, outcome.message!)
    return outcome
  })

  app.put('/api/categories/:id/order/:scope', async (request, reply) => {
    const actor = requireCategoryManager(request, reply, 'category_update', {})
    if (!actor) return
    const params = z
      .object({ id: categoryIdSchema, scope: z.string().min(1).max(160) })
      .safeParse(request.params)
    const body = z
      .object({
        ids: z
          .array(stepIdSchema)
          .max(10000)
          .refine((ids) => new Set(ids).size === ids.length),
      })
      .strict()
      .safeParse(request.body)
    if (!params.success || !body.success)
      return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    const { id, scope } = params.data
    return db.transaction(() => {
      const category = queries.getCategory(id)
      if (!category) return fail(reply, 404, 'not-found', '找不到勤務流程。')
      const moduleId = scope.startsWith('module:') ? scope.slice(7) : scope
      const current =
        scope === 'modules'
          ? category.modules?.map((m) => m.id)
          : scope === 'base'
            ? category.baseSteps?.map((r) => r.stepId)
            : category.modules?.find((m) => m.id === moduleId)?.steps.map((r) => r.stepId)
      if (
        !current ||
        current.length !== body.data.ids.length ||
        current.some((id) => !body.data.ids.includes(id))
      )
        return fail(reply, 400, 'invalid-input', '排序須包含本處全部引用，且不可跨案類。')
      queries.configWrite(id, actor.username, `order:${scope}`, () => {
        for (const [order, stepId] of body.data.ids.entries()) {
          if (scope === 'modules')
            db.prepare(
              'UPDATE category_modules SET sort_order = ? WHERE id = ? AND category_id = ?',
            ).run(order, stepId, id)
          else if (scope === 'base')
            db.prepare(
              'UPDATE base_step_refs SET sort_order = ? WHERE step_id = ? AND category_id = ?',
            ).run(order, stepId, id)
          else
            db.prepare(
              'UPDATE module_step_refs SET sort_order = ? WHERE step_id = ? AND module_id = ?',
            ).run(order, stepId, moduleId)
        }
      })
      return { category: publicCategory(queries.getCategory(id)!) }
    })()
  })
  const moduleSchema = z
    .object({
      name: z.string().trim().min(1).max(80),
      sortOrder: z.number().int().min(0).max(10000),
    })
    .strict()
  const refSchema = z
    .object({ stepId: stepIdSchema, sortOrder: z.number().int().min(0).max(10000) })
    .strict()
  // Configuration only: no case values or current workbench selection reach these routes.
  app.route({
    method: ['POST', 'PATCH', 'DELETE'],
    url: '/api/categories/:id/modules/:moduleId',
    handler: async (request, reply) => {
      const actor =
        request.method === 'DELETE'
          ? requireSysadmin(request, reply, 'category_update', '只有系統管理員可以刪除模組。')
          : requireCategoryManager(request, reply, 'category_update', {})
      if (!actor) return
      const params = z
        .object({ id: categoryIdSchema, moduleId: stepIdSchema })
        .safeParse(request.params)
      if (!params.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
      const { id, moduleId } = params.data
      if (!queries.getCategory(id)) return fail(reply, 404, 'not-found', '找不到勤務流程。')
      const current = db
        .prepare('SELECT category_id FROM category_modules WHERE id = ?')
        .get(moduleId) as { category_id: string } | undefined
      if (current && current.category_id !== id)
        return fail(reply, 400, 'invalid-input', '不可跨案類。')
      if (request.method !== 'POST' && !current)
        return fail(reply, 404, 'not-found', '找不到模組。')
      if (request.method === 'POST' && current) return fail(reply, 409, 'conflict', '模組已存在。')
      if (request.method === 'DELETE') {
        const confirmation = z
          .object({ confirm: z.literal(true) })
          .strict()
          .safeParse(request.body)
        const impact = db
          .prepare(
            'SELECT step_id AS stepId FROM module_step_refs WHERE module_id = ? ORDER BY sort_order, step_id',
          )
          .all(moduleId)
        if (!confirmation.success)
          return reply
            .code(409)
            .send({ message: '請確認刪除模組及其引用；共用步驟與文件會保留。', impact })
        queries.configWrite(id, actor.username, `module_delete:${moduleId}`, () => {
          db.prepare('DELETE FROM category_modules WHERE id = ? AND category_id = ?').run(
            moduleId,
            id,
          )
        })
      } else {
        const body = moduleSchema.safeParse(request.body)
        if (!body.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
        queries.configWrite(id, actor.username, `module_save:${moduleId}`, () => {
          if (request.method === 'POST')
            db.prepare(
              'INSERT INTO category_modules(id, category_id, name, sort_order) VALUES (?, ?, ?, ?)',
            ).run(moduleId, id, body.data.name, body.data.sortOrder)
          else
            db.prepare(
              'UPDATE category_modules SET name = ?, sort_order = ? WHERE id = ? AND category_id = ?',
            ).run(body.data.name, body.data.sortOrder, moduleId, id)
        })
      }
      return { category: publicCategory(queries.getCategory(id)!) }
    },
  })
  app.route({
    method: ['PUT', 'DELETE'],
    url: '/api/categories/:id/refs/:scope/:stepId',
    handler: async (request, reply) => {
      const actor = requireCategoryManager(request, reply, 'category_update', {})
      if (!actor) return
      const params = z
        .object({
          id: categoryIdSchema,
          scope: z
            .string()
            .min(1)
            .max(160)
            .refine(
              (s) =>
                s === 'base' ||
                stepIdSchema.safeParse(s.startsWith('module:') ? s.slice(7) : s).success,
            ),
          stepId: stepIdSchema,
        })
        .safeParse(request.params)
      if (!params.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
      const { id, scope, stepId } = params.data
      const moduleId = scope.startsWith('module:') ? scope.slice(7) : scope
      const body = request.method === 'PUT' ? refSchema.safeParse(request.body) : null
      if (body && (!body.success || body.data.stepId !== stepId))
        return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
      // Removal is intentionally independent of aggregate category updates.
      let valid = false
      queries.configWrite(
        id,
        actor.username,
        `ref_${request.method === 'DELETE' ? 'remove' : 'save'}:${scope}:${stepId}`,
        () => {
          if (queries.getStep(stepId)?.categoryId !== id) return false
          if (
            scope !== 'base' &&
            !db
              .prepare('SELECT 1 FROM category_modules WHERE id = ? AND category_id = ?')
              .get(moduleId, id)
          )
            return false
          valid = true
          const table = scope === 'base' ? 'base_step_refs' : 'module_step_refs'
          const owner = scope === 'base' ? 'category_id' : 'module_id'
          const ownerId = scope === 'base' ? id : moduleId
          if (request.method === 'DELETE')
            db.prepare(`DELETE FROM ${table} WHERE ${owner} = ? AND step_id = ?`).run(
              ownerId,
              stepId,
            )
          else if (body?.success)
            db.prepare(
              `INSERT INTO ${table} (${owner}, step_id, sort_order) VALUES (?, ?, ?) ON CONFLICT(${owner}, step_id) DO UPDATE SET sort_order = excluded.sort_order`,
            ).run(ownerId, stepId, body.data.sortOrder)
        },
      )
      if (!valid) return fail(reply, 400, 'invalid-input', '不可跨案類引用。')
      return { category: publicCategory(queries.getCategory(id)!) }
    },
  })
  app.get('/api/categories/:id/steps/:stepId/impact', async (request, reply) => {
    if (!requireCategoryManager(request, reply, 'category_update', {})) return
    const params = z
      .object({ id: categoryIdSchema, stepId: stepIdSchema })
      .safeParse(request.params)
    if (!params.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    if (queries.getStep(params.data.stepId)?.categoryId !== params.data.id)
      return fail(reply, 404, 'not-found', '找不到步驟。')
    return { impact: queries.stepImpact(params.data.stepId) }
  })

  for (const resource of ['variants', 'fields', 'steps'] as const) {
    const base = `/api/categories/:id/${resource}`
    app.get(base, async (request, reply) => {
      if (!requireUser(request, reply)) return
      const category = queries.getCategory(String(requestId(request)))
      if (!category) return fail(reply, 404, 'not-found', '找不到勤務流程。')
      return { [resource]: category[resource] }
    })
    app.route({
      method: ['PUT', 'PATCH', 'DELETE'],
      url: `${base}/:childId`,
      handler: mutateChild,
    })
    app.post(base, mutateChild)
    async function mutateChild(request: FastifyRequest, reply: FastifyReply) {
      const actor =
        request.method === 'DELETE' && resource !== 'fields'
          ? requireSysadmin(request, reply, 'category_update', '只有系統管理員可以刪除實體。')
          : requireCategoryManager(request, reply, 'category_update', {})
      if (!actor) return
      const params = request.params as { id: string; childId?: string }
      const category = queries.getCategory(params.id)
      if (!category) return fail(reply, 404, 'not-found', '找不到勤務流程。')
      const childId = params.childId ?? randomBytes(16).toString('hex')
      if (!stepIdSchema.safeParse(childId).success)
        return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
      const current = category[resource] as { id: string }[]
      if (request.method !== 'POST' && !current.some((v) => v.id === childId))
        return fail(reply, 404, 'not-found', '找不到項目。')
      if (request.method === 'DELETE' && resource === 'steps') {
        const outcome = db.transaction(() => {
          const impact = queries.stepImpact(childId)
          if (impact.base.length || impact.modules.length)
            return { status: 409, body: { message: '步驟仍被引用，請先移除引用。', impact } }
          const confirmed = z
            .object({ confirm: z.literal(true) })
            .strict()
            .safeParse(request.body)
          if (!confirmed.success)
            return { status: 409, body: { message: '請確認刪除步驟及文件關聯。', impact } }
          queries.configWrite(category.id, actor.username, `step_delete:${childId}`, () => {
            db.prepare('DELETE FROM category_steps WHERE id = ? AND category_id = ?').run(
              childId,
              category.id,
            )
          })
          return { status: 204, body: undefined }
        })()
        return reply.code(outcome.status).send(outcome.body)
      }
      const incoming = request.body && typeof request.body === 'object' ? request.body : {}
      const body = { ...current.find((v) => v.id === childId), ...incoming }
      if (resource === 'fields' && 'name' in incoming && !('key' in incoming))
        delete (body as { key?: string }).key
      const value =
        resource === 'steps'
          ? { ...body, id: childId }
          : { ...body, id: childId, categoryId: category.id }
      const next = current.filter((v) => v.id !== childId)
      if (request.method !== 'DELETE') {
        const index = current.findIndex((v) => v.id === childId)
        next.splice(index < 0 ? next.length : index, 0, value)
      }
      const draft = {
        name: category.name,
        group: category.group,
        summary: category.summary,
        variants: category.variants,
        fields: category.fields,
        steps: category.steps,
        [resource]: next,
      }
      if (resource === 'variants' && request.method === 'DELETE')
        return fail(reply, 409, 'conflict', '舊樣態資料保留；請使用情境模組管理。')
      const parsed = categoryBodySchema.safeParse(draft)
      if (!parsed.success)
        return fail(reply, 400, 'invalid-input', categoryInputMessage(parsed.error))
      const steps = normalizeSteps(queries, category.id, parsed.data.steps ?? [])
      const extras = categoryExtras(queries, category.id, parsed.data)
      if (!extrasValid(queries, category.id, extras, steps) || templateListError(queries, steps))
        return fail(reply, 400, 'invalid-input', '關聯設定不正確。')
      // POST step ids must be generated by the server, normalizeSteps allocates them.
      queries.updateCategory({ ...category, ...extras, steps, updatedAt: stamp() }, actor.username)
      if (request.method === 'DELETE') return reply.code(204).send()
      const saved = queries.getCategory(category.id)!
      const result =
        resource === 'steps' && request.method === 'POST'
          ? saved.steps.find((s) => !category.steps.some((old) => old.id === s.id))
          : saved[resource].find((v) => v.id === childId)
      return reply.code(request.method === 'POST' ? 201 : 200).send({
        [resource === 'variants' ? 'variant' : resource === 'fields' ? 'field' : 'step']: result,
      })
    }
  }

  app.get('/api/release-notes', async () => ({ items: releaseNotes }))

  app.delete('/api/members/:id', async (request, reply) => {
    const actor = requireSysadmin(request, reply, 'member_update', '只有系統管理員可以管理會員。')
    if (!actor) return
    const parsed = memberIdSchema.safeParse(requestId(request))
    if (!parsed.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    if (actor.id === parsed.data) return fail(reply, 400, 'invalid-input', '不能刪除自己的帳號。')
    if (!queries.findUserById(parsed.data)) return fail(reply, 404, 'not-found', '找不到會員。')
    queries.deleteMember(parsed.data)
    return reply.code(204).send()
  })

  app.get('/api/templates', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const parsed = categoryQuerySchema.safeParse(request.query)
    if (!parsed.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    if (parsed.data.categoryId && !queries.getCategory(parsed.data.categoryId)) {
      return fail(reply, 400, 'invalid-input', '找不到這個勤務流程。')
    }
    return {
      templates: queries
        .listTemplates(parsed.data.categoryId, parsed.data.limit, parsed.data.offset)
        .map(publicTemplate),
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

  const uploadTemplate = async (request: FastifyRequest, reply: FastifyReply) => {
    const replacing = request.method === 'PUT'
    const replaceId = replacing ? String(requestId(request)) : ''
    const user = requireCategoryManager(request, reply, 'upload', {})
    if (!user) return

    if (
      replacing &&
      (!templateIdSchema.safeParse(replaceId).success || !queries.getTemplateFile(replaceId))
    )
      return fail(reply, 404, 'not-found', '找不到範本。')
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
      const zipLimits = {
        maxEntries: config.maxZipEntries,
        maxCompressedBytes: config.maxUploadBytes,
        maxUncompressedBytes: config.maxZipUncompressedBytes,
      }
      const normalized = normalizeDocx(data, zipLimits)
      storedBytes = Buffer.from(normalized.data)
      formatNotices = normalized.notices
      placeholders = listPlaceholders(storedBytes, zipLimits)
    } catch {
      return fail(reply, 400, 'bad-upload', '無法讀取這份 Word 範本。')
    }

    const record = {
      id: replacing ? replaceId : randomBytes(16).toString('hex'),
      fileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: storedBytes.byteLength,
      addedAt: replacing ? new Date().toISOString() : stamp(),
      placeholders,
      origin: 'upload' as const,
      usages: [],
      data: storedBytes,
    }
    const previous = replacing ? queries.getTemplateFile(record.id) : null
    const previousBytes = previous
      ? readTemplateBytes(config.uploadDir, record.id, previous.data)
      : undefined
    if (
      !queries.templateQuota(
        user.id,
        storedBytes.length,
        replaceId,
        config.templatesPerAccount ?? 200,
        config.templatesGlobal ?? 2000,
        config.templateBytesPerAccount ?? 128 * 1024 * 1024,
        config.templateBytesGlobal ?? 512 * 1024 * 1024,
      )
    )
      return fail(reply, 429, 'quota-exceeded', '範本儲存配額已滿，請先清理既有範本。')
    writeTemplateFile(config.uploadDir, record.id, storedBytes)
    try {
      if (replacing) queries.replaceTemplate(record)
      else queries.insertTemplate(record, linkedStepId ?? undefined)
      queries.setTemplateOwner(record.id, user.id)
    } catch (error) {
      if (previousBytes) writeTemplateFile(config.uploadDir, record.id, previousBytes)
      else removeTemplateFile(config.uploadDir, record.id)
      throw error
    }
    queries.insertAudit(user.username, 'upload', record.id, record.fileName, linkedCategoryId)
    const stored = queries.getTemplateFile(record.id)
    if (!stored) return fail(reply, 500, 'internal', '伺服器暫時無法完成這項操作。')
    return reply.code(replacing ? 200 : 201).send({
      template: publicTemplate(stored),
      formatNotices,
      linkedCategoryCount: new Set(stored.usages.map((u) => u.categoryId)).size,
    })
  }
  app.post('/api/templates', uploadTemplate)
  app.put('/api/templates/:id/file', uploadTemplate)

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
    const proposedPassword = (request.body as { password?: unknown } | null)?.password
    if (typeof proposedPassword === 'string' && !passwordByteLimit(proposedPassword))
      return fail(reply, 400, 'invalid-input', '密碼不可超過 72 UTF-8 bytes。')
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
    return {
      posts: queries
        .listFeedback(parsed.data.status, parsed.data.limit, parsed.data.offset)
        .map(publicFeedback),
    }
  })

  app.post('/api/feedback', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const parsed = feedbackCreateSchema.safeParse(request.body)
    if (!parsed.success) return fail(reply, 400, 'invalid-input', '輸入格式不正確。')
    const id = randomBytes(16).toString('hex')
    const createdAt = new Date().toISOString()
    if (
      !queries.feedbackQuota(
        user.id,
        config.feedbackPerAccount ?? 500,
        config.feedbackGlobal ?? 10000,
      )
    )
      return fail(reply, 429, 'quota-exceeded', '留言配額已滿，請先清理既有留言。')
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
