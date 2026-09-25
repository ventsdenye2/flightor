# DSH Web Evidence Adapter

同批worker收尾修正：一次Windows回归在异常IPC关闭后立即删除测试目录报EBUSY，定位为manager只发送kill便释放目录锁。现在dispose和open失败清理等待真实子进程close事件后完成，避免尚存文件句柄/写入与下一manager竞争；不更改取消代次栅栏或Agent Loop。

2026-09-25调用观测修正：worker只在预算准入成功、实际进入模型adapter前递增`calls`；触及每轮12次限制的第13次拒绝不计为已调用，预算拒绝也不计。原始账本不变，不重写旧回执；第三次最小commit probe的旧worker结果`calls=13`包含一次被拦截尝试，真实已准入主模型为12次。回归使用真正fixture worker验证12次工具/回执与预算拒绝零模型分派。

状态：适配层、文件 Repository、Planner 及组合提交已接通。本说明只定义这一适配层，不表示真实联网已验收；真实结果由实施报告记录。

## 接口与归属

实现位于 `backend/src/agent/dsh/evidence.ts`，文件 Repository 位于 `backend/src/agent/dsh/evidence-file.ts`，测试分别位于相邻的 `evidence.test.ts` 与 `evidence-file.test.ts`。`DshEvidenceStore` 在构造时绑定 owner、Trip、conversation、generation 和 Trip context version。模型候选只携带不透明 `evidenceRefs`；它不能提交 URL、source authority 或 verification。Store 从父进程收到的 DSH canonical tool result 建记录，Repository 接口提供异步 `put`/`get`。

`FileDshEvidenceRepository` 只接受父进程传入的绝对可信 root。文件名只允许规范 UUID 或小写 64 位 SHA-256；SHA 引用还必须与 record identity digest 一致。单条 envelope 上限 1 MiB，文件和临时/锁文件请求权限为 `0600`，新目录请求权限为 `0700`。写入用独占 lock、同目录随机临时文件、flush 和 atomic rename；同引用同摘要可幂等重试，不同内容拒绝，损坏 JSON/schema/digest 抛错而不覆盖。异常退出残留 lock 会让后续写入显式失败，需要运维核实后处理，不自动抢锁。

`recordSearch(result, provider, toolCallId)` 接收 `sources: [{url, title?, snippet?, publishedAt?}]` 与 `truncated`。`recordFetch(requestUrl, result, provider, toolCallId)` 接收 `{url, statusCode, body: {kind: 'text' | 'html', content}, truncated}`。两者返回 `{evidenceRefs, urls}`，其中 URL 仅列出可作为研究来源的材料；原始错误/无效材料仍保存在 Repository 诊断记录中，但不会返回引用。Fetch 只接受 HTTP 2xx、有正文且没有工具错误的结果。Search 必须有来源 URL 和 snippet 且没有工具错误。截断材料若已有正文或 snippet 可以引用，记录 `truncated: true` 并在 Research warning 标记，不因此升级 verification。

记录保留 provider、toolCallId、获取时间、原始/最终 URL、标题、snippet/body、内容 hash、深度、状态码、截断与 `untrusted: true`。转换时再次按完整 Store scope 读取引用；跨 owner、Trip、conversation、generation 或 context version 均不可见。跨轮复用应通过已有 ResearchArtifact 流程，不直接重用本轮 evidenceRef。

父进程以本轮起始 Trip version 接受回执。只有本轮成功的 `update_trip_context` 才能前进 Store version；外部并发变更时拒绝迟到回执，不把旧搜索重新绑定到新版本。官方搜索固定 provider ID `deepseek-official`，默认 base URL 为 `https://api.deepseek.com/anthropic/v1`，由官方包追加 `/messages`；不回退到 SerpApi。`web_fetch` 复用既有安全正文读取器，无独立研究综合。

新增本地 HTTP 适配器测试实际装载 `llm-pi-ai` 与 `web-search-deepseek`，验证 `/v1/chat/completions`、`/anthropic/v1/messages`、来源引文及请求前计量；2 次模型加 1 次搜索全部在 localhost，费用 0。它证明适配器组合正确，不证明远端 Key/权限或搜索已成功。

## 搜索参数与挑战页边界（2026-09-25）

真实execution `ac5923dc-befd-492c-8cfc-52972b4908af` 的第一笔双query被官方工具拒绝，但原middleware已先准入搜索预算。该版本官方工具仅在description说明1–1个query，未把配置上限写入JSON Schema。FlightOR现通过官方公开`system-prompt/assemble`为模型可见web_search schema增加`minItems:1/maxItems:1`，并通过`tools/pre-execute`拒绝非单个非空字符串query，先于`tools/execute`计费准入。官方搜索工具执行体未替换，未修改依赖包或Agent Loop；历史错误准入记录和预留仍保留，不追溯删除或冲销。修复只防止未来不可能执行的搜索占用次数，不豁免实际Provider失败。

