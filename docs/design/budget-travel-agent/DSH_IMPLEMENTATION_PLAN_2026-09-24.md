# FlightOR：DSH 单主 Agent 后端实施方案

日期：2026-09-24
用途：交给本地 Codex 分阶段实现；不包含已经执行成功的声明。
本轮已确认方向：优先实现 DSH 路线，新建开发分支，前端保持不变。此前 R/U 对照草案不作为本轮前置。

## 0. 基线、事实与实施决定

本次只读核对：

- FlightOR `main@8a83b032a8ee18097af62304d99df86f9a543489`，提交为 `feat: persist real place media independently of maps`，包含地图收尾提交 `a980882`。[S1]
- 官方 DSH 源码 `46a7f68b0922371ce7144b668b90e377d8e799f4`，提交记录为 `0.1.7-rc.1` 发布合并。[S2] 这不证明所有 npm 子包均已发布同名版本；安装时必须核对实际包与锁文件。
- 当前 FlightOR Agent 路由依赖具体 `CloudPlannerService`，公开 API 已有异步 turns、轮询、取消、同步 converse 与本地化接口。[S3]
- DSH 高层 SDK 采用 stdio JSON-RPC；当前协议只有 initialize、session/prompt、shutdown，没有单轮 cancel 或 session-close，也不提供 prompt 与最终回复的一一归属保证。[S4]
- DSH 核心公开 API 提供 `ctx.agents.create/resume`、`Agent.followup/inject/cancel/whenIdle`。[S5] 当前 SDK server 的新会话路径调用 create，不能把重复传 sessionId 当成跨进程 resume。[S6]
- DSH 的 `sdk-minimal` 默认仍是 shell Agent；当前实际组合还包含 session-log、plugin inventory 等插件。不能仅凭“minimal”或 README 概括就宣称无 shell、无额外上传。[S7]

**本方案决定：使用 DSH 核心公开 API，在独立无界面 worker 中组合运行。FlightOR 自己只实现窄控制桥，不重写 Agent Loop，不 fork DSH 内核，不使用 DSH Desktop/Web UI。**

这与“直接调用官方 SDK.run()”有意不同：FlightOR 已有取消、持久会话和多用户要求，本方案使用 DSH 已有的核心能力完成它们，而不是依赖 SDK 尚未提供的方法。

### 本轮交付目标

同一套现有前端，可以通过后端配置在旧引擎和 DSH 引擎间启动选择。DSH 路径中，一个主 Agent 负责调查、选择、规划、解释与修改；现有领域服务负责身份、事实引用、航班授权、预算口径、保存和完成判定。首次攻略的展示文本由这个 Agent 一并生成，不默认再调用独立 Research synthesis 或 Finalizer。

不能为了“单 Agent”删掉专业工具、数据库、来源记录或发布合同。单主 Agent 也不意味着一个用户回合只有一次模型请求。

## 1. 不可扩大或破坏的范围

### 保持不变

- 根目录 `src/` 的页面、组件、store、交互、i18n 和正式视觉；前端 API 调用方式与业务响应结构。
- 登录与 owner 隔离；Trip/Conversation/Memory 的职责。
- 航班查询、明确采用、selection revision、航线生成授权及确定性业务引擎。
- Research/TravelGuide/Workspace 的既有持久化模型及旧记录可读性。
- 中英 publication、显式本地化、地图/图片 enrichment、content hash 和失败降级。
- GET/刷新/展开详情不生成，不重新研究。
- 地图底图仍列为暂停排查的已知问题，不作为本轮 Agent 路线的前置。

### 允许修改

`backend/` 的引擎装配、共享应用服务、DSH worker、必要的新增迁移、测试、后端脚本与依赖锁文件，以及相关 `docs/`。现有前端只运行测试，不改代码来适配新后端。

确有前端合同不可表达的需求，先提供最小差异说明，不偷偷变更响应，不在本轮重做 UI。

### 本轮不做

R/U/H 三路大规模评测、PTC、子 Agent、自动插件安装、通用工作流平台、向量库、多家搜索路由平台、地图故障修复、新图片供应商、自动购票、生产全量切流、整个 G1 关闭。

## 2. 分支与代码基线

建议分支：`codex/dsh-backend`。使用独立 worktree，从本地核对后的最新 `origin/main` 创建。

安全操作顺序：

