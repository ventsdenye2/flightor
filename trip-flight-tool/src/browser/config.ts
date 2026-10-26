import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlightError } from '../core/errors.js';
export interface ToolConfig { artifactDir: string; sessionPath:string; timeoutMs: number; stepTimeoutMs: number; maxAttempts: number; directResults:boolean; reuseContext:boolean; listQuietMs:number;fareQuietMs:number;networkQuietMs:number }
export function configFromEnv(overrides: Partial<ToolConfig> = {}): ToolConfig {
  const number = (name: string, fallback: number) => process.env[name] ? Number(process.env[name]) : fallback;
  const config: ToolConfig = {
    artifactDir: resolve(process.env.TRIP_FLIGHT_ARTIFACT_DIR ?? fileURLToPath(new URL('../../artifacts', import.meta.url))),
    sessionPath: resolve(process.env.TRIP_FLIGHT_SESSION_PATH ?? fileURLToPath(new URL('../../.auth/trip.json',import.meta.url))),
    timeoutMs: number('TRIP_FLIGHT_TIMEOUT_MS',180000), stepTimeoutMs: number('TRIP_FLIGHT_STEP_TIMEOUT_MS',30000),
    maxAttempts: number('TRIP_FLIGHT_MAX_ATTEMPTS',2), directResults:process.env.TRIP_FLIGHT_DIRECT_RESULTS!=='0', reuseContext:process.env.TRIP_FLIGHT_REUSE_CONTEXT!=='0',
    listQuietMs:number('TRIP_FLIGHT_LIST_QUIET_MS',300),fareQuietMs:number('TRIP_FLIGHT_FARE_QUIET_MS',300),networkQuietMs:number('TRIP_FLIGHT_NETWORK_QUIET_MS',100),...overrides,
  };
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 600000 || !Number.isInteger(config.stepTimeoutMs) || config.stepTimeoutMs < 100 || config.stepTimeoutMs > config.timeoutMs || ![1,2].includes(config.maxAttempts)) throw new FlightError('INVALID_CONFIG','Invalid timeout or attempts configuration');
  if([config.listQuietMs,config.fareQuietMs,config.networkQuietMs].some(value=>!Number.isInteger(value)||value<100||value>5000))throw new FlightError('INVALID_CONFIG','Invalid stability window');
  return config;
}
