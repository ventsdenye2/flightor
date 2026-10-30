"""Download only the three requested official files; resume and verify SHA-256."""
import concurrent.futures
import hashlib
import json
import pathlib
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1] / 'data' / 'wikimedia-geo'
REPO = 'wikimedia/linked-openstreetmap-wikidata-wikipedia-wikivoyage'

def download(item):
    name = item['path']
    target = ROOT / name
    expected = item['lfs']['oid']
    if target.exists() and hashlib.file_digest(target.open('rb'), 'sha256').hexdigest() == expected:
        return {'file': name, 'bytes': target.stat().st_size, 'sha256': expected}
    partial = target.with_suffix('.parquet.part')
    for attempt in range(6):
        offset = partial.stat().st_size if partial.exists() else 0
        try:
            url = f'https://huggingface.co/datasets/{REPO}/resolve/main/{name}?download=true&attempt={time.time_ns()}'
            request = urllib.request.Request(url, headers={'Range': f'bytes={offset}-'} if offset else {})
            with urllib.request.urlopen(request, timeout=90) as response:
                append = offset and response.status == 206
                with partial.open('ab' if append else 'wb') as output:
                    while chunk := response.read(4 * 1024 * 1024):
                        output.write(chunk)
            if partial.stat().st_size != item['size']:
                raise ValueError('incomplete file')
            with partial.open('rb') as stream:
                actual = hashlib.file_digest(stream, 'sha256').hexdigest()
            if actual != expected:
                partial.unlink()
                raise ValueError('SHA-256 mismatch')
            partial.replace(target)
            print(f'{name}: verified {target.stat().st_size} bytes', flush=True)
            return {'file': name, 'bytes': target.stat().st_size, 'sha256': actual}
        except Exception as error:
            print(f'{name}: retry {attempt + 1}: {type(error).__name__}: {error}', flush=True)
            time.sleep(min(2 ** attempt, 16))
    raise RuntimeError(f'download failed: {name}')

if __name__ == '__main__':
    ROOT.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(f'https://huggingface.co/api/datasets/{REPO}/tree/main?recursive=true', timeout=45) as response:
        tree = json.load(response)
    (ROOT / 'tree.json').write_text(json.dumps(tree, indent=2), encoding='utf8')
    with urllib.request.urlopen(f'https://huggingface.co/datasets/{REPO}/raw/main/README.md', timeout=45) as response:
        (ROOT / 'README.upstream.md').write_bytes(response.read())
    selected = [item for item in tree if item['path'] in {'links.parquet', 'wikidata.parquet', 'wikidata_locations.parquet'}]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        files = list(pool.map(download, selected))
    (ROOT / 'download-manifest.json').write_text(json.dumps({'dataset': REPO, 'files': files}, indent=2), encoding='utf8')
