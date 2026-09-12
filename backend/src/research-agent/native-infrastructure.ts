import { AppError } from '../lib/errors.js'

export type NativeResearchAuditStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out'

export interface NativeResearchAuditScope {
  requestId: string
  generationId: string
  ownerId?: string
  tripId?: string
  conversationId?: string
  goalId?: string
  runId?: string
  tripContextVersion?: number
}

export interface NativeResearchAuditStart extends NativeResearchAuditScope {
  budgetId: string
  provider: string
  model: string
  reservedUsdMicros: number
  request: unknown
}

export interface NativeResearchAuditFinish {
  status: NativeResearchAuditStatus
  receipt?: unknown
  normalization?: unknown
  error?: { code: string; message: string }
  /** Undefined means the provider did not prove a final bill; the reservation remains held. */
  settledUsdMicros?: number
}

/**
 * This infrastructure is deliberately separate from ResearchAgent's artifact
 * contract. It owns money and raw provider evidence but cannot write business
 * artifacts, Goals, Trips, or Conversations.
 */
export interface NativeResearchLedger {
  reserve(input: NativeResearchAuditStart): Promise<{ auditId: string }>
  finish(auditId: string, input: NativeResearchAuditFinish): Promise<void>
}

export function checkedUsdMicros(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000_000) {
    throw new AppError('INVALID_RESEARCH_BUDGET', `${field} must be a non-negative integer number of USD micros`, 400)
  }
  return value
}

export function nativeBudgetUnavailable(): AppError {
  return new AppError('NATIVE_RESEARCH_BUDGET_UNAVAILABLE', 'Native research requires a configured shared USD budget with a positive per-call cap', 503)
}
