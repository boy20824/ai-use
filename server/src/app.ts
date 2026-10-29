import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { categoryIds } from './categories.ts'
import type { AppConfig } from './config.ts'
import { hasZipHeader, isAllowedDocxMime, listPlaceholders } from './docx.ts'
import { createQueries, type AppDatabase, type AppQueries, type Role } from './db.ts'

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

const cookieName = 'session'
const dummyHash = bcrypt.hashSync(randomBytes(16).toString('hex'), 10)

function publicUser(user: AuthUser) {
  return { username: user.username, displayName: user.displayName, role: user.role }
}

function readSession(queries: AppQueries, token: string | undefined): AuthUser | null {
  if (!token) return null
  const row = queries.findSession(token)
  if (!row) return null
  if (Date.parse(row.expires_at) <= Date.now()) {
    queries.deleteSession(token)
    return null
  }
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role }
}

function setSessionCookie(reply: FastifyReply, config: AppConfig, token: string) {
  reply.setCookie(cookieName, token, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure: config.cookieSecure,
    maxAge: config.sessionTtlHours * 60 * 60,
  })
}

function clearSessionCookie(reply: FastifyReply, config: AppConfig) {
  reply.clearCookie(cookieName, { path: '/', sameSite: 'strict', secure: config.cookieSecure })
}

function requireUser(request: FastifyRequest, reply: FastifyReply) {
  if (!request.authUser) {
    reply.code(401).send({ message: '請先登入。' })
    return null
  }
  return request.authUser
}

export async function buildApp(db: AppDatabase, config: AppConfig) {
  const queries = createQueries(db)
  const app = Fastify({ logger: false })
  app.decorateRequest('authUser', null)

  await app.register(cookie)
  await app.register(cors, { origin: config.corsOrigin, credentials: true })
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1 } })

  app.addHook('onRequest', async (request) => {
    request.authUser = readSession(queries, request.cookies?.[cookieName])
  })

  app.setErrorHandler((error: { code?: string }, _request, reply) => {
    if (error.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ message: '檔案超過大小限制。' })
    }
    return reply.code(500).send({ message: '伺服器暫時無法完成這項操作。' })
  })

  app.post('/api/auth/login', async (request, reply) => {
    const body = request.body as { username?: unknown; password?: unknown }
    const username = typeof body?.username === 'string' ? body.username.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const user = username ? queries.findUserByUsername(username) : null
    const matches = bcrypt.compareSync(password, user?.passwordHash ?? dummyHash)
    if (!user || !matches) {
      return reply.code(401).send({ message: '帳號或密碼不正確。' })
    }
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1000).toISOString()
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
    const token = request.cookies?.[cookieName]
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
    const query = request.query as { categoryId?: unknown }
    const categoryId = typeof query.categoryId === 'string' ? query.categoryId : undefined
    if (categoryId && !categoryIds.has(categoryId)) {
      return reply.code(400).send({ message: '找不到這個案件類別。' })
    }
    return {
      templates: queries.listTemplates(categoryId).map((item) => ({
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
    const { id } = request.params as { id: string }
    const template = queries.getTemplateFile(id)
    if (!template?.data) return reply.code(404).send({ message: '找不到這份範本。' })
    return reply
      .header('content-type', template.mimeType)
      .header(
        'content-disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(template.fileName)}`,
      )
      .send(template.data)
  })

  app.post('/api/templates', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    if (user.role === 'viewer') {
      return reply.code(403).send({ message: '唯讀身分不能上傳範本。' })
    }

    const file = await request.file()
    if (!file) return reply.code(400).send({ message: '請選擇 .docx 檔案。' })
    const categoryField = file.fields.categoryId
    const categoryId =
      categoryField && typeof categoryField === 'object' && 'value' in categoryField
        ? String(categoryField.value)
        : ''
    if (!categoryIds.has(categoryId)) {
      return reply.code(400).send({ message: '找不到這個案件類別。' })
    }
    const fileName = file.filename.replace(/[/\\]/g, '_').replace(/\0/g, '').trim().slice(0, 180)
    if (!fileName.toLowerCase().endsWith('.docx') || !isAllowedDocxMime(file.mimetype)) {
      return reply.code(400).send({ message: '只接受 Word .docx 範本。' })
    }

    const data = await file.toBuffer()
    if (!hasZipHeader(data)) {
      return reply.code(400).send({ message: '檔案內容不是 Word 文件。' })
    }
    let placeholders: string[]
    try {
      placeholders = listPlaceholders(data)
    } catch {
      return reply.code(400).send({ message: '無法讀取這份 Word 範本。' })
    }

    const record = {
      id: randomBytes(16).toString('hex'),
      categoryId,
      fileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: data.byteLength,
      addedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      placeholders,
      origin: 'upload' as const,
      data,
    }
    queries.insertTemplate(record)
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
      return reply.code(403).send({ message: '只有管理員可以移除範本。' })
    }
    const { id } = request.params as { id: string }
    const changes = queries.deleteTemplate(id)
    if (changes === 0) return reply.code(404).send({ message: '找不到這份範本。' })
    return reply.code(204).send()
  })

  return app
}
