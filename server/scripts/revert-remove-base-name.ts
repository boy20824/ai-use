import { existsSync } from 'node:fs'
import { loadEnvFiles, databasePathFromEnv } from '../src/config.ts'
import { openDatabase } from '../src/db.ts'
import { revertRemoveBaseName } from '../src/builtinFields.ts'

loadEnvFiles(true)
const databasePath = databasePathFromEnv()
if (!existsSync(databasePath)) throw new Error('資料庫不存在，未執行回復。')
const actor = process.argv[2]?.trim()
if (!actor) throw new Error('請提供執行者名稱作為第一個參數。')
const db = openDatabase(databasePath)
try {
  // Do not run migrate here: recovery must never apply unrelated adjustments.
  const reverted = revertRemoveBaseName(db, actor)
  process.stdout.write(reverted ? '已回復內建姓名設定並寫入稽核紀錄。\n' : '無待回復的姓名調整。\n')
} finally {
  db.close()
}