1. 读取 AGENTS.md、PROJECT_CONTEXT、DPS/progress 及相关 ADR；检查 git status、worktree、远端和目标分支是否存在。
2. `git fetch origin` 后记录实际 main SHA。若已晚于本文基线，列出影响本任务的增量，再继续；不要回退到旧 SHA。
3. 原工作区有未提交内容时不自动 stash，不 reset/clean，不夹带。已存在的图片/地图分支不重新合并。
4. 创建不冲突的 worktree；目标分支已存在时核对其来源，不覆盖或强推。
5. 分阶段提交、测试后推送新分支；本轮不自动合入 main、不改部署默认值。

示意命令仅在检查通过后使用：

```bash
git fetch origin
git worktree add -b codex/dsh-backend ../flightor-dsh-backend origin/main
```

建议新增后端配置 `FLIGHTOR_AGENT_ENGINE=legacy|dsh`，默认 `legacy`。这是本方案的新配置名，不是当前已有字段。

选择在后端启动时完成，不能由客户端传参数更换引擎。工厂要先分支再核验该路线所需凭证；不能让 legacy 的 OPENROUTER_API_KEY 检查阻挡一个合法的官方 DeepSeek DSH 配置。DSH 失败不能静默调用旧 Planner 兜底，否则无法确认实际执行路线。恢复旧配置并重启服务是显式回滚。

## 3. 目标结构

```text
现有 Taro / H5 / 微信前端（零改动）
                   |
既有认证 API、turn store、轮询、取消、公开响应
                   |
             PlannerServicePort
              /             \
   LegacyPlannerService    DshPlannerService
   现有运行路径保留         |
                     DshSessionManager
                            |
                  独立 DSH worker（每会话）
                  DSH core + AgentLoop
                  单一主 Agent / native tools
                   |                  |
            web_search/fetch     旅行领域工具
                   |                  |
            来源接纳与审计      受控 IPC 请求
                   \                  /
                    FlightOR 领域服务
         Trip / Flight / Evidence / Goal / Artifact
                  校验与提交 publication
                            |
                 现有公开响应与读取接口
                            |
                   同一份正式前端
```

DSH 路径不得调用 `CloudPlannerService.runTurn()` 或原 `AgentRuntime.run()`。可以共享纯函数、repository 和领域执行器，不能把旧 Planner 再包装成 DSH 的工具。

### 3.1 最小应用接口

将路由中的具体 service 类型改为结构化接口，包含当前实际使用的方法：

- `validateTurn(...)`
- `publicationContext(...)`
- `runTurn(...) -> CloudPlannerTurnResult`
- `localizeGuide(...)`

保留现有入参、返回语义和错误行为。可将本地化等与引擎无关的方法下沉共享服务，避免复制；禁止为了翻译实例化旧 AgentRuntime。

公开 `reply/tripContextSummary/artifactRefs/suggestedActions/warnings/stopReason/delivery`、artifact 类型、版本、轮询状态与响应码不因引擎不同改变。新增内部运行元数据不能直接落进已有 strict 公共 schema。

工厂级对象生命周期要明确：当前 serviceForUser 可被每次读取调用。DSH SessionManager 应为应用级有界管理器，而不是每次轮询新建 worker。GET、publicationContext 和本地化读取不应拉起主 Agent。

## 4. DSH 运行组合与 worker 控制

### 4.1 依赖与启动

- 以官方固定提交和公开包导出为依据，锁定依赖及实际 Node 版本；不用 `latest`、浮动 Git 分支或用户全局 npx 缓存作为验收基线。
- 优先创建后端内独立运行包，例如 `backend/dsh-runtime/`，用自己的 package/lock、编译与启动脚本，避免 DSH 的依赖影响根前端锁文件。
- 包版本不一定全相同：核对官方依赖关系与实际 npm 发布，用同一可兼容发布集合；版本缺失时选择固定源码构建并记录 SHA，不凭空填包名。
- 参考官方 minimal 的核心组合构建受控 Context/Loader；用 DSH 的标准 AgentLoop，不自写 model→tool→model while 循环。
- worker 主入口使用 Node 子进程 IPC，或等价有界私有通道。默认只允许父进程连接，不额外开放公网管理端口。
- 无法直接从发布包导出的核心能力，应使用官方支持的 profile/plugin 组合；不 deep-import 不公开的内部路径来长期维持兼容，不在 node_modules 打补丁。

### 4.2 必需能力与禁用项

组合只保留 Agent/AgentLoop、Session/持久化、LLM adapter、Prompt、Tools、必要的 timeout/guard、Web 与 FlightOR 插件及依赖服务。

明确移除/禁用模型可见 shell、文件读写、git、run_code/PTC、subagent、工作流、插件管理、DSH Goal/Task/Todo。不能直接启动完整 `sdk` 或 `sdk-minimal` 后仅靠提示词禁止危险工具。

