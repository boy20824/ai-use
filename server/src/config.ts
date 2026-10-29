import { config as loadDotenv } from 'dotenv'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceDir = path.dirname(fileURLToPath(import.meta.url))

export function loadEnvFiles() {
  const rootEnv = path.resolve(sourceDir, '../../.env')
  const serverEnv = path.resolve(sourceDir, '../.env')
  if (existsSync(rootEnv)) loadDotenv({ path: rootEnv })
  if (existsSync(serverEnv)) loadDotenv({ path: serverEnv, override: true })
}

export interface SeedPasswords {
  clerk: string
  admin: string
  viewer: string
}

export interface AppConfig {
  host: string
  port: number
  databasePath: string
  sessionTtlHours: number
  cookieSecure: boolean
  corsOrigins: string[]
  maxUploadBytes: number
  maxZipEntries: number
  maxZipUncompressedBytes: number
  loginMaxFailures: number
  loginLockoutMinutes: number
  loginRatePerMinute: number
  sampleTemplatePath: string
  seedSampleData: boolean
  passwords: SeedPasswords
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

function corsOriginsFromEnv(): string[] {
  const listed = listEnv('CORS_ORIGINS')
  if (listed.length > 0) return listed
  const single = process.env.CORS_ORIGIN?.trim()
  if (single) return [single]
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

export function loadConfig(): AppConfig {
  loadEnvFiles()
  return {
    host: process.env.HOST?.trim() || '127.0.0.1',
    port: numberEnv('PORT', 3000),
    databasePath: path.resolve(
      sourceDir,
      '..',
      process.env.DATABASE_PATH?.trim() || 'data/app.sqlite',
    ),
    sessionTtlHours: numberEnv('SESSION_TTL_HOURS', 12),
    cookieSecure: cookieSecureFromEnv(process.env.NODE_ENV, process.env.COOKIE_SECURE),
    corsOrigins: corsOriginsFromEnv(),
    maxUploadBytes: numberEnv('MAX_UPLOAD_BYTES', 8 * 1024 * 1024),
    maxZipEntries: numberEnv('MAX_ZIP_ENTRIES', 64),
    maxZipUncompressedBytes: numberEnv('MAX_ZIP_UNCOMPRESSED_BYTES', 32 * 1024 * 1024),
    loginMaxFailures: numberEnv('LOGIN_MAX_FAILURES', 5),
    loginLockoutMinutes: numberEnv('LOGIN_LOCKOUT_MINUTES', 15),
    loginRatePerMinute: numberEnv('LOGIN_RATE_PER_MINUTE', 20),
    sampleTemplatePath: path.resolve(sourceDir, '../../public/samples/field-note.docx'),
    seedSampleData: seedSampleEnabled(
      process.env.NODE_ENV,
      process.env.SEED_SAMPLE_DATA,
      process.env.SEED_DEMO_USERS,
    ),
    passwords: {
      clerk: requiredEnv('SEED_USER_CLERK_PASSWORD'),
      admin: requiredEnv('SEED_USER_ADMIN_PASSWORD'),
      viewer: requiredEnv('SEED_USER_VIEWER_PASSWORD'),
    },
  }
}
