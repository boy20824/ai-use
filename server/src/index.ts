import { loadConfig } from './config.ts'
import { createQueries, migrate, openDatabase } from './db.ts'
import { ensureUploadDir } from './files.ts'
import { dropRootPrivileges } from './privileges.ts'
import { seedReferenceData } from './seed.ts'
import { createShutdown } from './shutdown.ts'
import { buildApp } from './app.ts'

async function main() {
  const config = loadConfig()
  dropRootPrivileges([config.databasePath, config.uploadDir])
  ensureUploadDir(config.uploadDir)
  const db = openDatabase(config.databasePath)
  try {
    migrate(db)
    seedReferenceData(
      createQueries(db),
      config.passwords,
      config.sampleTemplatePath,
      config.uploadDir,
      config.seedSampleData,
    )
    const app = await buildApp(db, config)
    const shutdown = createShutdown(app, db)
    const onSignal = () => {
      void shutdown().then(
        () => process.exit(0),
        (error: unknown) => {
          console.error(error)
          process.exit(1)
        },
      )
    }
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)
    await app.listen({ host: config.host, port: config.port })
    console.log(`listening on ${config.host}:${config.port}`)
  } catch (error) {
    db.close()
    throw error
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
