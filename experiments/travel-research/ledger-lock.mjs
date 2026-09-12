import { openSync, closeSync, unlinkSync } from 'node:fs';

/** Use the runner's exact lock path, held across the entire async operation. */
export async function withExclusiveLedgerLock(ledgerPath, operation) {
  const lockPath = `${ledgerPath}.lock`;
  let lock;
  try {
    lock = openSync(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw Object.assign(new Error('RUN_ACTIVE: wait for it to finish'), { code: 'LEDGER_LOCKED' });
    }
    throw error;
  }
  try {
    return await operation();
  } finally {
    try { closeSync(lock); }
    finally { unlinkSync(lockPath); }
  }
}
