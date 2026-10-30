import json
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parents[1] / 'data' / 'wikimedia-geo'
sys.path.insert(0, str(root / 'python'))
import duckdb

db = duckdb.connect()
db.execute("SET memory_limit='1GB'")
result = {'duckdbVersion': duckdb.__version__, 'tables': {}}
for name in ['links', 'wikidata', 'wikidata_locations']:
    if not (root / (name + '.parquet')).exists():
        continue
    source = str(root / (name + '.parquet')).replace('\\', '/')
    query = f"read_parquet('{source}')"
    schema = db.execute(f'DESCRIBE SELECT * FROM {query}').fetchall()
    count = db.execute(f'SELECT count(*) FROM {query}').fetchone()[0]
    rows = db.execute(f'SELECT * EXCLUDE (geometry, bbox) FROM {query} LIMIT 3' if name == 'wikidata_locations' else f'SELECT * FROM {query} LIMIT 3').fetchall()
    result['tables'][name] = {'schema': schema, 'count': count, 'sample': rows}
if (root / 'wikidata_locations.parquet').exists():
    result['qualifiers'] = db.execute(f"SELECT qualifier_property, qualifier_label, count(*) FROM read_parquet('{root.as_posix()}/wikidata_locations.parquet') GROUP BY ALL ORDER BY 3 DESC").fetchall()
(root / 'analysis.json').write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str), encoding='utf8')
print(json.dumps({'duckdbVersion': result['duckdbVersion'], 'tables': {name: {'rows': table['count'], 'columns': [(column[0], column[1]) for column in table['schema']]} for name, table in result['tables'].items()}, 'topQualifiers': result.get('qualifiers', [])[:8]}, ensure_ascii=True, indent=2))
