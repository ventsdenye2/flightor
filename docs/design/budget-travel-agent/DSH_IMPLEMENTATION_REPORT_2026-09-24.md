# DSH 后端实施记录

状态：D0–D3后端实现与离线/数据库回归完成。D4原始A/B首轮均失败；之后基于新追加授权的模型与官方搜索探针通过，但4次正式commit探针仍没有accepted攻略，**D4仍未通过**。H5仅完成真实只读prepare，无真实浏览器发送或accepted结果。未部署、未关闭G1。用户2026-09-24明确优先DSH，取代旧R/U与条件C1前置；范围见[原附件方案](DSH_IMPLEMENTATION_PLAN_2026-09-24.md)。

2026-09-25 09:58：新增US$2/32模型/8搜索授权已审计追加原账本，累计上限US$7/128模型/32搜索。第四probe因无有效正文持续研究，累计32搜索上限触发，保守占用US$6.20、余US$0.80；主模型10次、搜索准入9次（实际官方HTTP8次）、fetch11次，75.156秒，无commit。免费HTTP诊断确认200拦截页及可用JNTO对照，下一probe范围与旧失败Goal隔离；详细标识、失败分布及仍未通过边界见[D4 checkpoint](DSH_LIVE_2026-09-24.md)。修复后合并离线160项、独立PostgreSQL1项、build通过，前端源码diff为0。worker计数不再包含被拒绝的第13尝试，关闭等待子进程真实退出后释放目录锁。

基线 `origin/main@8a83b032a8ee18097af62304d99df86f9a543489`，已 fetch。隔离工作树 `.worktrees/dsh-backend`，分支 `codex/dsh-backend`。原 main 的 `output/` 未跟踪内容保留；不合并或部署。

## D0

2026-09-24 19:49（Asia/Shanghai）开始独立 runtime 实施。核验官方固定提交 `46a7f68b0922371ce7144b668b90e377d8e799f4`；npm 的 DSH 核心实际发布 `0.1.7-rc.1`，Cordis `4.0.4`；本机 Node `22.21.0`。独立 package/lock 不改变前端依赖。

显式组合核心插件；不加载 sdk/sdk-minimal、用户 profile、shell、文件工具、Git、PTC、subagent、插件安装、session-log 或 inventory 上传。Session JSONL 是内部持久化，不是模型工具。插件和工具执行白名单由代码强制。

D0 当时未进行付费调用、费用 0，未取得本批额度。后续用户已配置官方 DeepSeek 模型/搜索 Key，并明确授权本批 US$2、48 次模型调用、12 次搜索请求（含失败），达到任一上限停止；历史额度未复用。

D0 20:03 核心与独立 worker 两项测试通过（Node test 0.751s）：真正 AgentLoop 工具、followup、cancel、JSONL resume；worker private IPC、结果相关 ID 和模型调用数。最初两次分别暴露消息 id/source 缺失，已使用 createUserMessage 与 flightor-context 来源修正。无网络模型调用。

## D1

20:04 至 20:17：抽出四方法 `PlannerServicePort` 与共享 `PlannerDomainService`，配置先选择引擎再检查对应凭证。D1 提交 `b12e809aa3fd483f36be670bc16953cb059815af`；D0 提交 `6fbd5c7e6b8b4b5f596d98edcbb8a5369500ae98`。4 文件16项定向服务/API/配置测试通过（8.66s），DSH 真实 worker 的只读多轮中旧 `CloudPlannerService.runTurn`、`AgentRuntime.run` 和首次 Finalizer 均未调用。

## D2 实现与验证

20:17 起接入官方 `web`/`tool-web`、原始 SerpApi provider 与独立显式 `web-search-deepseek`。当前本批选官方 DeepSeek：模型 `deepseek-v4-flash`，`https://api.deepseek.com/v1`；搜索同名模型，`https://api.deepseek.com/anthropic/v1/messages`。这是当前配置，远端成功须看 D4 实测。Key 不进入文档、数据库或提交。

来源自动记录原始 URL、标题、snippet/body、hash、时间、状态/截断和不透明 evidenceRef；本轮组合工具将材料转换为既有 ResearchArtifact，然后一起提交日程及当前语言 FinalText。复用领域验证/Goal completion/publication，默认首次无独立 synthesis/Finalizer。失败草稿不公开，不能由模型设置 accepted。具体合同见 [来源](DSH_EVIDENCE_2026-09-24.md)、[发布](DSH_PUBLICATION_2026-09-24.md)、[预算](DSH_BUDGET_2026-09-24.md)。

