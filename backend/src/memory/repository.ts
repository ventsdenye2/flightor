import { AppError } from '../lib/errors.js'

export const USER_MEMORY_MAX_BYTES = 8 * 1024
export const USER_MEMORY_PARSE_VERSION = 1

export interface UserMemory {
  enabled: boolean
  markdown: string
  version: number
  parseVersion: number
  createdAt: string
  updatedAt: string
}

export class UserMemoryVersionConflict extends AppError {
  constructor(readonly expectedVersion: number, readonly actualVersion: number) {
    super('USER_MEMORY_VERSION_CONFLICT', `User Memory version conflict: expected ${expectedVersion}, got ${actualVersion}`, 409, {
      expectedVersion, actualVersion
    })
    this.name = 'UserMemoryVersionConflict'
  }
}

export function validateMemoryMarkdown(markdown: string): string {
  if (Buffer.byteLength(markdown, 'utf8') > USER_MEMORY_MAX_BYTES) {
    throw new AppError('USER_MEMORY_TOO_LARGE', `User Memory must not exceed ${USER_MEMORY_MAX_BYTES} UTF-8 bytes`)
  }
  if (markdown.includes('\u0000')) throw new AppError('INVALID_USER_MEMORY', 'User Memory contains invalid null characters')
  return markdown
}

export interface UserMemoryRepository {
  get(): Promise<UserMemory>
  getForAgent(): Promise<UserMemory | undefined>
  updateMarkdown(markdown: string, expectedVersion: number): Promise<UserMemory>
  setEnabled(enabled: boolean, expectedVersion: number): Promise<UserMemory>
}

export class InMemoryUserMemoryRepository implements UserMemoryRepository {
  private value: UserMemory

  constructor(initial?: Partial<Pick<UserMemory, 'enabled' | 'markdown' | 'version' | 'parseVersion'>>) {
    const now = new Date().toISOString()
    this.value = {
      enabled: initial?.enabled ?? true,
      markdown: validateMemoryMarkdown(initial?.markdown ?? ''),
      version: initial?.version ?? 0,
      parseVersion: initial?.parseVersion ?? USER_MEMORY_PARSE_VERSION,
      createdAt: now,
      updatedAt: now
    }
  }

  async get(): Promise<UserMemory> { return structuredClone(this.value) }

  async getForAgent(): Promise<UserMemory | undefined> {
    return this.value.enabled ? structuredClone(this.value) : undefined
  }

  async updateMarkdown(markdown: string, expectedVersion: number): Promise<UserMemory> {
    this.assertVersion(expectedVersion)
    this.value.markdown = validateMemoryMarkdown(markdown)
    this.advance()
    return structuredClone(this.value)
  }

  async setEnabled(enabled: boolean, expectedVersion: number): Promise<UserMemory> {
    this.assertVersion(expectedVersion)
    this.value.enabled = enabled
    this.advance()
    return structuredClone(this.value)
  }

  private assertVersion(expectedVersion: number): void {
    if (expectedVersion !== this.value.version) throw new UserMemoryVersionConflict(expectedVersion, this.value.version)
  }

  private advance(): void {
    this.value.version += 1
    this.value.updatedAt = new Date().toISOString()
  }
}
