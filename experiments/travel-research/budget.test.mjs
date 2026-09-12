import test from 'node:test';
import assert from 'node:assert/strict';
import { Budget, validateLedger } from './budget.mjs';

const snapshot = (overrides = {}) => ({
  limitUsd: 5, knownOpenRouterUsd: 0.5, reservedUnknownUsd: 0.25,
  unknownCalls: 1, reviewedRejections: 1, serpApiRequests: 2,
  maxSerpApiRequests: 96, serpApiCostUsd: null, ...overrides
});

test('unknown billing stops each future search without consuming its count', () => {
  const budget = new Budget(5);
  budget.reserveSearch();
  const call = budget.reserve();
  budget.settle(call, undefined);
  assert.throws(() => budget.reserve(), { code: 'BILLING_UNKNOWN_STOP' });
  assert.throws(() => budget.reserveSearch(), { code: 'BILLING_UNKNOWN_STOP' });
  assert.equal(budget.snapshot().serpApiRequests, 1);
  assert.equal(budget.snapshot().reservedUnknownUsd, 0.25);
});

test('search admission observes both active reservations and settled amounts', () => {
  const budget = new Budget(0.5);
  const first = budget.reserve();
  const second = budget.reserve();
  assert.throws(() => budget.reserveSearch(), { code: 'BUDGET_EXHAUSTED' });
  budget.settle(first, 0.4);
  budget.settle(second, 0);
  assert.throws(() => budget.reserveSearch(), { code: 'BUDGET_EXHAUSTED' });
  assert.equal(budget.snapshot().serpApiRequests, 0);
});

test('reviewed unknown calls retain reservations while permitting affordable searches', () => {
  const budget = new Budget(5);
  budget.restore(snapshot());
  budget.reserveSearch();
  assert.equal(budget.snapshot().serpApiRequests, 3);
  assert.equal(budget.snapshot().reservedUnknownUsd, 0.25);
  const exhausted = new Budget(5);
  exhausted.restore(snapshot({ knownOpenRouterUsd: 4.7 }));
  assert.throws(() => exhausted.reserveSearch(), { code: 'BUDGET_EXHAUSTED' });
});

test('restore rejects invalid reviewed counters and leaves prior state unchanged', () => {
  const budget = new Budget(5);
  budget.restore(snapshot());
  const before = budget.snapshot();
  for (const reviewedRejections of ['not-a-number', '1', null, NaN, Infinity, -1, 0.5, 2, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => budget.restore(snapshot({ knownOpenRouterUsd: 4, reviewedRejections })), /INVALID_LEDGER/);
    assert.deepEqual(budget.snapshot(), before);
  }
});

test('all counters must be nonnegative safe integers, and amounts finite nonnegative numbers', () => {
  for (const key of ['unknownCalls', 'serpApiRequests', 'maxSerpApiRequests']) {
    for (const value of [-1, 0.5, '1', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => validateLedger(snapshot({ [key]: value })), /INVALID_LEDGER/);
    }
  }
  for (const key of ['knownOpenRouterUsd', 'reservedUnknownUsd', 'serpApiCostUsd']) {
    for (const value of [-1, '0', NaN, Infinity]) {
      assert.throws(() => validateLedger(snapshot({ [key]: value })), /INVALID_LEDGER/);
    }
  }
  for (const value of [0, -1, null, '5', NaN, Infinity]) {
    assert.throws(() => validateLedger(snapshot({ limitUsd: value })), /INVALID_LEDGER/);
  }
  for (const value of [null, [], 'ledger', 3]) {
    assert.throws(() => validateLedger(value), /INVALID_LEDGER/);
  }
});

test('legacy snapshots without reviewed count grant no exception to unknown billing', () => {
  const saved = snapshot();
  delete saved.reviewedRejections;
  const before = structuredClone(saved);
  const budget = new Budget(5);
  budget.restore(saved);
  assert.equal(budget.snapshot().reviewedRejections, 0);
  assert.throws(() => budget.reserveSearch(), { code: 'BILLING_UNKNOWN_STOP' });
  assert.deepEqual(saved, before);
});

test('a valid over-limit receipt restores for inspection but blocks new work', () => {
  const budget = new Budget(5);
  budget.restore(snapshot({ knownOpenRouterUsd: 5.1 }));
  assert.equal(budget.snapshot().knownOpenRouterUsd, 5.1);
  assert.throws(() => budget.reserve(), { code: 'BUDGET_EXHAUSTED' });
  assert.throws(() => budget.reserveSearch(), { code: 'BUDGET_EXHAUSTED' });
});

test('limit mismatch and restoring over active calls cannot partially mutate the budget', () => {
  const budget = new Budget(5);
  budget.restore(snapshot());
  const before = budget.snapshot();
  assert.throws(() => budget.restore(snapshot({ limitUsd: 6 })), /LEDGER_LIMIT_MISMATCH/);
  assert.deepEqual(budget.snapshot(), before);
  const id = budget.reserve();
  const pending = budget.snapshot();
  assert.throws(() => budget.restore(snapshot()), /LEDGER_RESTORE_WITH_PENDING/);
  assert.deepEqual(budget.snapshot(), pending);
  budget.settle(id, 0);
});
