import { describe, expect, it } from 'vitest'
import { AppError } from '../lib/errors.js'
import {
  InMemoryUserMemoryRepository,
  USER_MEMORY_MAX_BYTES,
  UserMemoryVersionConflict
} from './repository.js'

describe('UserMemoryRepository contract', () => {
  it('starts enabled with empty markdown at version zero', async () => {
    const memory = await new InMemoryUserMemoryRepository().get()
    expect(memory).toMatchObject({ enabled: true, markdown: '', version: 0, parseVersion: 1 })
    expect(memory.createdAt).toBe(memory.updatedAt)
  })

  it('edits markdown and increments exactly once per accepted write', async () => {
    const repository = new InMemoryUserMemoryRepository()
    const edited = await repository.updateMarkdown('# Preferences', 0)
    expect(edited).toMatchObject({ markdown: '# Preferences', version: 1 })
    const disabled = await repository.setEnabled(false, 1)
    expect(disabled).toMatchObject({ enabled: false, markdown: '# Preferences', version: 2 })
    expect(await repository.getForAgent()).toBeUndefined()
  })

  it('rejects stale writes while allowing explicit owner edits when disabled', async () => {
    const repository = new InMemoryUserMemoryRepository()
    await repository.updateMarkdown('first', 0)
    await expect(repository.updateMarkdown('stale', 0)).rejects.toEqual(
      expect.objectContaining({ code: 'USER_MEMORY_VERSION_CONFLICT', expectedVersion: 0, actualVersion: 1 })
    )
    await repository.setEnabled(false, 1)
    await expect(repository.updateMarkdown('owner edit', 2)).resolves.toMatchObject({
      markdown: 'owner edit', version: 3, enabled: false
    })
    await expect(repository.getForAgent()).resolves.toBeUndefined()
  })

  it('enforces the UTF-8 byte limit and null-character validation', async () => {
    const repository = new InMemoryUserMemoryRepository()
    await expect(repository.updateMarkdown('x'.repeat(USER_MEMORY_MAX_BYTES + 1), 0)).rejects.toBeInstanceOf(AppError)
    await expect(repository.updateMarkdown('safe\u0000text', 0)).rejects.toMatchObject({ code: 'INVALID_USER_MEMORY' })
    await expect(repository.updateMarkdown(null as unknown as string, 0)).rejects.toThrow()
    await expect(repository.get()).resolves.toMatchObject({ markdown: '', version: 0 })
  })

  it('preserves the conflict error contract', async () => {
    const repository = new InMemoryUserMemoryRepository()
    await expect(repository.setEnabled(false, 9)).rejects.toBeInstanceOf(UserMemoryVersionConflict)
  })
})