同次执行11个正文请求分别为4次403、3次超时、2次正文超限、2次HTTP200但空正文。两个超限URL是`https://tw.trip.com/moments/detail/tokyo-294-141982654/`及`https://tw.trip.com/moments/detail/tokyo-294-134649209/`；仅确认超过262,144字节，未保留精确总大小，不因此放大256KiB限制。8次实际官方搜索只有URL/title没有snippet，均不能产出可用引用；本轮未调用commit，最终预算准入被拒绝。

随后5次免费、只读、受既有DNS pinning/SSRF/超时/大小限制的HTTPS诊断确认：`www.kotsu.metro.tokyo.jp/subway/fare/otoku_limited.html`与`otoku_skyliner_visit.html`分别返回957/844字节、identity编码、200、无title的小HTML，直接reader提取82字的`Request unsuccessful. Incapsula incident ID: …`反爬文本；不是旅游正文。JNTO对照`https://www.japan-travel.cn/spot/1696/`返回22,627字节HTML并正常提取898字正文。此次诊断不调用模型/搜索，没有破解或绕过站点挑战。

`PublicResearchSourceReader.read`新增默认关闭的`rejectChallengePage`选项，只有DSH fetch明确启用；legacy读源行为保持原样。检测限提取文本不超过1,000字符的明确挑战壳：完整Incapsula失败/incident格式或专用iframe路径、同时有Just a moment标题与Cloudflare挑战路径/配置标记、或特定人机验证标题+challenge-form+reCAPTCHA/hCaptcha widget/sitekey组合。普通正文提到CAPTCHA不被拒绝。这不是通用内容真实性分类器，未列出的挑战仍可能漏检；未放宽DNS、HTTPS、重定向、压缩、内容类型、正文大小及超时边界。命中时返回有界`SOURCE_CHALLENGE_REJECTED`，不泄漏incident详情、不返回正文或可用引用，主Agent只能换已有检索来源。

离线验证：backend `npm test -- src/agent/dsh/web.test.ts src/agent/dsh/evidence.test.ts src/agent/dsh/evidence-file.test.ts src/research-agent/source-reader.test.ts`，4文件29项通过，5.36秒；5种HTTP200挑战壳经过真实reader/DSH fetch/record均零可用引用，普通CAPTCHA说明文章可用，legacy opt-out保持。`dsh-runtime/npm test` 6/6通过，2.447秒；真实官方AgentLoop验证双query、空数组、空白query、非字符串query均零search admission/零provider请求，随后合法query正常获得1份准入/回执；localhost官方适配器请求核验实际送出的min/maxItems。首次runtime测试5/6是新fixture漏写canonical结果必须的truncated字段，补齐fixture后通过，未放宽生产断言。全部离线fixture/localhost，模型搜索费用0，不替代真实重试。

## Research 转换

`convertCandidatesToResearch({candidates, brief, artifactId}, store)` 只按已保存引用读取来源，使用调用方已解析且必须匹配 ResearchBrief destinations 的可信 LocationRef。候选 summary 作为领域 finding 摘要保留，绝不会写进 source snippet/body。source authority 由现有 hostname classifier 派生，verification 固定为 `partially_verified`；工具成功、官方域名、读到正文或摘要本身都不能让它变成 `verified`。所有网页材料保留不可信警告，来源缺失、引用伪造或地点不匹配则拒绝转换。

该边界沿用 [Research schema](../../../backend/src/research-agent/types.ts)、[claim evidence](../../../backend/src/research-agent/claim-evidence.ts) 和 [source reader](../../../backend/src/research-agent/source-reader.ts)。EvidenceStore 只登记实际工具回执，不执行任意 URL 请求，也不替代现有 SSRF、来源适用性、ClaimEvidence 或攻略领域校验。

组合提交对不可用的原始引用先返回有界`candidate_evidence_unavailable`修复详情，不再让跨轮旧引用仅显示通用工具失败。详情只回显调用方提交的candidateKey和不可用evidenceRefs，不包含记录所属scope；完整scope读取隔离保持不变。处理方法是使用当前支持材料或已有ResearchArtifact的candidateRef，服务端不自动提升旧原始引用。真实失败原因及4文件25项离线验证见[组合发布说明](DSH_PUBLICATION_2026-09-24.md)。