内部依赖服务可能仍需文件持久化，这不意味着给模型文件工具。工具白名单必须执行时强制检查，不能只过滤展示 schemas。

显式排除 session-log 上传、plugin inventory 及其他非必要遥测/远程扩展。可保留私有本地轨迹；核对实际挂载树和出站请求，不仅检查一个开关。

从进程环境白名单传入所需变量。不继承用户全局 `~/.dsh`、任意用户插件、项目 coding instructions、系统个人凭证。会话文件存到受限的应用数据目录，不进 Git，不进 tmpfs。

### 4.3 控制协议只做桥接

建议只定义应用需要的控制消息：初始化、打开/恢复会话、提交一个输入、取消、关闭，以及事件、领域工具请求和响应。这里是 FlightOR 自有 IPC，不冒充官方 SDK 方法。

消息有 schema、相关 ID、大小上限、超时和错误类型；日志不得混入协议通道。身份和 scope 由父进程分配，不接受模型声明的 ownerId。

运行中每个 DSH worker 至多一个主 Agent、一条活跃用户回合。同一 Conversation 的重复提交按既有语义去重/拒绝并发，不能同时排两条 prompt 后把最后一个 assistant 消息随意归属给前一个请求。

应用观察窗口使用 generation/运行代次、明确用户消息 receipt、当前 turn 和持久提交回执绑定；`idle` 只是运行状态，不等于业务 satisfied。

## 5. 会话、状态和取消

### 5.1 最小生命周期

一期采用一个活跃 Conversation 对应一个独立 worker。会话空闲保留短时间以复用上下文；用可配置最大活跃数和空闲回收限制资源，默认值作为配置而不是性能保证。先验证单 API 实例，不声称支持多节点共享会话。

相同会话继续调用 `followup`；回收/服务重启后使用 DSH 公开 `resume` 恢复持久 Session。不得用 SDK 中的 create 冒充 resume。

父进程持久记录 owner/conversation/trip 与 DSH session/profile epoch 的映射。每次加载同时核对 owner、Trip 和 profile 版本；文件名不能直接拼接不受信输入。数据目录与数据库映射一并具备备份说明。

映射缺失或恢复失败时允许从 FlightOR 已保存公共会话、当前 Trip 和兼容 Artifact 创建新会话，但必须标记 rehydrated，不声称忠实恢复全部工具上下文，不自动重放旧工具调用。

### 5.2 两种历史，不是两个业务真相

- FlightOR Conversation 保存真实用户消息与最终公开回复，供现有 UI 使用。
- DSH Session 保存模型交互和工具轨迹，供 Agent 执行与恢复使用。
- Trip、已采用航班、Memory 开关和当前 Artifact 以数据库为准，不以 DSH 历史里的旧值为准。

每个新用户回合注入最小可信状态快照：Trip/flight revision、当前日期、locale、显式偏好、已接纳攻略索引、可复用 evidence 摘要与权限边界。复杂研究正文按引用读取，不机械注入全部历史。

注入通过 DSH 公共 `inject` 或 Prompt 扩展完成，不伪造成用户自己说的话；父进程只保存一次真实用户消息。

关闭/清除 Memory 后，仅停止新注入不足以消除 DSH 持久历史中的旧 Memory：退休旧执行会话，基于当前允许的数据重建；当前对话里用户自己明确说过的条件仍可保留。对此新增回归测试。

### 5.3 取消和迟到结果

接到现有 cancel/超时/身份失效请求时：

1. 父进程先使本 generation 的领域写入授权失效，阻止新的副作用；与既有持久取消边界配合。
2. 调用 worker 中 `agent.cancel(...)`，清除未执行 inbox，向联网与业务请求传播 AbortSignal。
3. 有界等待 idle/清理；无响应则只终止该 worker，不杀其他会话。
4. 迟到消息、搜索结果、保存请求继续核对 generation 和 fencing token，不复活取消终态。

确认取消后不会有新的业务提交；取消前已经提交成功的内容如实保留并恢复，不能假称从未发生。正在进行的提交与取消要经过同一个可验证的竞争边界，不靠先检查一次 signal 后无条件落库。

重启不会自动“继续未完成工具”；通过保存回执与当前状态判断是否已生效。模型和供应商请求可能已经收费，停止本地进程不等于撤销供应商账单。

## 6. 身份与领域工具桥

worker 不获得数据库连接或通用管理权限。父进程持有 owner-scoped repositories 与现有业务服务。

每个工具请求由 worker host 附带不可由模型更改的 channel binding：会话、当前 generation、执行代次和幂等键。父进程反查可信 owner/Trip/Conversation；若消息中带相关字段，只能交叉校验，不能覆盖绑定。

