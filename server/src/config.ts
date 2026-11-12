import { config as loadDotenv } from 'dotenv'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceDir = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(sourceDir, '..')

const demoSessionSecrets = new Set([
  'dev-only-change-me',
  'change-me',
  'changeme',
  'change_me',
  'secret',
  'session-secret',
  'session_secret',
  'demo',
  'password',
  'default',
  'example',
  'clerk-demo',
  'admin-demo',
  'viewer-demo',
  'replace-me',
  'your-secret-here',
])

const demoSeedPasswords = new Set(['clerk-demo', 'admin-demo', 'viewer-demo'])

export function loadEnvFiles(quiet = false) {
  const rootEnv = path.resolve(serverRoot, '../.env')
  const serverEnv = path.resolve(serverRoot, '.env')
  if (existsSync(rootEnv)) loadDotenv({ path: rootEnv, quiet })
  if (existsSync(serverEnv)) loadDotenv({ path: serverEnv, override: true, quiet })
}

export interface SeedPasswords {
  clerk: string
  admin: string
  viewer: string
}

export interface AppConfig {
  feedbackPerAccount?: number
  feedbackGlobal?: number
  templatesPerAccount?: number
  templatesGlobal?: number
  templateBytesPerAccount?: number
  templateBytesGlobal?: number
  eventRetentionDays?: number
  maintenanceIntervalMs?: number
  auditRetentionDays?: number
  auditArchiveDir?: string
  host: string
  port: number
  databasePath: string
  uploadDir: string
  sessionSecret: string
  sessionTtlHours: number
  cookieSecure: boolean
  corsOrigins: string[]
  maxPdfUploadBytes?: number
  maxUploadBytes: number
  maxZipEntries: number
  maxZipUncompressedBytes: number
  loginMaxFailures: number
  loginLockoutMinutes: number
  globalRatePerMinute: number
  loginRatePerMinute: number
  registerIpLimit: number
  registerGlobalLimit: number
  registerWindowMs: number
  sampleTemplatePath: string
  seedSampleData: boolean
  staticDir: string | undefined
  trustProxy: boolean
  seedDemoUsers: boolean
  passwords: SeedPasswords | undefined
}

export function cookieSecureFromEnv(
  nodeEnv: string | undefined,
  flag: string | undefined,
): boolean {
  return nodeEnv === 'production' || flag === 'true'
}

function envFlag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function seedSampleEnabled(
  nodeEnv: string | undefined,
  sampleFlag: string | undefined,
  demoUsersFlag: string | undefined,
): boolean {
  if (nodeEnv === 'production') return false
  return envFlag(sampleFlag) || envFlag(demoUsersFlag)
}

export function resolveServerPath(value: string): string {
  return path.resolve(serverRoot, value)
}

function listEnv(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`缺少環境變數 ${name}。請把 .env.example 複製成 .env。`)
  }
  return value
}

function corsOriginsFromEnv(nodeEnv: string | undefined): string[] {
  const listed = listEnv('CORS_ORIGINS')
  if (listed.length > 0) return listed
  const single = process.env.CORS_ORIGIN?.trim()
  if (single) return [single]
  if (nodeEnv === 'production') return []
  return ['http://localhost:5173', 'http://127.0.0.1:5173']
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`環境變數 ${name} 必須是正數。`)
  }
  return value
}

function pathEnv(name: string, fallback: string): string {
  const raw = process.env[name]?.trim()
  return resolveServerPath(raw || fallback)
}

function seedPassword(nodeEnv: string | undefined, name: string): string {
  const value = requiredEnv(name)
  if (nodeEnv === 'production' && demoSeedPasswords.has(value)) {
    throw new Error(
      `正式環境的 ${name} 不能使用示範密碼。請用 fly secrets set 設定，且不要寫進檔案。`,
    )
  }
  return value
}

export function seedDemoUsersFromEnv(
  nodeEnv: string | undefined,
  raw: string | undefined,
): boolean {
  const value = raw?.trim() ?? ''
  if (value === '') return nodeEnv !== 'production'
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error('環境變數 SEED_DEMO_USERS 必須是 true 或 false。')
}

function loadSeedPasswords(nodeEnv: string | undefined): SeedPasswords {
  return {
    clerk: seedPassword(nodeEnv, 'SEED_USER_CLERK_PASSWORD'),
    admin: seedPassword(nodeEnv, 'SEED_USER_ADMIN_PASSWORD'),
    viewer: seedPassword(nodeEnv, 'SEED_USER_VIEWER_PASSWORD'),
  }
}

export function sessionSecretFromEnv(
  nodeEnv: string | undefined,
  raw: string | undefined,
  passwords: SeedPasswords | undefined,
): string {
  const value = raw?.trim() ?? ''
  if (nodeEnv !== 'production') return value
  const normalized = value.toLowerCase()
  const matchesSeedPassword =
    passwords !== undefined &&
    (value === passwords.clerk || value === passwords.admin || value === passwords.viewer)
  const rejected =
    value.length < 32 ||
    demoSessionSecrets.has(normalized) ||
    normalized.startsWith('dev-only') ||
    normalized.startsWith('change-me') ||
    normalized.startsWith('changeme') ||
    matchesSeedPassword
  if (rejected) {
    throw new Error(
      '正式環境的 SESSION_SECRET 必須至少 32 字元，且不能是示範或預設值。請用 fly secrets set 設定。',
    )
  }
  return value
}