官方适配器本地 HTTP 测试 1/1（2.061s）验证实际 `llm-pi-ai` 与 `web-search-deepseek`、两次模型/一次搜索、请求前计量和来源回执。测试发现并修正搜索 provider ID 和缺少 `/v1` 的默认地址；未发送远端请求。集成发布/组合工具56项、证据9项、预算初版17项分别通过。后续全部结果列于最终验证。

## D3 实现与验证

D2 提交 `52116d6`，包含联网写入所需的计量 IPC、会话安全基础与对应单测；D3 单独提交取消 API 和新增多轮/数据库/前端回归证据。

与 D2 收尾交错执行，未伪造互不重叠的开发耗时。Session manager 持久 owner/Trip/conversation scope、profile 与 Memory epoch；warm followup、冷 resume、容量及空闲回收；退休旧会话后只注入当前数据库状态。Memory 关闭时不重新注入先前 assistant 的推断文字，只保留用户显式历史和当前受控领域上下文。

取消先隔离 generation 并停止 worker，再等待父进程实际工具 Promise 完成，API 确认后方可开始竞争回合。重复 IPC 返回缓存结果，不重写领域数据；工具名/参数严格验证；root lock 的获取/回收/释放均受独占 guard 保护。局部攻略修改按 slot 服务端合并并比较受保护活动。最终引用核对 Trip 与 flight revision。详见 [会话](DSH_SESSIONS_2026-09-24.md)。

会话15/15通过（20.05s），API/turn取消15/15通过（9s），先前超时的取消用例串行复验881ms；没有放宽超时。旧service6/6重跑通过（11.67s）。全量离线20:48:56开始、186.97s结束：115文件949项通过，新增多轮 fixture 1项失败（正在修复，不能声称全量通过）。真实数据库初跑37/39，两个陈旧 legacy Finalizer mock修正后定向2/2通过（12.90s）；原失败保留在[数据库报告](DSH_DATABASE_2026-09-24.md)。

21:02 定向收尾：新多轮 fixture 已修正为合法 ResearchArtifact（一致持久ID、完整verification），同时限制组合提交的公开引用为 flight_search/travel_guide，内部 route 不另发用户结果。实际 worker 执行发布→解释零新增攻略→冷 resume，两服务测试2/2通过（6.18s）。预算增加“任一正数调用上限达到后全部停止”断言，18/18通过（3.49s）；runtime全4项通过（2.207s），backend build通过。上述是失败修复后的定向证据，不改写此前全量失败记录。

前端仅运行回归，零源码/依赖改动：conversation progress、session recovery、artifacts、production presentation 共161明确计数项和2媒体断言组通过（17.585s）；范围见[前端回归](DSH_FRONTEND_REGRESSION_2026-09-24.md)，不代替H5/微信真实验收。

新增真实 PostgreSQL DSH 回归1/1通过（9.20s）：官方 fixture worker、真实 owner-scoped repos/JWT GET，完成保存→解释零写入→仅第二天下午替换→Trip总预算1200→冷恢复。两个Goal/Run满足、首次独立Finalizer/旧Runtime调用0，旧版本Artifact不可复用，GET blocked/stale投影不启动Agent。运行在独立随机schema，与D4固定schema分离，费用0。

## D4

独立live runner核对冻结双对话、D+30/D+31日期、固定schema与新预算后真实执行。A在96.542s首轮失败：来源桥接用了不存在的exec.args，修为官方exec.arguments并补完整文件证据链测试。B在67.582s首轮失败：已持久21份来源（3份正文可引用），但默认推理耗尽4096token；修为官方profile显式thinking disabled，并退休旧profile会话。本地HTTP断言修复通过，未重新执行真实双例。

两例后续解释/局部修改/预算变更以及英文localization均未运行，不能把离线/数据库多轮作为真实对话通过。没有攻略accepted，没有宣布事实已核实。实际主模型13次加官方搜索10次，共23/48模型额度，10/12搜索；未知费用保守预留US$1.72，实际账单金额unknown，余US$0.28，原账本保留、无pending请求。详细双对话、各API/模型/搜索耗时见[D4记录](DSH_LIVE_2026-09-24.md)及[脱敏结果](DSH_LIVE_RESULTS_2026-09-24.json)。