模型参数可以包括需要操作的 activityId、artifactRef、预期内容版本，但 ownerId、数据库名、任意 URL API 路由、SQL 不在工具 schema 中。引用仍要验证归属和范围。

工具数量不设人为“必须八个”的目标；保留完成两种入口所需的最小集合。建议职责如下，优先沿用现有合理名称：

| 能力 | 执行边界 |
| --- | --- |
| web_search / web_fetch | DSH Web 工具；结果自动接纳为可引用材料 |
| 读取当前 Trip、攻略和来源 | 同 owner/Trip 的既有服务；初始已预加载部分无需再调 |
| resolve_location | 既有可信解析；不让模型编写机场、时区或经纬度 |
| update_trip_context | 当前需求驱动、版本检查；在接受固定 Goal 之前完成必要更新 |
| 航班查询/比较与读取已采用航班 | 现有 fares/aviation 与选择记录；查看不等于采用 |
| commit_travel_guide | 组合提交候选、安排与展示文案，复用既有领域服务 |
| respond_to_user（或等价终态输出） | 提交解释/澄清等公开回复，不假装修改攻略 |
| 明确长期偏好管理 | 仅复用现有 Memory 能力，当前行程条件不擅自升级长期偏好 |

重要约束：

- 合并航班与攻略的请求，仍先比较航班，让用户在现有 UI 明确采用，再安排与时刻绑定的行程；不能默选第一条。
- 自备机票不查票；已采用航班不重新查票或更换，除非当前用户明确要求。
- 最终航线生成继续走已有显式授权入口，不让模型用内部计算工具绕过它。
- 复用 lean Goal 的“业务操作接受意图/约束，服务端负责 Run/完成”机制，不给模型另一套 DSH Goal。
- 不把 existing guard、goal acceptance、artifact completion 复制到 worker。必要时从原工具执行器抽出共享函数，旧引擎也使用同一份，配对回归。
- 外部只读请求可以并行，但记录证据、Trip 修改、采用和发布各自遵循提交边界。不得仅修改 parallelSafe 标志假装所有调用均无副作用。

## 7. 联网：先能用，再单独比较 Provider

### 7.1 明确首版运行配置

主 Agent 使用 DeepSeek，优先复用本机已经授权且工作正常的模型/路由。在只有 OpenRouter 凭证时，使用 DSH 官方 `llm-pi-ai` 的受控兼容配置接现有实际模型，不把该 Key 发给 DeepSeek 官方域名，也不因为换 Harness 顺便换模型。[S8]

本轮默认实用基线建议：

**DSH 主 Agent + `web_search`/`web_fetch` + 既有 SerpApi 原始搜索结果，无独立 research synthesis。**

理由是先隔离 Harness 和单 Agent 编排的效果，避免没有新凭证就无法开工。此路径仍是一个 Agent 自己联网、规划，不是让 DSH 委托旧 ResearchAgent。

将既有原始搜索能力包装成 DSH `ctx.web` provider；不调用 ProductionResearchAgent、不调用其 synthesis。若已有 Exa Key，仍不默认另接一家。

同时为官方 `dsh-web-search-deepseek` 保留明确配置：已有可用 DeepSeek 官方凭证时，可在同一实现分支上选择它做少量 smoke；不用自己重写官方搜索适配器。它是另一份明确运行 profile，不做静默 fallback，也不影响主 Agent 模型路由。

**验收报告必须区分 `serpapi-raw` 与 `deepseek-official`。只有 raw 搜索成功时不能宣称 DeepSeek 官方联网已跑通。**

### 7.2 特别核查的官方行为

- DeepSeek 搜索 Provider 使用独立的 Messages endpoint，当前每次查询会额外消耗一个模型调用，其返回结构化来源，不接纳 Provider 散文为事实。[S9]
- DSH 的批量 web_search 多 query 并发时，任一失败会取消其余并丢弃成功结果。[S10] 首版设较小批量，不盲目默认四路。可先 `searchMaxQueries=1` 稳定验证，再单独评估批量；不 fork 官方工具改变行为而不标记。
- web_fetch 的非 2xx、截断、未读到正文要保持状态，不能把“工具返回字符串”都标成读取成功。
- 缺 Provider/Key 时显式 unavailable，不让 Agent 自动安装插件、改 endpoint 或在 shell 发 curl。

### 7.3 限时、重试、费用

复用当前整轮期限，默认不突破既有前端等待窗口。拆分记录启动、模型、搜索、网页读取、提交、恢复等耗时。

