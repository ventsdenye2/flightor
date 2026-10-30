import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { normalizePlaceName } from './geo-index.mjs'
import { entityNames } from './wikidata-entity.mjs'
import { dataRoot } from './paths.mjs'

/** Only public Wikidata entities/aliases are persisted here; never Enterprise credentials. */
export class PlaceEnrichment {
  constructor(file = path.join(dataRoot, 'wikimedia-geo', 'enrichment.sqlite')) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS entities(qid TEXT PRIMARY KEY,json TEXT NOT NULL,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS aliases(name_key TEXT NOT NULL,qid TEXT NOT NULL,PRIMARY KEY(name_key,qid)) WITHOUT ROWID;')
  }
  get(qid) {
    const row = this.db.prepare('SELECT json FROM entities WHERE qid=? AND expires>?').get(qid, Date.now())
    return row ? JSON.parse(row.json) : null
  }
  byName(name) {
    return this.db.prepare('SELECT e.json FROM aliases a JOIN entities e ON e.qid=a.qid WHERE a.name_key=? AND e.expires>? LIMIT 201').all(normalizePlaceName(name), Date.now()).map(row => JSON.parse(row.json))
  }
  put(entity) {
    if (!/^Q[1-9]\d*$/.test(entity?.id || '')) return
    this.db.exec('BEGIN')
    try {
      this.db.prepare('INSERT OR REPLACE INTO entities VALUES(?,?,?)').run(entity.id, JSON.stringify(entity), Date.now() + 30 * 86400000)
      this.db.prepare('DELETE FROM aliases WHERE qid=?').run(entity.id)
      const insert = this.db.prepare('INSERT OR IGNORE INTO aliases VALUES(?,?)')
      for (const name of entityNames(entity)) insert.run(normalizePlaceName(name), entity.id)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  close() { this.db.close() }
}
