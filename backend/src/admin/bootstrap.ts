import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'
import { db } from '../db/index.js'
import { hashAdminPassword } from './auth.js'

try {
  const input = z.object({ ADMIN_EMAIL: z.email().transform(v => v.toLowerCase()), ADMIN_PASSWORD: z.string().min(14).max(256), ADMIN_ROLE: z.enum(['viewer', 'reviewer', 'admin']).default('reviewer') }).parse(process.env)
  const exists = await db.selectFrom('admin_users').select('id').where('email', '=', input.ADMIN_EMAIL).executeTakeFirst()
  if (exists) throw new Error('Account already exists; bootstrap does not overwrite credentials')
  await db.insertInto('admin_users').values({ id: uuidv7(), email: input.ADMIN_EMAIL, password_hash: await hashAdminPassword(input.ADMIN_PASSWORD), role: input.ADMIN_ROLE }).execute()
  console.log('Editorial account created')
} catch (error) {
  console.error(error instanceof z.ZodError ? 'Set ADMIN_EMAIL, ADMIN_PASSWORD (14+ characters) and optional ADMIN_ROLE' : error instanceof Error ? error.message : 'Account creation failed')
  process.exitCode = 1
} finally { await db.destroy() }
