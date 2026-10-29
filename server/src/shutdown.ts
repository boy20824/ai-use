import type { AppDatabase } from './db.ts'

export function createShutdown(app: { close: () => Promise<unknown> }, db: AppDatabase) {
  let pending: Promise<void> | null = null
  return function shutdown() {
    if (!pending) {
      pending = (async () => {
        try {
          await app.close()
        } finally {
          try {
            db.pragma('wal_checkpoint(TRUNCATE)')
          } catch {
            // Already closed, or this handle does not keep a WAL file.
          }
          db.close()
        }
      })()
    }
    return pending
  }
}
