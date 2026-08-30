import { FileMigrationProvider, Migrator } from 'kysely'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { db } from './index.js'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const migrationFolder = path.join(currentDir, 'migrations')

async function main(): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({ fs, path, migrationFolder })
  })
  const direction = process.argv[2]
  const result = direction === 'down'
    ? await migrator.migrateDown()
    : await migrator.migrateToLatest()

  for (const item of result.results ?? []) {
    console.log(JSON.stringify({ migration: item.migrationName, status: item.status, direction: item.direction }))
  }
  if (result.error) throw result.error
}

main()
  .catch(error => {
    console.error(JSON.stringify({ event: 'migration_failed', message: error instanceof Error ? error.message : 'unknown error' }))
    process.exitCode = 1
  })
  .finally(() => db.destroy())
