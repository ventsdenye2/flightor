import fs from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parse } from 'dotenv'

const file = fileURLToPath(new URL('../.env.demo', import.meta.url))
const original = await fs.readFile(file, 'utf8')
const config = parse(original)
const database = new URL(config.DATABASE_URL)
if (config.NODE_ENV !== 'development' || database.pathname !== '/flightor_demo'
  || !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)) {
  throw new Error('Expected the dedicated local flightor_demo development configuration')
}
const key = config.LOCAL_LOGIN_KEY?.length >= 32 ? config.LOCAL_LOGIN_KEY : randomBytes(32).toString('base64url')
const updates = { HOST: '127.0.0.1', LOCAL_LOGIN_ENABLED: 'true', LOCAL_LOGIN_KEY: key }
let content = original
for (const [name, value] of Object.entries(updates)) {
  const pattern = new RegExp(`^${name}=.*$`, 'm')
  content = pattern.test(content) ? content.replace(pattern, `${name}=${value}`) : `${content.trimEnd()}\n${name}=${value}\n`
}
await fs.writeFile(file, content)
console.log('Local test sign-in configured in backend/.env.demo. Restart demo:api and run build:weapp:local. Credentials were not printed.')