## 交付运行面

固定DSH npm核心包均`0.1.7-rc.1`，Cordis`4.0.4`，zod`4.4.3`，完整传递依赖锁在backend/dsh-runtime/package-lock.json；验证Node22.21.0。显式插件白名单：`llm`、`session`、`session-projection`、`system-prompt`、`tools`（native）、`agent`、`session-persistence-jsonl`、`agent-loop`、`llm-pi-ai`、`web`、`tool-web`、`web-search-deepseek`（官方搜索路线）。SerpApi路线用FlightOR原始provider注册，不加载官方搜索插件。不加载完整sdk profile、shell/文件/Git/PTC/subagent、DSH Goal/Task/Todo、插件安装、session-log/inventory上传。

模型可见工具15个：`get_trip_context`、`get_trip_artifacts`、`read_artifact`、`resolve_location`、`get_user_memory`、`get_active_goal`、`update_trip_context`、`search_flights`、`search_flexible_flights`、`confirm_flight_price`、`update_user_memory`、`start_route_generation`、`commit_travel_guide`、`web_search`、`web_fetch`。7个内部web/计量桥接名称不对模型开放。白名单、单worker单活跃turn及禁止旧Planner/Runtime由代码和测试围栏验证。

| 阶段 | 开发/提交时点 | 可独立计量的验证耗时 |
| --- | --- | --- |
| D0 | 19:49–20:04:40，约15m40s | 最初核心2项0.751s；最终runtime4项1.937s |
| D1 | 20:04:40–20:17:14，12m34s | API/service/config16项8.66s |
| D2 | 20:17:14–21:05:50，48m36s，包含交错D3开发 | 组合发布56项4.57s；预算最终18项3.49s |
| D3 | 与D2交错；21:07:33独立提交c04acea，不把1m43s提交间隔当完整开发耗时 | session15项20.05s；取消15项9s；DSH PG1项9.20s；前端17.585s |
| D4 | 21:07后真实测试、诊断修复和交接 | A96.542s、B67.582s；最终全部DB40项42.39s；最终离线结果见下 |

前端证明：与基线比较`git diff origin/main -- src package.json package-lock.json`为空；本批全部产品改动在backend，公开API schema未更改。原main及各既存worktree保留，没有强推、合并或部署。

## 未解决项与回滚

最小剩余事项是：为已修正适配器后的完整双多轮安排明确预算，并保留本批失败和账本；当前US$0.28余额不能按原规模重做两例。官方凭证现可用，无需另补Key。首次完整真实攻略/解释/局部修改/预算变更/英文localization仍待复验，H5/微信本轮未验证成功样本。地图底图原问题继续暂停，不能声明整个G1通过。

运行限制：私有文件持久存储仅单主机/单API实例；无分布式租约；进程中断后的临时HTTP turn不自动重放，后续显式用户回合可冷resume持久上下文。Trip budget更新使旧材料过期，不能任意跨版本复用；这不是自动预算可行性证明。未知费用按预留计入，本批没有可靠供应商货币回执。

启动：backend/dsh-runtime内`npm ci --ignore-scripts`，backend内`npm run build`，配置`FLIGHTOR_AGENT_ENGINE=dsh`及所选路由Key、持久数据目录、当前明确预算后启动后端；本地操作命令见[部署](../../deploy.md)与D4记录。回滚：设`FLIGHTOR_AGENT_ENGINE=legacy`并重启后端，保留数据库、.dsh-data及预算/失败记录；不需要改前端或执行数据回滚。关闭验证runner用SIGINT/SIGTERM；独立数据库的精确停止方式见[数据库报告](DSH_DATABASE_2026-09-24.md)。

## 最终离线验证

2026-09-24 21:43:38 起，在 `codex/dsh-backend` 工作树运行（HEAD `c04acea5f1305dac9e4e692be59eafb1f0702cd4`，包含本轮已修复而尚未提交的增量）。按要求顺序执行一次全量离线测试和一次构建，未重复全量。

| 命令 | 实际结果 | 耗时 |
| --- | --- | --- |
| `cd backend; npm test -- --maxWorkers=2` | **117 文件、952 项全部通过**；退出码 0，无失败 | Vitest 116.90 秒；含 npm 启动的外层墙钟 119.642 秒 |
| `cd backend; npm run build` | TypeScript 编译通过；退出码 0 | 外层墙钟 11.925 秒 |

