import { Migrator, type Migration } from 'kysely'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { db } from './index.js'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const migrationFolder = path.join(currentDir, 'migrations')

async function main(): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: {
      async getMigrations() {
        const migrations: Record<string, Migration> = {}
        const files = (await fs.readdir(migrationFolder)).filter(file => /^\d+_.+\.(?:ts|js)$/.test(file) && !file.endsWith('.d.ts')).sort()
        for (const file of files) {
          // Native ESM treats a Windows drive letter as a URL protocol unless
          // the absolute path is explicitly converted to a file URL.
          migrations[file.replace(/\.(ts|js)$/, '')] = await import(pathToFileURL(path.join(migrationFolder, file)).href) as Migration
        }
        return migrations
      }
    }
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