显式设置模型输出上限与实际支持的 reasoning，不照抄官方示例里的高输出/最大推理。Provider 不支持的字段在配置探测时失败或以记录过的配置纠正，不静默移除后声称一致。

`llm-pi-ai` 文档存在默认五次重试，必须显式收敛；外部模型自动传输重试最多一次，搜索不做隐藏无限重试，格式/内容修复最多一次。所有次数共享原请求截止时间和费用准入。

保留缓存、限流和可持续账本；不复活旧 G1 累计24次作为本轮永久上限，也不将地点次数限制取消解释为无限付费模型授权。

未知收费保留未知/预留。Native Search 内部模型和搜索次数能观测则统计，不能用一次上层工具调用代替全部成本。

## 8. 自动来源记录，不要求另一个研究 Agent

在 DSH 的结构化 Web 返回和工具执行管线接入 evidence recorder。[S11]

优先从 canonical result/结构化 metadata 读取 URL、标题、片段、正文、状态，不从模型回答里正则猜链接。来源登记通过受控桥在父进程完成，成功后把 `evidenceRef` 加入模型可见的工具结果。

有损渲染后的工具文本不能充当所有来源的唯一原始存档；同时保留足够的结构化事实。无需存储整网页无界 HTML。

每条材料至少能关联：

- 真实 Provider、请求/工具调用、owner/Trip/generation、获取时间；
- 来源原 URL、最终 URL（如有）、标题、实际返回的 snippet/正文片段、hash；
- search snippet / fetched body 等证据深度、HTTP/截断/失败状态；
- 用于事实接纳的内部 evidenceRef。

来源存在、官方域名、读到正文都不能自动等同“未来出行日已验证”。片段能支持基础介绍时允许使用，不强制每个景点都再读正文；缺少关键依据则针对缺口补读。

任何材料保留外部不可信标记；不执行网页中的改系统提示、发送凭证或跨用户读写指令。沿用已有 SSRF、公网地址/DNS/重定向/体积/类型检查；无需为 DSH 新增任意公网代理。

缓存复用要核对 Trip 范围与资料适用性；偏好改变不必重搜不变的景点基础事实，时效活动也不能只因 URL 相同就长期复用。

## 9. 一个主 Agent 直接生成可发布内容

### 9.1 组合提交的职责

`commit_travel_guide` 是应用组合工具，不是第二个 Agent。它接收：

1. 当前范围及 expected revisions（归属仍由父进程绑定）。
2. 已有 candidateRef，或基于本轮 evidenceRef 提取的候选。
3. 每天的主题、顺序、时段和活动选择。
4. 当前 locale 的 reply、overview、名称、简介、推荐理由以及来源引用。

可以用临时局部 key 在单次输出中连接候选、活动和展示文本；由服务端映射到真实 finding/activity ID。不能要求模型事先猜数据库 UUID，也不能让它选择冲突 ID。

处理顺序：

- 校验输入 shape、引用资格、当前 owner/generation/Trip/flight 范围。
- 将合法候选转换/保存成既有 ResearchArtifact，不再调用研究综合模型。
- 使用既有 saveAuthoredTravelGuide 与共享领域 validator 生成实际攻略及 ID。
- 按确定的 ID 映射验证 FinalText 与攻略一一对应，检查用户可见字段和硬约束。
- 保存当前语言的 publication，并完成服务端 Goal 判定；在实际提交后才发可用 Artifact 事件。

不可将多个远程调用放进长数据库事务。若无法将既有两个保存操作合为一个事务，可以先存隐藏草稿后发布；公开接口不得在中间状态读到伪 accepted，重试要幂等。

失败返回精确 fieldPath/activityKey 问题；最多同 Agent 一次有界修复。已知材料缺失允许明确部分/未完成，不自动启动无限研究或更换用户约束。

### 9.2 Finalizer 的处理不是“直接篡改 accepted”

DSH 首次攻略路径默认没有独立 Finalizer 调用。同一个主 Agent 在提交之前依据相同内容规则自查，程序执行现有可实现的发布检查。

从当前 Finalizer 抽出或复用纯校验函数；不可跳过它们，不可把原始自由文本直接写 `accepted=true`。

沿用 `FinalText` 的 locale、reply、overview、days、activities 等字段。[S12] 若需要增加生成来源，放在内部兼容元数据/审计中，例如 integrated-dsh 与 separate-finalizer；不能因旧 schema strict 而强塞字段到公开响应。

`accepted` 表示通过本实验明确的发布准入，不声称是独立模型验证，也不证明所有语义真实。质量仍需人工抽样；一期记录误放和误拒，不再追加同模型第二次“独立审核”来伪造保证。

内容要求沿用当前产品：

