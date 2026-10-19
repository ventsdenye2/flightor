import type { ToolFailure } from './types.js';
export class FlightError extends Error {
  constructor(public code: string, message: string, public retryable = false,
    public status: ToolFailure['status'] = 'error', public evidence?: ToolFailure['evidence']) { super(message); }
}
export function failure(error: unknown, attempts = 0): ToolFailure {
  if (error instanceof FlightError) return { status: error.status, code: error.code, message: error.message, retryable: error.retryable, attempts, evidence: error.evidence };
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
    return { status: error.name === 'AbortError' ? 'cancelled' : 'error', code: error.name === 'AbortError' ? 'CANCELLED' : 'TIMEOUT', message: error.message, retryable: false, attempts };
  return { status: 'error', code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error), retryable: false, attempts };
}
