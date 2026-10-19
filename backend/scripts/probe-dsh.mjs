import path from 'node:path'
import crypto from 'node:crypto'
import { DshAgent } from '../src/dsh.mjs'
import { dataRoot } from '../src/paths.mjs'
const id = 'probe-' + crypto.randomUUID()
const agent = new DshAgent({ role: 'probe', sessionId: id, workspace: path.join(dataRoot, 'workspaces', id) })
try {
  console.log(JSON.stringify({ phase: 'handshake', server: await agent.start('你是 FlightOR 的接入探针。只执行用户指定的最小验证，不修改文件。') }))
  if (process.argv.includes('--live')) {
    const result = await agent.run('请只回答 DSH_CONNECTED，不调用工具。')
    console.log(JSON.stringify({ phase: 'model', text: result.text, eventTypes: [...new Set(result.events.map(e => e.type))] }))
  }
} finally { await agent.close() }