- 当前界面 zh/en，必要地名原文保留，不混出双语正文；无内部元叙述。
- 景点名称、简介、推荐理由明确；交通资料不能冒充主景点，正常交通事项可保留。
- 不发布未经支持的门票、开放时间、精确交通耗时或总预算保证。权威航班时刻和用户预算目标不因此删除。
- 已知闭馆、日期冲突、地点错配不能通过“不展示精确数据”被忽略。
- 不将来源长链接和原文重新塞回概览/详情；在既有引用/署名通道保存。

### 9.3 防止提交后额外改写

成功提交攻略的回合，公开 reply 取已接纳且版本匹配的 publication.reply，Artifact 引用取真实提交回执，不展示后续模型自由发挥。

利用 DSH 的公开 turn-stop/结果协调接点停止或收敛后续生成；即使框架仍产生一轮确认，也记录实际费用，不谎称没有额外调用。不要把业务 commit hook 写成第二套模型循环。

### 9.4 解释与澄清回合

纯解释不能一律被替换成“攻略已保存”。通过 `respond_to_user` 或等价结构化终态提交当前问题的公开回答：reply、可选已存在的 sourceRefs/artifactRefs、结果性质。无 commit 不代表可以无条件直出所有原始文本。

内部推理、工具错误原文、身份数据和无证据的新数字不能流到聊天；对已存行程的解释引用当前版本，状态仍由服务器决定。普通闲聊/澄清不需要建攻略 Goal。

该输出不再单独调用审核模型；沿用纯发布检查和同 Agent 的有界修复。不得把源资料里的英文指令当成输出规则。

## 10. 本地化、媒体与多轮修改

- 现有显式 localization API 保持。另一语言首次生成可以继续复用已接纳终稿的无工具本地化调用，这不属于首次攻略重复 Finalizer；其费用单列。
- 将翻译 client 从 legacy runtime 依赖中解耦，不能为 localizeGuide 启动旧 Planner 或 DSH 旅行循环。
- 语言切换不改变 Trip；已有版本直接读，无自动重试循环。保留 retryRevision 和失败历史的现有约定。
- 图片和地点仍依赖活动身份、accepted 文本和 content hash；不在 Agent 主循环里等待图片/地图，也不重新生成已接纳正文。
- 局部修改保护用户指定不变区域；允许跨新攻略版本重用不变的候选/活动身份。当前 ID 规则若随日期/来源合理变化，以显式 lineage 映射处理，不强行冻结错误 ID。
- 不能把前一回合已 satisfied 的 Goal 当作可继续写的 Run；新修改按现有版本/意图规则接受。
- 用户在 UI 改航班时，旧 session 记忆不更新也不能覆盖数据库。下一模型步骤/副作用前检查，不等到最后展示才发现过期。

## 11. 最小持久化与并发

优先复用现有存储。新增迁移使用当前下一个可用编号，不按本文猜测固定为015。

只有现有表无法表达时才新增：

1. DSH 会话映射：owner/conversation/trip、sessionId、profile/config hash、epoch、更新时间及状态；对应范围唯一约束和查询索引。
2. 来源证据或提交回执的扩展：若既有 research audit/Artifact metadata 能表达则复用；需要新表时必须有 owner/Trip 范围、幂等键和必要索引。

控制层/工作进程内部 ID 与外部 UUID 分开。原始认证 token、Key、完整系统 prompt 不进入业务公开表。

幂等至少覆盖同 generation 的同一提交调用重送，成功后只返回已存在回执；网络断开后读取状态确认，不重复保存。

第一版只支持一个管理实例时，明确部署范围并锁住相同会话的执行。跨服务重启/迁移若可能存在旧 worker，使用持久 epoch/fencing 拒绝旧进程写入。不要只用内存 mutex 宣称跨节点安全，也不要在一期建设通用分布式调度系统。

## 12. 分阶段实施与提交

### D0 — 依赖与真正的 DSH 最小启动

建立分支/worktree、固定版本、独立 runtime package、插件组合和 worker 桥。

验收：离线 fake LLM adapter 驱动真正 DSH AgentLoop 完成一次无副作用工具调用；能取消并关闭、没有 shell/PTC/subagent/外传插件；记录实际工具名单与加载树。

失败必须区分安装/构建、配置注入、模型路由、网络和业务错误。不要将 JSON/YAML 格式错误报告为模型不可用。

建议提交：`feat(dsh): add isolated headless runtime composition`。

### D1 — 保持 API 的 service 接入与只读多轮

抽出 PlannerServicePort，装配引擎开关，接通认证、当前状态、Conversation、进度、只读 Artifact 和回复。

