import {readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, symlinkSync} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname, join, resolve, relative} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const here = dirname(fileURLToPath(import.meta.url));
export const defaultBaseline = join(here, '.cache/backend');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// Read a separate checkout once, then execute only copied source. Never copy an
// environment file, install dependencies, connect to a DB or launch a server.
export function prepareBaseline(sourceRoot, target = defaultBaseline) {
  sourceRoot = resolve(sourceRoot); target = resolve(target);
  if (existsSync(target)) throw new Error('BASELINE_EXISTS: choose a new target; never overwrite a frozen baseline');
  const files = [];
  const copyFile = path => {
    const bytes = readFileSync(join(sourceRoot, path));
    mkdirSync(dirname(join(target, path)), {recursive: true});
    writeFileSync(join(target, path), bytes);
    files.push({path: path.replaceAll('\\', '/'), sha256: digest(bytes)});
  };
  function copyTree(path) {
    for (const entry of readdirSync(join(sourceRoot, path), {withFileTypes: true})) {
      if (entry.name.startsWith('._') || entry.isSymbolicLink()) continue;
      const child = join(path, entry.name);
      if (entry.isDirectory()) copyTree(child);
      else if (entry.isFile()) copyFile(child);
    }
  }
  copyTree('backend/src');
  for (const name of ['package.json', 'package-lock.json', 'tsconfig.json']) copyFile(`backend/${name}`);
  files.sort((a, b) => a.path.localeCompare(b.path));
  // Catch another task changing the source while it was being copied.
  for (const file of files) if (digest(readFileSync(join(sourceRoot, file.path))) !== file.sha256) {
    throw new Error(`BASELINE_CHANGED_DURING_COPY:${file.path}`);
  }
  symlinkSync(join(sourceRoot, 'backend/node_modules'), join(target, 'backend/node_modules'), 'junction');
  const manifest = {sourceLabel: 'main-working-tree', files, sourceHash: digest(JSON.stringify(files)),
    dependencies: 'Read-only use of installed backend/node_modules junction; lockfile hashed, dependency bytes not frozen'};
  writeFileSync(join(target, 'baseline-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

export function verifyBaseline(root = defaultBaseline) {
  const manifest = JSON.parse(readFileSync(join(root, 'baseline-manifest.json'), 'utf8'));
  for (const file of manifest.files) {
    const path = resolve(root, file.path);
    if (relative(root, path).startsWith('..') || digest(readFileSync(path)) !== file.sha256) {
      throw new Error(`BASELINE_INTEGRITY_FAILED:${file.path}`);
    }
  }
  if (digest(JSON.stringify(manifest.files)) !== manifest.sourceHash) throw new Error('BASELINE_MANIFEST_INVALID');
  return manifest;
}

export async function loadBackend(root = process.env.FLIGHTOR_LAB_BASELINE || defaultBaseline) {
  root = resolve(root);
  verifyBaseline(root);
  const require = createRequire(pathToFileURL(join(root, 'backend/package.json')));
  const api = await import(pathToFileURL(require.resolve('tsx/esm/api')).href);
  const loader = (api.register ?? api.default?.register)({namespace: `provider-lab-${randomUUID()}`, tsconfig: join(root, 'backend/tsconfig.json')});
  return {root, manifest: verifyBaseline(root),
    import: file => loader.import(pathToFileURL(join(root, 'backend/src', file)).href, import.meta.url),
    close: () => loader.unregister()};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = process.argv[2];
  if (!source) throw new Error('Usage: node baseline.mjs SOURCE_WORKTREE [NEW_TARGET]');
  const manifest = prepareBaseline(source, process.argv[3]);
  console.log(JSON.stringify({files: manifest.files.length, sourceHash: manifest.sourceHash}));
}