完整 stdout/stderr 留在忽略目录 `backend/.demo/dsh-final-offline-20260924/tests.log` 和 `build.log`；同目录 `tests.result.json`、`build.result.json` 保留命令、退出码及精确毫秒。此次结果覆盖此前失败修复后的实际全量状态；保留前文 949/1 失败记录，不用成功结果抹除历史。

默认 Vitest 配置明确排除真实 PostgreSQL suites，关闭真实模型/航空/搜索凭证，DSH 使用 fixture 或本地 HTTP 适配器；本次没有真实 Provider 请求、模型/搜索费用为 0。数据库集成证据按前文独立报告评价；build 不代表部署、H5/微信真实验收或整个 G1 通过。

## 显式本地化的 Provider 协议与计量补强

DSH 显式本地化采用独立 `createDshLocalizationClient`：官方 DeepSeek 直接发送 `thinking: { type: "disabled" }` 和 `response_format: { type: "json_object" }`，将既有输出 JSON schema 加入 system 约束，再由原 GuideFinalizer 执行结构、身份和语言校验。官方请求不发送 OpenRouter 的 `reasoning`、`provider` 路由或工具字段；OpenRouter 路线保留既有 `reasoning.enabled=false`、`json_schema` 和网关路由语义。首次攻略仍由主 Agent 输出，不增加 Finalizer 调用。

每次显式本地化及其唯一允许的格式/语言修复在 HTTP 前写入同一 FileDshBudget admission；达到当前预算或次数上限即阻止后续请求。完成后记录 token、finish reason、实际 model/maxTokens/thinking 配置；仅供应商真实货币回执可结算费用，缺失费用或失败均保留预留，不推算账单。已取消请求不申请预算或发出 HTTP。测试仅向随机端口的 127.0.0.1 HTTP fixture 发送请求，不调用真实供应商。

验证：2026-09-24 23:26，四个目标套件共 **81/81** 通过（localization HTTP 5、OpenRouter 15、Finalizer 43、budget 18），Vitest 4.18 秒；`npm run check` 通过（9.87 秒）。本地 HTTP 测试逐项核对官方出站 thinking/json_object、OpenRouter 兼容、token/finish reason 和已知费用入账、预算拒绝不出站、失败保留预留、预先取消零请求。没有真实费用。本轮是上述全量验证之后的增量定向验证，不将前述 952 项全量结果改写为本增量全量通过。

## 2026-09-24 正式 H5 闭环续验：调用前修复与准备

续验基线为 `765f3acf65faf5aa23f5c0029f123b02018aee59`。重新 fetch 后远端 DSH 分支一致，`origin/main=8a83b032a8ee18097af62304d99df86f9a543489`；独立 worktree 继续开发，主目录原有配置改动与 output 保留。

- `DSH_MODEL_MAX_TOKENS` 替代 composition 的硬编码，默认仍4096、范围256–16384；未执行任何真实升档。worker 回执保存 model/maxTokens/thinking/finishReason/输入输出token。`max-tokens` 单独记录为 `MODEL_OUTPUT_LIMIT`，不当作 Provider 故障；不会自动重试或放大。
- 独立 worker 的本地 HTTP 纵向测试实际检查 `/v1/chat/completions` body：`model=deepseek-v4-flash`、`max_tokens=4096`/测试覆盖8192、`thinking={type:disabled}`，无 OpenRouter reasoning 字段。正常 stop 与 length 两种响应均通过，后者保持 max-tokens 终止原因；测试只访问 loopback，不代表远端复验。
- 官方显式本地化与公开回复边界详见本报告前段和 [发布合同](DSH_PUBLICATION_2026-09-24.md)。未增加审核 LLM、独立研究或首次 Finalizer。
- 本批定向12文件144项通过（26.95s，随后新增回执恢复用例另跑19项budget+6项legacy共25项通过，3.88s）；DSH PostgreSQL单个多轮综合用例通过（8.19s）；backend类型/构建通过。正式H5源码无改动，原有H5构建通过（webpack25.45s，两项原有bundle大小警告）；Chrome已打开真实规划页并核对输入框。这些结果均不证明accepted UI闭环成功。