验收：原请求 schema 与响应 schema 不变；同会话连续消息正确归属；刷新/轮询不启动模型；legacy 回归通过。

建议提交：`feat(agent): add DSH service behind existing API contracts`。

### D2 — 联网、来源与首次正式攻略

接入 ctx.web 原始搜索/读取、evidenceRef，组合提交既有 Research/Guide/Publication；默认没有独立 research synthesis/finalizer。

验收：fake 回执走真实业务仓库链路；引用失配拒绝；自备机票正确完成；已有航班范围不被改写；前端同样读取 accepted 文本。

建议提交：`feat(dsh): add evidence-backed single-agent publication`。

### D3 — 必须具备的多轮、取消、恢复

接通局部修改、正常解释、语言版本、持久 resume、故障回收、并发拒绝、幂等、Memory 关闭后的执行上下文重建。

验收：下节关键离线/数据库案例通过，不要求所有城市或大规模模型排名。

建议提交：`fix(dsh): enforce turn lifecycle and recovery boundaries`。

### D4 — 小规模真实闭环与交接

已有明确预算和 Key 时，按下节两条真实对话 smoke；没有授权则完成其余实现，一次性报告具体所缺配置，不反复请求用户决定代码细节。

用现有正式 H5 页面，保持前端不改，完成发送、查看、追问、局部修改、重进。微信工具可用时验证同接口读/轮询；原生底图不作为阻断。

保存逐轮耗时、公开内容、实际模型/搜索配置和失败；不是完整 R/U/H 评测。

建议提交：`test(dsh): add contract and multi-turn smoke evidence`。

每阶段完成相应代码与测试再提交，不只提交设计，不因最后一个外部凭证缺失而把前面能完成的工作停住。

## 13. 一期最小验收集

### 13.1 零付费的核心回归

| 类别 | 必须验证 |
| --- | --- |
| 真 DSH 路径 | 使用实际 AgentLoop + fake model/provider，而非 fake DshPlannerService；旧 Runtime/Research synthesis/首次 Finalizer 调用数为0 |
| 公开合同 | 既有 turns/converse/cancel/localization/Artifact schemas 与错误边界兼容；无前端变更 |
| 归属 | 跨 owner 引用、伪造 Trip/session ID、注入 scope 均拒绝；两个会话互不干扰 |
| 来源 | 摘要不是正文、非2xx不是成功、URL不匹配/证据缺失/截断保持状态；网页提示注入不改变工具权限 |
| 正常业务 | 自备机票无查票；已有航班不重查；用户没有采用不先生成绑定攻略 |
| 多轮 | “为什么推荐”获得解释；只改第二天下午，第一天不变；总预算口径不反转 |
| 发布 | 标题/简介/理由均检查；中英正确；不因工具成功将半份草稿标成可交付 |
| 取消 | 搜索中、保存前、保存竞争、工具不响应、旧 worker 迟到，各自状态与副作用正确 |
| 恢复 | 同 worker followup、重建后 resume、public Conversation 不重复；未完成 inbox 不自动重放写工具 |
| 幂等 | 提交成功但回执丢失、重复 IPC、重复 HTTP，不能重复产生已完成交付 |
| Memory | 禁用后旧 DSH Memory 注入不会继续被采用；当前显式需求优先 |
| 降级 | 搜索429/超时、模型截断、worker退出、地图/图片不可用，不伪完成、不隐藏费用 |

数据库测试使用持久、可恢复的独立测试库，不新建无法安全重启的 tmpfs 依赖。纯内存通过不能说 PostgreSQL 已验收。

### 13.2 两条真实对话即可，先不扩大

基准日和旅行日期在批次开始时解析并冻结；使用独立合法测试身份，不使用真实其他用户的数据。

**A：自备机票，至少四条消息和一次重进**

1. “机票自备，不查航班。D+30到D+31东京两天，两天合计1500元，文化和小吃，轻松一点，安排并保存。”
2. “为什么第二天上午推荐这个地方？只解释，不改行程。”
3. “第一天不动，只把第二天下午换成室内文化场所。”
4. “预算改成两天合计1200，不是每天；不要承诺未知费用肯定够。”
5. 重进/刷新，按现有操作生成另一语言再读回。

**B：已有明确采用航班**

用现有合法流程准备一份已采用航班状态；合成航班测试与实时票价测试明确区分，不为检验编排硬买一轮新票价请求。

1. 根据所有航段与抵达时刻安排；不重查/更换航班。
2. 用户解释性追问，不重写整份攻略。
3. 一项局部修改，航班和其他日程保持。
4. 单独在受控测试中改变 selection revision，验证旧结果不得接管；真实用例可在有必要时追加，不扩大成全部航线覆盖。

