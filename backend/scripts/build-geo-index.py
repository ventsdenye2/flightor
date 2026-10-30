"""DuckDB reads verified Parquet; stdlib sqlite builds the Node-readable index."""
import hashlib
import json
import pathlib
import re
import sqlite3
import sys
import time
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parents[1] / 'data' / 'wikimedia-geo'
sys.path.insert(0, str(ROOT / 'python'))
import duckdb

def normalize(value):
    value = ''.join(c for c in unicodedata.normalize('NFKD', value or '') if not unicodedata.combining(c)).lower()
    return re.sub(r'[^\w]+|_', ' ', value, flags=re.UNICODE).strip()

def build():
    started = time.monotonic()
    manifest = json.loads((ROOT / 'download-manifest.json').read_text())
    for entry in manifest['files']:
        with (ROOT / entry['file']).open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != entry['sha256']:
                raise ValueError('Unverified input: ' + entry['file'])
    analytical = duckdb.connect()
    analytical.execute("SET memory_limit='1GB'")
    analytical.execute(f"SET temp_directory='{ROOT.as_posix()}/tmp'")
    analytical.execute('SET threads=4')
    analytical.execute(f"""CREATE TEMP TABLE points AS
        SELECT wikidata_id, min(latitude) AS latitude, min(longitude) AS longitude,
               max(precision) AS precision, count(*) AS coordinate_count
        FROM read_parquet('{ROOT.as_posix()}/wikidata_locations.parquet')
        WHERE qualifier_property IS NULL AND qualifier_value IS NULL
          AND isfinite(latitude) AND isfinite(longitude)
          AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
        GROUP BY wikidata_id
        HAVING max(latitude)-min(latitude)<=0.002 AND max(longitude)-min(longitude)<=0.002""")
    analytical.execute(f"""CREATE TEMP TABLE links AS
        SELECT wikidata_id, min(wikipedia_page_id) AS wikipedia_page_id,
          min(wikivoyage_page_id) AS wikivoyage_page_id,
          count(*) FILTER (WHERE osm_id IS NOT NULL) AS osm_links
        FROM read_parquet('{ROOT.as_posix()}/links.parquet')
        WHERE wikidata_id IS NOT NULL GROUP BY wikidata_id""")
    cursor = analytical.execute(f"""SELECT cast(substr(w.wikidata_id,2) AS BIGINT),
          w.label, w.description, p.latitude, p.longitude, p.precision,
          w.qrank, to_json(w.instance_of), l.wikipedia_page_id, l.wikivoyage_page_id, l.osm_links
        FROM read_parquet('{ROOT.as_posix()}/wikidata.parquet') w
        JOIN points p USING(wikidata_id) LEFT JOIN links l USING(wikidata_id)
        WHERE w.label IS NOT NULL AND length(trim(w.label))>0
        AND NOT list_contains(w.instance_of, 'Q5')
        AND NOT list_contains(w.instance_of, 'Q4167410')
        AND NOT list_contains(w.instance_of, 'Q3305213')
        AND NOT regexp_matches(coalesce(w.description,''), '(?i)(crater|mountain|feature|region|sea|valley|plain|structure|landing site) (on|of) (the )?(Moon|Mars|Venus|Mercury|Titan|Ceres|Pluto|Europa|Ganymede)')""")
    temporary = ROOT / 'places.building.sqlite'
    if temporary.exists():
        temporary.unlink()
    db = sqlite3.connect(temporary)
    db.executescript('''PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-65536;
        CREATE TABLE places(id INTEGER PRIMARY KEY, label TEXT NOT NULL, name_key TEXT NOT NULL,
          description TEXT, latitude REAL NOT NULL, longitude REAL NOT NULL, precision REAL,
          qrank INTEGER, types TEXT, wikipedia_page_id INTEGER, wikivoyage_page_id INTEGER, osm_links INTEGER);
        CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);''')
    count = 0
    while rows := cursor.fetchmany(20000):
        db.executemany('INSERT INTO places VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
            ((row[0], row[1], normalize(row[1]), *row[2:]) for row in rows))
        count += len(rows)
        if count % 1000000 < 20000:
            print(f'Indexed {count:,} places', flush=True)
    db.executescript('CREATE INDEX places_name ON places(name_key); CREATE INDEX places_geo ON places(latitude,longitude);')
    stats = {'schemaVersion': 1, 'dataset': manifest['dataset'], 'snapshot': '2026-09-15',
        'license': 'CC0-1.0', 'licenseUrl': 'https://creativecommons.org/publicdomain/zero/1.0/',
        'sourceUrl': 'https://huggingface.co/datasets/' + manifest['dataset'],
        'duckdbVersion': duckdb.__version__, 'places': count, 'files': manifest['files'],
        'buildSeconds': round(time.monotonic() - started, 2)}
    db.execute('INSERT INTO metadata VALUES(?,?)', ('manifest', json.dumps(stats)))
    db.commit()
    db.close()
    temporary.replace(ROOT / 'places.sqlite')
    stats['indexBytes'] = (ROOT / 'places.sqlite').stat().st_size
    (ROOT / 'index-manifest.json').write_text(json.dumps(stats, indent=2), encoding='utf8')
    print(json.dumps(stats, indent=2), flush=True)

if __name__ == '__main__':
    build()
