// Publish lifecycle summaries only; model reasoning and tool payloads stay private.
export function progressFromEvent(role, event) {
  const name = role === 'reviewer' ? '行程整理助手' : role === 'planner' ? '规划助手' : 'DeepSeek'
  const activity = {
    'turn/start': '已收到消息',
    'step/start': '正在处理你的消息',
    'tool/call': '正在调用工具查询资料',
    'tool/result': '已收到工具结果，继续整理',
    'llm/retry-started': '正在重新连接模型',
    'llm/retry': '正在重试模型请求',
    'compaction/start': '正在整理对话上下文',
    'compaction/end': '上下文已整理，继续处理',
    'assistant/message': '回复已生成，正在保存'
  }[event?.type]
  return activity ? { text: `${name} · ${activity}`, role, updatedAt: new Date().toISOString() } : null
}
export function updateProgress(run, role, event) {
  if (['completed', 'failed', 'cancelled'].includes(run.stage)) return
  const progress = progressFromEvent(role, event)
  if (progress) run.progress = progress
}
