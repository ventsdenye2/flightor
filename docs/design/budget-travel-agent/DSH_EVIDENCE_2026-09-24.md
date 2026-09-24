# DSH Web Evidence Adapter

状态：适配层、文件 Repository、Planner 及组合提交已接通。本说明只定义这一适配层，不表示真实联网已验收；真实结果由实施报告记录。

## 接口与归属

实现位于 `backend/src/agent/dsh/evidence.ts`，文件 Repository 位于 `backend/src/agent/dsh/evidence-file.ts`，测试分别位于相邻的 `evidence.test.ts` 与 `evidence-file.test.ts`。`DshEvidenceStore` 在构造时绑定 owner、Trip、conversation、generation 和 Trip context version。模型候选只携带不透明 `evidenceRefs`；它不能提交 URL、source authority 或 verification。Store 从父进程收到的 DSH canonical tool result 建记录，Repository 接口提供异步 `put`/`get`。

`FileDshEvidenceRepository` 只接受父进程传入的绝对可信 root。文件名只允许规范 UUID 或小写 64 位 SHA-256；SHA 引用还必须与 record identity digest 一致。单条 envelope 上限 1 MiB，文件和临时/锁文件请求权限为 `0600`，新目录请求权限为 `0700`。写入用独占 lock、同目录随机临时文件、flush 和 atomic rename；同引用同摘要可幂等重试，不同内容拒绝，损坏 JSON/schema/digest 抛错而不覆盖。异常退出残留 lock 会让后续写入显式失败，需要运维核实后处理，不自动抢锁。

`recordSearch(result, provider, toolCallId)` 接收 `sources: [{url, title?, snippet?, publishedAt?}]` 与 `truncated`。`recordFetch(requestUrl, result, provider, toolCallId)` 接收 `{url, statusCode, body: {kind: 'text' | 'html', content}, truncated}`。两者返回 `{evidenceRefs, urls}`，其中 URL 仅列出可作为研究来源的材料；原始错误/无效材料仍保存在 Repository 诊断记录中，但不会返回引用。Fetch 只接受 HTTP 2xx、有正文且没有工具错误的结果。Search 必须有来源 URL 和 snippet 且没有工具错误。截断材料若已有正文或 snippet 可以引用，记录 `truncated: true` 并在 Research warning 标记，不因此升级 verification。

记录保留 provider、toolCallId、获取时间、原始/最终 URL、标题、snippet/body、内容 hash、深度、状态码、截断与 `untrusted: true`。转换时再次按完整 Store scope 读取引用；跨 owner、Trip、conversation、generation 或 context version 均不可见。跨轮复用应通过已有 ResearchArtifact 流程，不直接重用本轮 evidenceRef。

父进程以本轮起始 Trip version 接受回执。只有本轮成功的 `update_trip_context` 才能前进 Store version；外部并发变更时拒绝迟到回执，不把旧搜索重新绑定到新版本。官方搜索固定 provider ID `deepseek-official`，默认 base URL 为 `https://api.deepseek.com/anthropic/v1`，由官方包追加 `/messages`；不回退到 SerpApi。`web_fetch` 复用既有安全正文读取器，无独立研究综合。

新增本地 HTTP 适配器测试实际装载 `llm-pi-ai` 与 `web-search-deepseek`，验证 `/v1/chat/completions`、`/anthropic/v1/messages`、来源引文及请求前计量；2 次模型加 1 次搜索全部在 localhost，费用 0。它证明适配器组合正确，不证明远端 Key/权限或搜索已成功。

## Research 转换

`convertCandidatesToResearch({candidates, brief, artifactId}, store)` 只按已保存引用读取来源，使用调用方已解析且必须匹配 ResearchBrief destinations 的可信 LocationRef。候选 summary 作为领域 finding 摘要保留，绝不会写进 source snippet/body。source authority 由现有 hostname classifier 派生，verification 固定为 `partially_verified`；工具成功、官方域名、读到正文或摘要本身都不能让它变成 `verified`。所有网页材料保留不可信警告，来源缺失、引用伪造或地点不匹配则拒绝转换。

该边界沿用 [Research schema](../../../backend/src/research-agent/types.ts)、[claim evidence](../../../backend/src/research-agent/claim-evidence.ts) 和 [source reader](../../../backend/src/research-agent/source-reader.ts)。EvidenceStore 只登记实际工具回执，不执行任意 URL 请求，也不替代现有 SSRF、来源适用性、ClaimEvidence 或攻略领域校验。

## 验证范围

本轮 focused Vitest：`src/agent/dsh/evidence.test.ts` 6/6、`src/agent/dsh/evidence-file.test.ts` 3/3 通过；文件测试覆盖跨实例重开、POSIX mode、scope 过滤、相同引用幂等/冲突、路径遍历和损坏 JSON。backend TypeScript 检查通过。真实 DSH Provider、持久 Repository 的并发跨主机语义和完整提交路径不在本说明的验证声明内。

## D4 实测回执缺陷与离线回归

首轮 A 的真实主模型与官方搜索能够返回，但攻略未发布：`tools/post-execute` 回调误取 `exec.args`，官方公开 `ToolExecutionContext` 字段实际为 `exec.arguments`，因此传给父进程 `__record_web` 的 strict 参数缺少 `args`，回执不能登记。真实联网返回不代表来源已经持久化，也不能据此宣布攻略 accepted。主任务已将该字段改为 `exec.arguments`；真实调用计量和剩余额度以本轮费用账本及实施报告为准，本测试不发起补偿性真实重试。

新增 `backend/src/agent/dsh/web.test.ts` 通过真正 `DshSessionManager` 子进程、官方 fixture AgentLoop、官方 web/tool-web 插件、父进程 `executeDshWeb`、真实安全正文读取器和 `FileDshEvidenceRepository` 贯通回归。只有 SerpApi 原始结果、DNS 和 HTTP 传输使用本地注入 fixture，无外部网络、模型或搜索费用。它逐个断言 IPC 调用顺序和每份 `__record_web` 的公开工具参数：search 的 `queries`、fetch 的 `url` 均完整保留；来源只有 URL/title 没有 snippet 时返回空 evidenceRefs/urls，仅持久化 `no_body` 诊断；随后正文读取成功产生引用，跨 Repository/Store 实例重读恢复完整 owner/Trip/conversation/generation/version、原始 URL、正文 hash、provider、toolCallId 与 untrusted 标记。此测试会让旧的缺失 args 回执链路失败，不能用固定的伪造 evidenceRef mock 绕过父进程 schema。

2026-09-24 执行 `npm test -- src/agent/dsh/web.test.ts src/agent/dsh/evidence.test.ts src/agent/dsh/evidence-file.test.ts`：3文件10项通过，3.56秒；新增完整链路测试805ms。仅证明该回执修复的离线链路，不替代再次真实 A/B 验收，不将 SerpApi fixture 结果报告成官方联网成功。