function requireIndexHtml(dir: string): string {
  if (!existsSync(path.join(dir, 'index.html'))) {
    throw new Error(`找不到靜態檔目錄 ${dir} 裡的 index.html。`)
  }
  return dir
}

function staticDirFromEnv(nodeEnv: string | undefined): string | undefined {
  const raw = process.env.STATIC_DIR?.trim()
  if (raw) return requireIndexHtml(path.resolve(raw))
  if (nodeEnv !== 'production') return undefined
  const candidate = path.resolve(serverRoot, '../dist')
  if (!existsSync(path.join(candidate, 'index.html'))) {
    throw new Error('正式環境找不到前端建置目錄。請設定 STATIC_DIR，或先執行 pnpm build。')
  }
  return candidate
}

function hostFromEnv(nodeEnv: string | undefined): string {
  const raw = process.env.HOST?.trim()
  if (raw) return raw
  return nodeEnv === 'production' ? '0.0.0.0' : '127.0.0.1'
}

function trustProxyFromEnv(nodeEnv: string | undefined): boolean {
  const raw = process.env.TRUST_PROXY?.trim()
  if (raw === 'true') return true
  if (raw === 'false') return false
  return nodeEnv === 'production'
}

function sampleTemplatePathFromEnv(): string {
  const raw = process.env.SAMPLE_TEMPLATE_PATH?.trim()
  if (!raw) return path.resolve(serverRoot, '../public/samples/field-note.docx')
  return path.resolve(raw)
}

export function databasePathFromEnv(): string {
  return pathEnv('DATABASE_PATH', 'data/app.sqlite')
}

export function loadConfig(): AppConfig {
  loadEnvFiles()
  const nodeEnv = process.env.NODE_ENV
  const seedDemoUsers = seedDemoUsersFromEnv(nodeEnv, process.env.SEED_DEMO_USERS)
  const passwords = seedDemoUsers ? loadSeedPasswords(nodeEnv) : undefined
  return {
    feedbackPerAccount: numberEnv('FEEDBACK_PER_ACCOUNT', 500),
    feedbackGlobal: numberEnv('FEEDBACK_GLOBAL', 10000),
    templatesPerAccount: numberEnv('TEMPLATES_PER_ACCOUNT', 200),
    templatesGlobal: numberEnv('TEMPLATES_GLOBAL', 2000),
    templateBytesPerAccount: numberEnv('TEMPLATE_BYTES_PER_ACCOUNT', 128 * 1024 * 1024),
    templateBytesGlobal: numberEnv('TEMPLATE_BYTES_GLOBAL', 512 * 1024 * 1024),
    eventRetentionDays: numberEnv('EVENT_RETENTION_DAYS', 7),
    maintenanceIntervalMs: numberEnv('MAINTENANCE_INTERVAL_MS', 60 * 60 * 1000),
    // Unset means retain forever. Archiving requires an explicit directory.
    auditRetentionDays: process.env.AUDIT_RETENTION_DAYS
      ? numberEnv('AUDIT_RETENTION_DAYS', 365)
      : undefined,
    auditArchiveDir: process.env.AUDIT_ARCHIVE_DIR ? pathEnv('AUDIT_ARCHIVE_DIR', '') : undefined,
    host: hostFromEnv(nodeEnv),
    port: numberEnv('PORT', 3000),
    databasePath: databasePathFromEnv(),
    uploadDir: pathEnv('UPLOAD_DIR', 'data/uploads'),
    sessionSecret: sessionSecretFromEnv(nodeEnv, process.env.SESSION_SECRET, passwords),
    sessionTtlHours: numberEnv('SESSION_TTL_HOURS', 12),
    cookieSecure: cookieSecureFromEnv(nodeEnv, process.env.COOKIE_SECURE),
    corsOrigins: corsOriginsFromEnv(nodeEnv),
    maxPdfUploadBytes: numberEnv('MAX_PDF_UPLOAD_BYTES', 20 * 1024 * 1024),
    maxUploadBytes: numberEnv('MAX_UPLOAD_BYTES', 8 * 1024 * 1024),
    maxZipEntries: numberEnv('MAX_ZIP_ENTRIES', 64),
    maxZipUncompressedBytes: numberEnv('MAX_ZIP_UNCOMPRESSED_BYTES', 32 * 1024 * 1024),
    loginMaxFailures: numberEnv('LOGIN_MAX_FAILURES', 5),
    loginLockoutMinutes: numberEnv('LOGIN_LOCKOUT_MINUTES', 15),
    globalRatePerMinute: numberEnv('GLOBAL_RATE_PER_MINUTE', 120),
    loginRatePerMinute: numberEnv('LOGIN_RATE_PER_MINUTE', 20),
    registerIpLimit: numberEnv('REGISTER_IP_LIMIT', 5),
    registerGlobalLimit: numberEnv('REGISTER_GLOBAL_LIMIT', 30),
    registerWindowMs: numberEnv('REGISTER_WINDOW_MS', 60 * 60 * 1000),
    sampleTemplatePath: sampleTemplatePathFromEnv(),
    seedSampleData: seedSampleEnabled(
      nodeEnv,
      process.env.SEED_SAMPLE_DATA,
      process.env.SEED_DEMO_USERS,
    ),
    staticDir: staticDirFromEnv(nodeEnv),
    trustProxy: trustProxyFromEnv(nodeEnv),
    seedDemoUsers,
    passwords,
  }
}
