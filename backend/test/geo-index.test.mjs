import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { dataRoot } from '../src/paths.mjs'
import { GeoIndex, normalizePlaceName } from '../src/geo-index.mjs'

test('offline index disambiguates with city geography, rejects conflicts and supports QID and nearby', async () => {
  const directory = await fs.mkdtemp(path.join(dataRoot, 'geo-test-'))
  const file = path.join(directory, 'fixture.sqlite')
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE metadata(key TEXT,value TEXT); CREATE TABLE places(id INTEGER PRIMARY KEY,label TEXT,name_key TEXT,description TEXT,latitude REAL,longitude REAL,precision REAL); CREATE INDEX names ON places(name_key);')
  db.prepare('INSERT INTO metadata VALUES(?,?)').run('manifest', JSON.stringify({ schemaVersion: 1 }))
  const insert = db.prepare('INSERT INTO places VALUES(?,?,?,?,?,?,?)')
  insert.run(1, 'Springfield', 'springfield', 'city in state A', 40, -75, .01)
  insert.run(2, 'Cambridge', 'cambridge', 'city in state B', 52, 0, .01)
  insert.run(3, 'Old Bridge', 'old bridge', 'bridge in Springfield', 40.01, -75.01, .0001)
  insert.run(4, 'Old Bridge', 'old bridge', 'bridge in Cambridge', 52.01, 0.01, .0001)
  insert.run(5, 'Coarse', 'coarse', 'landmark in Springfield', 40, -75, 1)
  db.close()
  const index = new GeoIndex(file)
  try {
    assert.equal(index.resolve({ name: 'Old Bridge' }).status, 'ambiguous')
    assert.equal(index.resolve({ name: 'Old Bridge', city: 'Springfield' }).place.qid, 'Q3')
    assert.equal(index.resolve({ name: 'Old Bridge', city: 'Nowhere' }).status, 'not-found')
    assert.equal(index.resolve({ name: 'Coarse', city: 'Springfield' }).status, 'not-found')
    assert.equal(index.resolve({ qid: 'Q3', city: 'Cambridge' }).status, 'not-found')
    assert.equal(index.byQid('Q3').latitude, 40.01)
    assert.equal(index.byQid('Q3 OR 1=1'), null)
    assert.equal(index.nearby({ latitude: 40.01, longitude: -75.01 }, .1)[0].qid, 'Q3')
    assert.throws(() => index.nearby({ latitude: 100, longitude: 0 }))
    assert.equal(normalizePlaceName('  Musée-d’Orsay '), 'musee d orsay')
  } finally { index.close(); await fs.rm(directory, { recursive: true }) }
})
