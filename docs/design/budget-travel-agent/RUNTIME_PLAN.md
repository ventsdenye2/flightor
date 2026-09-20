# 当前修改方案：先精简 FlightOR，再以实测决定 Harness

日期：2026-09-20。状态：**分步实施中：B0–B3 已实施，B2 仍默认关闭；B4 起待实现**。B2 PostgreSQL 新事务尚缺实际数据库验证；未跑真实模型评测或安装 DSH。B3 契约见 §3/4，逐项证据见 [progress](progress.md)。

这是本轮后端修改的唯一范围入口：[DPS](DPS.md) 定义执行顺序，[EVALUATION](EVALUATION.md) 定义案例与决策门槛。[RAS](RAS.md) 保留产品需求，[RDS](RDS.md) 是后续完整能力设计，不是首轮全部施工清单。

## 1. 依据与范围

用户提供的 [GPT 对话](chatgpt-conversation://6aaf894b-1320-83ee-aacf-43479732e029) 已完整读取。对话是设计参考，源码与可追溯运行证据才是现状依据。

[东京调用分析](../../CALL_ANALYSIS_2026-09-13_TOKYO.md) 的单次历史样本：129.758 秒 = 主 Planner 11 次请求 86.350 秒 + 研究 3 次请求 42.702 秒 + 本地处理间隙 0.706 秒。三次保存参数生成合计 35.655 秒，存在 researchIndex 填错后重新研究、practical 证据未选中等返工。此样本是自备机票的两天攻略，不是航班优先完整闭环，也不是当前性能基线或 P95。

[9 月 14 日验收](../../FLIGHT_FIRST_ACCEPTANCE.md) 则是航班比较/采用/恢复成功、攻略交付失败。两份证据不可合并宣称完整成功。

首轮纵向切片：**用户已采用航班，按预算/兴趣生成、保存、展示目的地攻略**；同时回归合法的“自备机票，只做攻略”。短中转按机场安排；复杂长中转、多日拆票、往返组合与景点地图增强后置，不通过大规模扩领域掩盖当前返工。

保持中国 LLM 约束，主模型先沿用当前 DeepSeek Flash 配置；精确 model ID、网关、研究配置和 reasoning 出站参数在实验 manifest 固定。本轮不顺便换模型、供应商或通信栈。

## 2. 职责调整：减少模型对内部事务的调度

```text
同一 CloudPlannerService
  ├─ 准备有界 PlanningContext（只读、鉴权、兼容性过滤）
  ├─ Planner：理解需求、选择研究、取舍候选、编写日程
  ├─ 领域操作：接受目标、维护 Run、展开引用、校验与保存
  └─ 发布已提交 Artifact；完成服务返回 delivery
```

以上是职责，不是强制工具 DAG。Planner 仍能澄清、跳过研究、改选活动和停止；应用不按关键词代替它理解意图。保留现有 Memory / Conversation / Trip / Artifact、用户采用航班、Goal/Run、事务和 owner/version 边界。

### 2.1 预装已有材料，不让模型反复发现状态

**B1 当前实现（2026-09-20）**：`agent/cloud/planning-context.ts` 在首次模型调用前读取 owner-scoped repository。预装最多 4 个未完成目标、20 个最近 Artifact 加最多 12 个当前兼容 Run 的工作集引用；材料仍需同 Trip/current version，未知版本和 payload/envelope 版本冲突不注入。旧 Goal 只有当前版本兼容 Run 时才进入摘要，不创建/恢复/更新 Goal 或 Run。Goal repository 现有列表查询仍读取该 Trip 全量目标；后续 Run/ref 查询和模型可见输出有界，不声称数据库扫描量已全面受限。

研究仅支持当前可保存的 v2，保留 `artifactId + finding.id`、原摘要、来源片段/authority、验证和有效期；排除过期、unverified/stale、来源引用不匹配和类别不匹配 finding。最多 4 份研究、每份 8 条，按类别轮流选取以保留 practical。覆盖只按最终留下的条目计算，列出研究日期是否涵盖 Trip、全局和逐目的地 activity/practical 缺口；缺口只表示预装未覆盖，不自动触发研究、不增加 Goal 要求。来源读取深度、未提供的 expiry 均未知。Trip 日期历史冲突标为 `needs_correction`，允许用户通过现有工具修复；不把日期覆盖当作已满足。

新增 JSON 上下文上限 24,000 个 JavaScript 字符，按完整条目裁剪并给出省略原因，保留按需读取工具；这不是 tokenizer 精确计量，也不包括已有 Trip/航班/Memory/对话历史。已保存攻略最多 2 份，每份前 8 天摘要并标记航班选择是否匹配；摘要不重新认证 delivery。预算原样保留 amount/currency/scope，当前 Trip 无 party basis，明确为 `unspecified`，不擅自拆成每日预算。禁用 Memory 不注入，已启用 Memory 沿用既有 8 KiB 限制。

`planning_context` 对话元数据只记准备耗时、字符数、条目数和省略原因，不存研究正文/Memory；它是 B5 的准备阶段局部埋点，不是模型 usage、费用或端到端计时。B3 已在保留的 finding 上附加稳定 candidateRef，仍遵守 24k 字符总界限；保存输入兼容旧索引，具体见 §3。

在 `agent/cloud/service.ts` 组装有界 PlanningContext，复用 `agent/goals/working-set.ts` 和 `artifacts/presentation.ts`，必要时拟建 `agent/cloud/planning-context.ts`：

- 当前 Trip、已选航班及 revision、明确预算口径、开启的相关 Memory 摘要；当前用户要求优先。
- 适用的未完成 Goal 摘要、当前版本可复用研究、已完成攻略摘要及候选引用。不因存在未完成 Goal 就自动激活。
- 显式列出证据覆盖/缺口：城市、日期、activity/practical、来源深度和有效期；无需模型先 list 再 read 才知道已有材料。
- 按 token/条目上限裁剪；声明被省略的内容，保留按需 read 工具。不能塞满所有历史、所有 Artifact 或跨 owner 缓存。禁用 Memory 时不注入其内容。

### 2.2 保留一次语义目标接受，收回机械记账

**B2 已实现的可选协议**：`PLANNER_LEAN_GOALS_ENABLED=true` 同时选择 lean 工具注册表和对应系统协议，默认 `false` 保留旧路径。不是模型/Provider 切换，也没有新增数据库表。

- 首个需要持久交付的业务工具附加 `intent: {kind, parameters}` 或 `goalRef: "已有Goal的UUID"`，两者互斥。intent 仅支持 `travel_guide`、`flight_search`、`trip_context_update`，参数与旧 declare_goal 共用 schema。goalRef 是选择器，不是授权凭据，须经过 owner/Trip/状态检查。研究不带 intent 可作临时查询；保存攻略必须携带或已有本轮接受的攻略目标。
- `GoalRunRepository.accept` 在领域边界原子创建/绑定 Goal 和 Run。PostgreSQL 锁 Trip→Goal→Run，并在同一事务内写入；Run 插入失败不得留下新 Goal。requestId 固定目标幂等键，requestId/generationId 固定尝试键。内存实现同步准备与提交；仍保留既有仓库测试接口。
- 本轮服务器记录目标/Run/contextVersion 和参数指纹。后续业务工具可省略 intent；重复相同意图允许，换目标引用、降低参数或跨目标种类拒绝。另一个 generation 正在运行时不接管，即使 Trip 已改；已终止尝试不得被同 generation 再激活，failed/partial 只允许新 generation 续跑。satisfied/cancelled 不接受新写入。
- 条件修改必须在接受研究/航班/攻略目标前持久化。接受后版本变化返回冲突，需要新的用户轮次；本轮不支持同轮目标修订。持久 `trip_context_update` 需一次提交所要求字段。取消或 generation 失效期间迟到的接受会关闭其自身尝试，业务执行与保存仍沿用原 workspace 检查。
- `save_travel_guide`、航班搜索/确认及持久 Trip 更新操作返回既有结果并附 `acceptedGoal`；在关闭尝试前复用工作集同步记录产物，再通过同一个 `completeGoal` 附上 `completion`，不依赖模型调用 finish。未满足要求时保持可修复的 running 尝试；保存已提交而完成存储暂不可用时保留 Artifact 引用并标记 pending。lean 工具总 timeout 在原值上增加 5 秒（上限 120 秒），自动工作集同步/验收最多 2.5 秒且预留距工具外层 deadline 至少 0.5 秒；子期限到返回 `goal_verification_timeout`，其它验收故障为 `goal_verification_unavailable`，父取消仍终止。整轮 timeout 不变；已开始的数据库事务仍依赖既有事务版本/终态保护。运行时最终答复共用同一 verifier/completion，不能依据工具名或模型文本认定成功。
- lean 注册表隐藏 `declare_goal/resume_goal/finish_goal`，保留只读 `get_active_goal` 与取消；旧注册表和持久数据读取不变。`start_route_generation` 仍是单独明确授权领域操作，不能借 intent 启动或在本轮已接受其它目标后接管。

精确公开面见 [TOOLS](../../TOOLS.md)，启用/回退见 [deploy](../../deploy.md)。本批没有新增客户端“操作类型”传参协议；现有自由文本入口由 Planner 判断意图。**卡片先于最终文本发布仍属于 B4**，不能把 B2 工具完成反馈视为前端已实现渐进展示。

## 3. 紧凑的行程决策接口

**B3 当前实现**：`save_travel_guide` 支持稳定候选引用，保留旧 `researchArtifactIds[] + researchIndex + findingId`。以下为实际字段示意，candidateRef/cityId 必须来自服务端结果。

```json
{
  "days": [{
    "day": 1,
    "cityId": "city:TYO",
    "kind": "visit",
    "theme": "街区与小吃",
    "items": [{"candidateRef": "<服务端返回的引用>", "timeOfDay": "afternoon", "planningNote": "符合慢节奏和美食偏好"}]
  }],
  "supportingRefs": ["<实用资料候选引用>"]
}
```

引用格式为 `gc1.<Artifact UUID>.<32位摘要>`，完整规范化研究 payload（含证据有效期）、owner、Trip、contextVersion 和 finding ID 参与摘要。不采用 candidateSetRef 或持久映射表；每个引用自带 Artifact 定位信息，重新读取同一资料即可重建，Unicode ID 不放大引用长度。引用是定位符，不是授权凭证；解析继续经过 owner-scoped repository、Trip/version/type/schema/id 校验，重复 finding ID 拒绝，过期证据由共享 validator 拒绝。研究输出、B1 上下文、read_artifact 均提供引用；后两者只对当前版本资料发出引用。不得信任模型自报标题、验证状态、预算或坐标。

工具适配器完成 `candidateRef → Artifact/finding`，领域层恢复事实并落盘 v1，新增可选 `supportingEvidence` 与 `budget`，新版 authored builder 标记 `agent-authored-guide-v2`。supportingRefs 也兼容 `{researchArtifactId,findingId}`；最多 50 条，与日程合计最多 20 份选中研究。支撑证据不占日程 item、不满足空白日活动要求，但参与来源/城市/日期/类别/有效期、重复资料和 Goal maxResults 检查。保存与完成复用同一校验，未选资料不进入 lineage。旧 v1 缺少新字段仍可读取，无数据库迁移。攻略卡和正式行程概览分别展示“实用与补充信息”。

预算由服务端复制 Trip 的 amount/currency/scope，附 `period:trip_total`、`partyBasis:unspecified`。输入不允许模型提交预算；新 authored guide 缺失或篡改已知预算会失败。UI 明确整次行程预算约束及机票/交通/全程范围、人数口径未指定，不换算每天或每人，不宣称支出估价。没有新增自由文本预算语义识别器；“两天总预算变成每天预算”等模型文字偏差仍须在 G1/M2 质量评估判错，即使结构化保存通过。

## 4. 错误必须指向正确的修复动作

**B3 当前实现**：引用预检和共享内容校验批量返回各阶段可判定的问题，缺少引用时附 blockedChecks，修复后再做完整内容验收。`needs_revision` 保留 issues/details，新增 repair（分类、可用候选、draftRef/revision）。最多返回 400 条 issues/details，超过时 `feedbackTruncated:true`；候选从当前 Trip 最近 20 份记录及最多 20 份输入来源补充，最多 50 条，practical 优先，`candidateSearchComplete:false` 明确非穷尽。历史日期冲突不枚举候选。无保存修复代码会自动联网。

| 类别 | 返回内容 | 执行策略 |
| --- | --- | --- |
| `draft_invalid` | 字段路径、有效候选、受影响天数 | 使用已有材料修正对应字段/天；本错误不能触发自动联网 |
| `evidence_missing` | 缺少类别/地点/日期及现有可用引用 | 已有未选中的 practical 直接补选；仅真正缺证据时研究缺口 |
| `provider_unavailable` | 工具错误 envelope 中安全的 Provider/retryAfter（若有）或超时 | 沿用同一 Research 实例现有的跨别名冷却；复用已预装或已保存成果，不得换工具名绕过；本批不新增调度器 |
| `context_conflict` | 过期版本/选择 revision | 终止旧写入、重新加载当前状态，不修补为假兼容 |

局部修订已实现 `draftRef + expectedRevision + replacementDays/supportingRefs`。每个执行上下文仅保存最后一份有界完整草稿，绑定 owner/Trip/version/generation/Goal/Run/flight selection；revision 采用比较后递增。replacementDays 只能替换已有且不重复的 day，supportingRefs 若出现则整体替换，否则保留；其余天保持原决策。每次重新恢复来源并校验全稿，成功后清除草稿。跨轮/重启/上下文改变或旧 revision 返回 context_conflict，需要当前完整输入；跨轮恢复继续读取落盘 Artifact，不声称草稿持久化。B3 在旧/lean Goal 模式均可用；关闭 B2 开关只回退目标协议，新字段依赖兼容 reader，不能把旧二进制部署当成无条件数据回滚。

## 5. 首个可操作结果与交互

扩展现有 `AgentActivity`/短轮询以传输已提交 Artifact 引用与真实阶段计数。事件不得先于事务提交，不携带思维链、工具参数、用户私密原文。轮询结果去重、owner/session/generation 失效保护继续生效。

先显示真实航班或已保存日程，再生成必要的短解释。骨架、草稿、部分和合格交付分别标记；不能用“显示研究卡”充当“首份可操作攻略”。首轮先交付完整的小范围 v1 攻略，逐日草稿若无最小可靠契约就不伪造渐进完成。

保留蓝色 UI；允许浏览已有结果、展开航段、编辑未提交草稿。影响当前执行的提交必须有取消/替代及版本策略，不能仅移除 disabled。地图/照片按已有数据展示，缺失不阻塞文字结果，不借此次优化重做视觉或引入新地图服务。

## 6. 测量位置与边界

修改时加入必要埋点；**正式测量在精简路径跑通后执行**，不先做新一轮大量付费基准。

- `runtime/model.ts`、`providers/openrouter/client.ts`：保留 request/response model、finish reason、可用 usage/费用、网关/路由标识、请求配置指纹、起止时间；未知记 null。reasoning 记录最终出站配置，敏感输入不进普通日志。
- `runtime/runtime.ts`：每次模型与工具的独立 span；研究子 span 不与父工具时长重复相加；不为每个字段再造模型审计调用。
- `travel-guides/authored.ts` / completion：首个保存、首次验证通过、修订次数和错误类别。
- 客户端：点击、接单、首份可操作航班/攻略渲染、最终渲染。端到端用同一客户端单调时钟；服务端 spans 用服务端时钟，不直接减两个设备的时间。
- 工具调用与内部 HTTP/搜索次数分开计数。供应商报告的搜索数与请求上限不一致时显式记录，不假设参数一定被执行。

详细协议和空结果表见 [EVALUATION](EVALUATION.md)。不因超时就少算失败样本，不用几次成功估计稳定 P95。

## 7. 何时考虑 DSH

截至本轮只核实项目身份：[DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness) 提供开源 Harness，README 明确标记 developer preview、可能破坏兼容；[DSH Desktop](https://github.com/dataelement/dsh-desktop) 是单独的桌面项目。查阅日期 2026-09-20，未安装或测试 SDK，未固定其 commit，不能把参考对话中的具体 SDK profile 当作已验证 API。

先运行 A/B（当前与精简）评估，**之后才决定是否值得进行 C（DSH）试验**。C 只替换 runtime/模型与工具适配，继续调用相同领域服务、同一模型/供应商/资料和 verifier；不把桌面端或通用 Shell/文件工具引入线上旅行产品。

如果 B 已达体验/质量目标，保留现有 runtime；若瓶颈仍是 Provider 等待或证据质量，换 Harness 无针对性；只有残留问题明确涉及上下文、工具协议、恢复能力或通用维护成本，才用隔离适配器做 C。C 合格后再独立决定生产迁移，并有回滚路径。

## 8. 围栏

允许修改：现有 Planner 上下文、Goal 包装、工具输入映射、共享校验、进度投影与观测适配。禁止修改：用户采用授权、事实来源、取消/版本/owner 隔离、质量阈值、无关 UI/视频工程。条件修改：新数据库表、公开工具删改、SDK 依赖和 Provider 切换需对应阶段证据与 ADR；首轮不开展这些无关扩张。