每条真实案例都有失败停止条件，不能换措辞一直重跑到抽中好结果。费用不确定时保留记录。

### 13.3 计时与内容证据

每轮记录：接单、DSH启动/恢复、首个有用答复、研究墙钟、模型请求数和各耗时、工具请求/Provider HTTP/实际搜索数、首次保存、当前语言accepted、最终API、刷新读取。

UI读到草稿与accepted分开。父子span不相加冒充总耗时；SDK/worker idle不等于领域完成。图片/地图时间单列，用户思考时间不计入模型耗时。

同样记录质量问题：是否理解当前修改、是否误改其他日期、解释是否针对实际活动、来源支持、语言、无无依据数字承诺。人工查看公开文字和卡片，不以LLM自查或JSON合法率代替。

本轮不设“必须快20%”作为实现停止条件。先得出能否正确运行、实际慢在哪里；大规模路线比较和PTC留待下一次决策。

## 14. 完成定义、回滚与报告

可声明“DSH实验路线可用”需同时满足：

- 实际启用 DSH 核心循环，单主 Agent，没有嵌套旧 Planner。
- 原前端和公开 API 不改，两个主要入口可通过既有合同保存/恢复。
- 首次攻略路径没有独立研究综合与终稿重写；例外调用（例如显式本地化）单列。
- 关键取消、owner、版本、幂等和恢复回归通过。
- 至少一条真实连续对话完成；第二条若只能使用领域 fixture，准确说明验证范围，不宣称实时航班全链路通过。
- 运行配置、耗时、费用、失败和内容输出可审查。

未取得新 Key/预算时可以交付“实现与离线/数据库通过，真实调用未执行”，不能写成生产可用；不要默默用另一供应商结果填空。

最终报告仅包含：基线与最终SHA、分支、改变的后端模块、未改动的前端证明、DSH版本和插件白名单、模型/搜索真实路由、测试层次、两条对话与分阶段耗时、费用、未解决项、启动/关闭/回滚命令。

引擎回滚切回 legacy；新增表为兼容增量，旧服务可忽略，不要求删新数据。不能合并 main、删旧runtime或宣告G1全部通过。得到用户后续批准才讨论默认切换与清理旧代码。

## 15. Codex 开工指令

按 D0→D4 实现并分阶段提交。先核对本地实际状态与官方固定版本接口，再写代码；发现本文符号与源码不符时以源码为准，记录最小必要偏差，不凭空调用 SDK.cancel/resume。

先跑通最小竖直链路，再扩到规定的取消与多轮案例。不要提交一堆空适配器后宣称完成，也不要为了架构“干净”重写所有服务。

改动与原工作区隔离，前端禁止改动，保留历史账本。真实付费在有明确额度时执行；缺少项一次列清，其余可实现工作继续完成。最终推送新分支供审核，不自动合并。

## 16. 核对来源

以下为本次阅读的源码，不代表本地运行验证。Codex 可按固定 SHA 读取；本文的 worker/IPC/分阶段计划是实施设计，不是官方开箱即用功能。

- [S1] `ventsdenye2/flightor@8a83b032a8ee18097af62304d99df86f9a543489`，main 提交及 `docs/PROJECT_CONTEXT.md`（项目状态参照）。
- [S2] `deepseek-ai/deepseek-harness@46a7f68b0922371ce7144b668b90e377d8e799f4`，最新读取的发布合并提交。
- [S3] FlightOR `backend/src/routes/agent-cloud.ts`、`backend/src/agent/cloud/service.ts`。
- [S4] DSH `packages/sdk/client/README.md`、`packages/sdk/protocol/README.md`。
- [S5] DSH `packages/core/agent/README.md`。
- [S6] DSH `packages/sdk/server/src/server.ts` 的 createSession/getOrCreateSession。
- [S7] DSH `packages/bundle/sdk-minimal/README.md`、`packages/bundle/sdk-minimal/cordis.patch.yml`；实际组合为优先核对依据。
- [S8] DSH `packages/llm/llm-pi-ai/README.md`。
- [S9] DSH `packages/web/web-search-deepseek/README.md`。
- [S10] DSH `packages/web/tool-web/README.md`。
- [S11] DSH `packages/core/tools/README.md`。
- [S12] FlightOR `backend/src/travel-guides/finalization-schema.ts`；现有 authored/validation/publication/存储应由 Codex 同时核对。

官方仓库地址：

```text
https://github.com/ventsdenye2/flightor
https://github.com/deepseek-ai/deepseek-harness
https://www.deepseek.com/harness/
```