旧账本仍保留23次模型/10次搜索、US$1.72未知费用预留，当前剩余US$0.28；未修改授权或发起新的付费调用。正式H5验收状态必须在后续实际点击、真实Provider、accepted持久化及页面截图齐备后更新，不能由上述测试推断PASS。

2026-09-24 本轮新增授权已明确收到：在旧账本上追加US$3、48模型、12搜索，累计US$5/96模型/24搜索。`FileDshBudget.extendAuthorization`仅供显式管理调用，不在Agent工具或HTTP自动准入路径；记录grant ID、授权引用、前后限制和时间，保留batchId、全部旧entries及未知预留，拒绝重复grant、pending请求和旧配置继续写入。此授权追加后实测旧entries完全相同，仍23模型/10搜索/US$1.72未知预留，可用US$3.28。追加持久化回归20/20通过（1.76s），独立runtime5/5通过（2.62s）。这不是费用归零，也不代表实际计费为零。

## 2026-09-25 保留的后续真实探针

从独立工作树基线 `765f3acf65faf5aa23f5c0029f123b02018aee59` 的真实私有state与安全observer记录核对：model只读探针通过，2次模型完成、调用`get_trip_context`，DSH manager `completed`，API语义为`responded`，耗时2.798s。官方DeepSeek搜索探针通过，4次模型完成、1次官方搜索，实际`web_search`后`web_fetch`，最终有1个可用持久evidenceRef，manager `completed`/`responded`，耗时10.039s。搜索返回的6个候选URL自身没有正文evidenceRef；被抓取正文才产生可用引用。未将这些探针当作攻略保存或质量验收。

账本仍是既有batch `d1a2aef6-d04d-4c44-9d22-6b1892226f95`：本次追加前保留23模型/10搜索及US$1.72未知预留；授权累计US$5、96模型、24搜索。当前累计72模型/23搜索、US$4.72均为已知金额或未知费用预留的保守占用（其中供应商实际美元金额仍unknown）、pending=0，剩余US$0.28。model探针前后23/10→25/10及US$1.72→1.80；首次失败的搜索探针对应25/10→30/11，安全observer `bdafd450-d898-4459-b2db-3e189dcaaf8a.jsonl`记录4个模型receipt和1个搜索receipt，但其回复被截留；之后的官方搜索探针通过，账本快照30/11→35/12及US$2.08→2.36。第三commit尝试开始56/19、US$3.76，结束72/23、US$4.72；其单轮增量16模型/4搜索、US$0.96预留。

三个独立真实commit尝试均产生终态API turn，但没有任何Artifact引用或accepted攻略：首轮66.318s、`goal_partial/partial`；第二轮100.423s、`model_failure/not_requested`；第三轮61.933s、`model_failure/partial`。第三轮model invocation 12产生的`commit_travel_guide`调用以`DSH_TOOL_FAILURE`失败；随后model invocation 13因调用上限被阻止，manager以`reason=error`结束。runner没有将HTTP completed误判为成功。相关修复仍在主任务处理中，不在这里追认通过。

同批配置为DeepSeek `deepseek-v4-flash`、`thinking=disabled`、请求参数`max_tokens=4096`。4096是单次输出配置，不是供应商额度/实际token消耗上限，也不提供真实美元计费上限；账本没有可信货币回执，未知费用继续以reserved计入。H5只读准备有三个独立结果：9/24 23:47准备通过，workspace GET可用、输入框就绪、4项观测事件、0次POST、0个浏览器错误且前后账本SHA256一致；9/25 09:50准备在打开页面前因保存的浏览器current Trip断言失败，0项事件/POST，预算SHA256不变；9/25 09:53仅恢复同一空会话壳后准备通过，输入框就绪、3次真实workspace GET、0次POST/其他mutation、0个pageerror且前后账本SHA256一致。三次均未点击发送，没有accepted UI证据。观察和三次commit失败日志留在忽略目录 `backend/.demo/dsh-e2e-20260924/`，文档仅记录脱敏指标，不收录token、原始session/CoT或页面正文。

本记录只反映`state.private.json`及append-only安全observer中当前保留的证据；D3/D4早期全量/定向测试数量仍按各自时间点报告，不由这些真实探针改写。H5断言套件3/3及observer fixture套件1/1是离线验证，不代表真实commit或真实H5发送通过。
