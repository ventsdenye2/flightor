import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { backend, runtime, dshHome, dataRoot, userDshHome, nodeBin, dshBin } from './paths.mjs'
import { ConversationSubmission, OutputProtocolError, reasoningEffortFor, submissionTool, submittedReply, repairLimitMs } from './conversation-protocol.mjs'
import { ItinerarySubmission, itinerarySubmissionTool, submittedItinerary } from './itinerary-protocol.mjs'

export class DshAgent {
  constructor({ role, workspace, sessionId, placeLedgerFile, model = process.env.FLIGHTOR_DSH_MODEL || 'deepseek-flash', provider = process.env.FLIGHTOR_DSH_PROVIDER || 'deepseek-account', onEvent = () => {} }) {
    Object.assign(this, { role, workspace, sessionId, placeLedgerFile, model, provider, onEvent })
    this.reasoningEffort = reasoningEffortFor(role)
    this.events = []
    this.stderr = ''
  }
  async start(persona) {
    const { JsonRpcLineTransport } = await import(pathToFileURL(path.join(runtime, 'node_modules/@deepseek-ai/dsh-sdk-protocol/lib/index.js')))
    await fs.mkdir(this.workspace, { recursive: true })
    if (this.role === 'conversation') {
      this.submissionFile = path.join(this.workspace, 'conversation-submission.json')
      this.submission = new ConversationSubmission(this.submissionFile)
      this.submission.reset()
    }
    if (this.role === 'reviewer') {
      this.itinerarySubmissionFile = path.join(this.workspace, 'itinerary-submission.json')
      this.itinerarySubmission = new ItinerarySubmission(this.itinerarySubmissionFile)
      this.itinerarySubmission.reset()
    }
    const audit = path.join(dataRoot, 'audits', this.sessionId + '.json')
    const snapshot = JSON.parse(await fs.readFile(path.join(runtime, 'manifest.json'), 'utf8'))
    const desktopResources = path.dirname(snapshot.source)
    this.child = spawn(nodeBin, [dshBin, '--profile', 'flightor', '--patch', path.join(backend, 'dsh/flightor.patch.yml')], {
      cwd: this.workspace, windowsHide: true,
      env: { ...process.env,
        DSH_BUNDLED_PRIMARY_RUNTIME: process.env.DSH_BUNDLED_PRIMARY_RUNTIME || path.join(desktopResources, 'runtime/primary-runtime'),
        DSH_BUNDLED_OFFICE_SKILLS: process.env.DSH_BUNDLED_OFFICE_SKILLS || path.join(desktopResources, 'runtime/office-skills'),
        DSH_BUNDLED_OFFICE_CLI: process.env.DSH_BUNDLED_OFFICE_CLI || path.join(desktopResources, 'runtime/bin/office'),
        DSH_HOME: dshHome, FLIGHTOR_DSH_CREDENTIALS: path.join(userDshHome, '.credentials.yaml'), FLIGHTOR_DSH_PERSONA: persona, FLIGHTOR_DSH_ROLE: this.role, FLIGHTOR_DSH_AUDIT: audit,
        FLIGHTOR_DSH_PLACE_LEDGER: this.role === 'reviewer' ? this.placeLedgerFile || '' : '',
        FLIGHTOR_DSH_SUBMISSION: this.submissionFile || '',
        FLIGHTOR_DSH_ITINERARY_SUBMISSION: this.itinerarySubmissionFile || '' }
    })
    this.child.stderr.on('data', bytes => { this.stderr = (this.stderr + bytes.toString()).slice(-8000) })
    this.child.on('error', error => { this.spawnError = error })
    this.rpc = new JsonRpcLineTransport(this.child.stdout, this.child.stdin)
    this.rpc.onNotification((method, params) => {
      if (method === 'session.event' && params.sessionId === this.sessionId) {
        this.events.push(params.event)
        this.protocolObserver?.(params.event)
        this.onEvent(this.role, params.event)
      }
    })
    this.rpc.start()
    try {
      const parameters = this.initializationParameters()
      this.server = await this.rpc.request('initialize', parameters, AbortSignal.timeout(60000))
      await fs.mkdir(path.dirname(audit), { recursive: true })
      await fs.writeFile(audit.replace(/\.json$/, '.initialize.json'), JSON.stringify({ sessionId: this.sessionId, role: this.role, parameters, initializedAt: new Date().toISOString() }, null, 2))
    } catch (error) {
      const detail = this.stderr
      await this.close()
      throw Error(`DSH ${this.role} initialization failed: ${error.message}\n${detail}`)
    }
    return this.server
  }
  initializationParameters() {
    return { cwd: this.workspace, provider: this.provider, model: this.model, reasoningEffort: this.reasoningEffort }
  }
  async run(prompt, signal = AbortSignal.timeout(360000)) {
    if (this.role === 'conversation') return this.runConversationReply(prompt, signal)
    if (this.role === 'reviewer') return this.runReviewerReply(prompt, signal)
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
  async runConversationReply(prompt, signal) {
    const delivered = await this.runStructuredSubmission(prompt, signal, {
      submission: this.submission,
      toolName: submissionTool,
      extract: submittedReply,
      missingMessage: '缺少 submit_conversation_reply 成功提交；assistant正文不能交付结果',
      repairPrompt: `交付校验失败：缺少 ${submissionTool} 的成功结果。现在仅有一次补正机会，30秒内调用该工具，显式提供非空 reply 和 intent(chat或plan)。只提交刚才的结果，不查票、不搜索、不规划、不调用其他工具。`
    })
    return { submission: delivered.value, protocol: delivered.protocol, events: delivered.events }
  }
  async runReviewerReply(prompt, signal) {
    const delivered = await this.runStructuredSubmission(prompt, signal, {
      submission: this.itinerarySubmission,
      toolName: itinerarySubmissionTool,
      extract: submittedItinerary,
      missingMessage: '缺少 submit_itinerary 成功提交；最终assistant正文不能交付行程',
      repairPrompt: `交付校验失败：缺少 ${itinerarySubmissionTool} 的成功结果。现在仅有一次补正机会，30秒内调用该工具并提交 itinerary 对象。只补交刚才已经整理的结果，不重新查询景点、搜索、查票或调用其他工具。`
    })
    return { itinerary: delivered.value, protocol: delivered.protocol, events: delivered.events }
  }
  async runStructuredSubmission(prompt, signal, { submission, toolName, extract, missingMessage, repairPrompt }) {
    if (!submission) throw Error(`DSH ${this.role} submission state is not initialized`)
    signal.throwIfAborted()
    const first = this.events.length
    const state = submission.reset()
    const controller = new AbortController()
    const boundedSignal = AbortSignal.any([signal, controller.signal])
    let timer
    const monitor = event => {
      if (event?.type === 'tool/result' && event.data.message?.isError) {
        const id = event.data.message.toolCallId
        const call = this.events.slice(first).find(item => item.type === 'tool/call' && item.data.callId === id && item.data.name === toolName)
        if (call) submission.nativeFailure(id, event.data.message.content?.filter(block => block.type === 'text').map(block => block.text).join('') || '提交参数无法读取')
      }
      const current = submission.read()
      if (current.failed) controller.abort(new OutputProtocolError(current.errors.at(-1), submission.metrics()))
      if (current.repairStartedAt !== null && !timer) {
        timer = setTimeout(() => controller.abort(new OutputProtocolError('补正超过30秒', submission.metrics())), Math.max(0, repairLimitMs - (Date.now() - current.repairStartedAt)))
      }
    }
    this.protocolObserver = monitor
    const cancel = () => submission.close()
    signal.addEventListener('abort', cancel, { once: true })
    const executeTurn = async text => {
      boundedSignal.throwIfAborted()
      await this.rpc.request('session/prompt', { sessionId: this.sessionId, contentBlocks: [{ type: 'text', text }] }, boundedSignal)
      await this.rpc.request('session/wait', { sessionId: this.sessionId }, boundedSignal)
      boundedSignal.throwIfAborted()
      const end = this.events.slice(first).findLast(event => event.type === 'turn/end')
      if (end?.data?.reason?.kind !== 'completed') throw Error(`DSH ${this.role} did not complete: ${JSON.stringify(end?.data?.reason)}`)
    }
    try {
      await executeTurn(prompt)
      monitor()
      let answer = extract(this.events.slice(first), state.requestId)
      if (!answer) {
        const current = submission.read()
        if (current.repairStartedAt !== null) throw new OutputProtocolError('唯一补正机会后仍无成功提交', submission.metrics())
        submission.repair(missingMessage)
        monitor()
        await executeTurn(repairPrompt)
        answer = extract(this.events.slice(first), state.requestId)
      }
      boundedSignal.throwIfAborted()
      if (!answer) throw new OutputProtocolError('补正后仍无成功提交', submission.metrics())
      return { value: answer, protocol: submission.metrics(), events: this.events.slice(first) }
    } catch (error) {
      signal.throwIfAborted()
      if (controller.signal.aborted) throw controller.signal.reason
      if (submission.read().repairStartedAt !== null && error.code !== 'OUTPUT_PROTOCOL_ERROR') throw new OutputProtocolError(`补正执行未完成：${error.message}`, submission.metrics())
      if (error.code === 'OUTPUT_PROTOCOL_ERROR') error.protocolMetrics ||= submission.metrics()
      throw error
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      this.protocolObserver = undefined
      submission.close()
    }
  }
  async close() {
    this.submission?.close()
    this.itinerarySubmission?.close()
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
