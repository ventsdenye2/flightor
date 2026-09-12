import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, openSync, closeSync, unlinkSync, rmdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withExclusiveLedgerLock } from './ledger-lock.mjs';

function fixture(t) {
  // Stay inside the writable checkout; the system temp directory can be denied
  // by the Windows sandbox. These private fixtures never touch the real ledger.
  const directory = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), '.budget-lock-test-'));
  const path = join(directory, 'ledger.json');
  t.after(() => {
    if (existsSync(`${path}.lock`)) unlinkSync(`${path}.lock`);
    if (existsSync(path)) unlinkSync(path);
    rmdirSync(directory);
  });
  return path;
}

test('a preexisting runner lock rejects reconciliation without deleting the owner lock', async t => {
  const path = fixture(t);
  const owner = openSync(`${path}.lock`, 'wx');
  let invoked = false;
  try {
    await assert.rejects(withExclusiveLedgerLock(path, () => { invoked = true; }), { code: 'LEDGER_LOCKED' });
    assert.equal(invoked, false);
    assert.equal(existsSync(`${path}.lock`), true);
  } finally {
    closeSync(owner);
    unlinkSync(`${path}.lock`);
  }
});

test('lock spans asynchronous accounting work and excludes both runner and second reconciler', async t => {
  const path = fixture(t);
  writeFileSync(path, JSON.stringify({ amount: 1 }));
  let continueOperation;
  const waiting = new Promise(resolve => { continueOperation = resolve; });
  const work = withExclusiveLedgerLock(path, async () => {
    const ledger = JSON.parse(readFileSync(path, 'utf8'));
    await waiting;
    assert.equal(existsSync(`${path}.lock`), true);
    writeFileSync(path, JSON.stringify({ amount: ledger.amount + 1 }));
    return 2;
  });
  try {
    assert.throws(() => openSync(`${path}.lock`, 'wx'), { code: 'EEXIST' });
    await assert.rejects(withExclusiveLedgerLock(path, () => assert.fail('must not enter')), { code: 'LEDGER_LOCKED' });
  } finally {
    continueOperation();
  }
  assert.equal(await work, 2);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).amount, 2);
  assert.equal(existsSync(`${path}.lock`), false);
  assert.equal(await withExclusiveLedgerLock(path, () => 'next owner'), 'next owner');
});

test('synchronous and asynchronous operation failures release only the acquired lock', async t => {
  const path = fixture(t);
  const syncError = new Error('bad ledger');
  await assert.rejects(withExclusiveLedgerLock(path, () => { throw syncError; }), error => error === syncError);
  assert.equal(existsSync(`${path}.lock`), false);
  const asyncError = new Error('provider unavailable');
  await assert.rejects(withExclusiveLedgerLock(path, async () => {
    await Promise.resolve();
    throw asyncError;
  }), error => error === asyncError);
  assert.equal(existsSync(`${path}.lock`), false);
  assert.equal(await withExclusiveLedgerLock(path, () => 'recovered'), 'recovered');
});
