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
  corsOrigin: string
  maxUploadBytes: number
  sampleTemplatePath: string
  passwords: SeedPasswords
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`缺少環境變數 ${name}。請把 .env.example 複製成 .env。`)
  }
  return value
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
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    corsOrigin: process.env.CORS_ORIGIN?.trim() || 'http://localhost:5173',
    maxUploadBytes: numberEnv('MAX_UPLOAD_BYTES', 8 * 1024 * 1024),
    sampleTemplatePath: path.resolve(sourceDir, '../../public/samples/field-note.docx'),
    passwords: {
      clerk: requiredEnv('SEED_USER_CLERK_PASSWORD'),
      admin: requiredEnv('SEED_USER_ADMIN_PASSWORD'),
      viewer: requiredEnv('SEED_USER_VIEWER_PASSWORD'),
    },
  }
}
