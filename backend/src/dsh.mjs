import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { backend, runtime, dshHome, dataRoot, userDshHome, nodeBin, dshBin } from './paths.mjs'

export class DshAgent {
  constructor({ role, workspace, sessionId, model = process.env.FLIGHTOR_DSH_MODEL || 'deepseek-flash', provider = process.env.FLIGHTOR_DSH_PROVIDER || 'deepseek-account', onEvent = () => {} }) {
    Object.assign(this, { role, workspace, sessionId, model, provider, onEvent })
    this.events = []
    this.stderr = ''
  }
  async start(persona) {
    const { JsonRpcLineTransport } = await import(pathToFileURL(path.join(runtime, 'node_modules/@deepseek-ai/dsh-sdk-protocol/lib/index.js')))
    await fs.mkdir(this.workspace, { recursive: true })
    const audit = path.join(dataRoot, 'audits', this.sessionId + '.json')
    const snapshot = JSON.parse(await fs.readFile(path.join(runtime, 'manifest.json'), 'utf8'))
    const desktopResources = path.dirname(snapshot.source)
    this.child = spawn(nodeBin, [dshBin, '--profile', 'flightor', '--patch', path.join(backend, 'dsh/flightor.patch.yml')], {
      cwd: this.workspace, windowsHide: true,
      env: { ...process.env,
        DSH_BUNDLED_PRIMARY_RUNTIME: process.env.DSH_BUNDLED_PRIMARY_RUNTIME || path.join(desktopResources, 'runtime/primary-runtime'),
        DSH_BUNDLED_OFFICE_SKILLS: process.env.DSH_BUNDLED_OFFICE_SKILLS || path.join(desktopResources, 'runtime/office-skills'),
        DSH_BUNDLED_OFFICE_CLI: process.env.DSH_BUNDLED_OFFICE_CLI || path.join(desktopResources, 'runtime/bin/office'),
        DSH_HOME: dshHome, FLIGHTOR_DSH_CREDENTIALS: path.join(userDshHome, '.credentials.yaml'), FLIGHTOR_DSH_PERSONA: persona, FLIGHTOR_DSH_ROLE: this.role, FLIGHTOR_DSH_AUDIT: audit }
    })
    this.child.stderr.on('data', bytes => { this.stderr = (this.stderr + bytes.toString()).slice(-8000) })
    this.child.on('error', error => { this.spawnError = error })
    this.rpc = new JsonRpcLineTransport(this.child.stdout, this.child.stdin)
    this.rpc.onNotification((method, params) => {
      if (method === 'session.event' && params.sessionId === this.sessionId) {
        this.events.push(params.event)
        this.onEvent(this.role, params.event)
      }
    })
    this.rpc.start()
    try {
      this.server = await this.rpc.request('initialize', { cwd: this.workspace, provider: this.provider, model: this.model }, AbortSignal.timeout(60000))
    } catch (error) {
      const detail = this.stderr
      await this.close()
      throw Error(`DSH ${this.role} initialization failed: ${error.message}\n${detail}`)
    }
    return this.server
  }
  async run(prompt, signal = AbortSignal.timeout(360000)) {
    const first = this.events.length
    await this.rpc.request('session/prompt', { sessionId: this.sessionId, contentBlocks: [{ type: 'text', text: prompt }] }, signal)
    await this.rpc.request('session/wait', { sessionId: this.sessionId }, signal)
    const events = this.events.slice(first)
    const end = events.findLast(event => event.type === 'turn/end')
    if (end?.data?.reason?.kind !== 'completed') throw Error(`DSH ${this.role} did not complete: ${JSON.stringify(end?.data?.reason)}`)
    const message = events.findLast(event => event.type === 'assistant/message')
    const text = message?.data?.message?.content?.filter(b => b.type === 'text').map(b => b.text).join('') || ''
    if (!text.trim()) throw Error(`DSH ${this.role} returned no answer`)
    return { text, events }
  }
  async close() {
    const child = this.child
    if (!child || child.exitCode !== null) return
    try { await this.rpc?.request('shutdown', undefined, AbortSignal.timeout(1500)) } catch {}
    child.stdin.end()
    if (child.exitCode === null) {
      await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))])
      if (child.exitCode === null) child.kill()
    }
    this.rpc?.close()
  }
}