## 验证范围

本轮 focused Vitest：`src/agent/dsh/evidence.test.ts` 6/6、`src/agent/dsh/evidence-file.test.ts` 3/3 通过；文件测试覆盖跨实例重开、POSIX mode、scope 过滤、相同引用幂等/冲突、路径遍历和损坏 JSON。backend TypeScript 检查通过。真实 DSH Provider、持久 Repository 的并发跨主机语义和完整提交路径不在本说明的验证声明内。

## D4 实测回执缺陷与离线回归

首轮 A 的真实主模型与官方搜索能够返回，但攻略未发布：`tools/post-execute` 回调误取 `exec.args`，官方公开 `ToolExecutionContext` 字段实际为 `exec.arguments`，因此传给父进程 `__record_web` 的 strict 参数缺少 `args`，回执不能登记。真实联网返回不代表来源已经持久化，也不能据此宣布攻略 accepted。主任务已将该字段改为 `exec.arguments`；真实调用计量和剩余额度以本轮费用账本及实施报告为准，本测试不发起补偿性真实重试。

新增 `backend/src/agent/dsh/web.test.ts` 通过真正 `DshSessionManager` 子进程、官方 fixture AgentLoop、官方 web/tool-web 插件、父进程 `executeDshWeb`、真实安全正文读取器和 `FileDshEvidenceRepository` 贯通回归。只有 SerpApi 原始结果、DNS 和 HTTP 传输使用本地注入 fixture，无外部网络、模型或搜索费用。它逐个断言 IPC 调用顺序和每份 `__record_web` 的公开工具参数：search 的 `queries`、fetch 的 `url` 均完整保留；来源只有 URL/title 没有 snippet 时返回空 evidenceRefs/urls，仅持久化 `no_body` 诊断；随后正文读取成功产生引用，跨 Repository/Store 实例重读恢复完整 owner/Trip/conversation/generation/version、原始 URL、正文 hash、provider、toolCallId 与 untrusted 标记。此测试会让旧的缺失 args 回执链路失败，不能用固定的伪造 evidenceRef mock 绕过父进程 schema。

2026-09-24 执行 `npm test -- src/agent/dsh/web.test.ts src/agent/dsh/evidence.test.ts src/agent/dsh/evidence-file.test.ts`：3文件10项通过，3.56秒；新增完整链路测试805ms。仅证明该回执修复的离线链路，不替代再次真实 A/B 验收，不将 SerpApi fixture 结果报告成官方联网成功。

### 正文读取失败的有界错误桥接（2026-09-25）

真实execution `9052d200-0b3c-4eba-bef7-f6ed26c590bd` 中一次GO TOKYO正文HTTP200并生成引用，但三个其他页面读取失败，模型只得到`Cannot read properties of undefined (reading 'kind')`。只读检查安全tool/result确认：父进程安全读取器抛错后，manager把拒绝包装为通用`{error:...}`并resolve；FlightOR注册的fetchProvider将其当作正文结果返回，官方tool-web访问body.kind时再次抛错，遮蔽原始失败。本执行没有调用commit，不能用它评判exact-cover修复是否通过；官方搜索body terminated与随后主模型TRANSPORT错误由真实执行报告单列，不归因于本修复。

修复只在FlightOR边界：`executeDshWeb`把已知安全读取错误name映射为有限`SOURCE_*` code及固定hint，未知provider异常统一`SOURCE_FETCH_FAILED`，不传原message/stack。FlightOR的fetchProvider收到该envelope后抛官方公开`WebError`，因此模型可见正确有限错误code与“使用其他已检索来源，本次失败没有证据”的提示；manager既有错误fallback也变为同样可解释的失败。没有修改/分叉DSH包或Agent Loop，不绕过SSRF/正文围栏，也没有自动重试。HTTP非2xx继续以真实status和空body返回，引用为空；已取消signal继续抛取消，不转成可重试的来源失败。

离线验证：`npm test -- src/agent/dsh/web.test.ts src/agent/dsh/evidence.test.ts src/agent/dsh/evidence-file.test.ts`，3文件13项通过，4.67秒。新用例通过真官方fixture worker重现timeout和未知provider错误，检查持久tool/result为WebError及正确code、没有kind错误和注入的敏感message，并确认失败没有`__record_web`；另验HTTP403空引用和取消。首次测试读取session日志过早，增加正常manager.close等待持久flush后通过，未改生产持久行为。`dsh-runtime/npm test` 5/5通过，2.933秒，均本地fixture或localhost HTTP，无真实费用。本修复不声称失败页面已变可用或真实commit重试通过。
