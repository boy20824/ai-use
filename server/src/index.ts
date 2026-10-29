import { loadConfig } from './config.ts'
import { createQueries, migrate, openDatabase } from './db.ts'
import { seedReferenceData } from './seed.ts'
import { buildApp } from './app.ts'

const config = loadConfig()
const db = openDatabase(config.databasePath)
migrate(db)
seedReferenceData(createQueries(db), config.passwords, {
  samplePath: config.sampleTemplatePath,
  seedSample: config.seedSampleData,
})
const app = await buildApp(db, config)
await app.listen({ host: config.host, port: config.port })
