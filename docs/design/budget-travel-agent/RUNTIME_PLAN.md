# 当前修改方案：先精简 FlightOR，再以实测决定 Harness

日期：2026-09-20。状态：**分步实施中：B0/B1 已落地，其余待实现**。本批实现只读上下文预装及离线验证；未跑真实模型评测或安装 DSH。逐项证据见 [progress](progress.md)。

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

`planning_context` 对话元数据只记准备耗时、字符数、条目数和省略原因，不存研究正文/Memory；它是 B5 的准备阶段局部埋点，不是模型 usage、费用或端到端计时。未改公开工具 schema；`save_travel_guide` 仍使用现有索引输入。以下列表保留方向，未实施的紧凑引用等见 B3。

在 `agent/cloud/service.ts` 组装有界 PlanningContext，复用 `agent/goals/working-set.ts` 和 `artifacts/presentation.ts`，必要时拟建 `agent/cloud/planning-context.ts`：

- 当前 Trip、已选航班及 revision、明确预算口径、开启的相关 Memory 摘要；当前用户要求优先。
- 适用的未完成 Goal 摘要、当前版本可复用研究、已完成攻略摘要及候选引用。不因存在未完成 Goal 就自动激活。
- 显式列出证据覆盖/缺口：城市、日期、activity/practical、来源深度和有效期；无需模型先 list 再 read 才知道已有材料。
- 按 token/条目上限裁剪；声明被省略的内容，保留按需 read 工具。不能塞满所有历史、所有 Artifact 或跨 owner 缓存。禁用 Memory 时不注入其内容。

### 2.2 保留一次语义目标接受，收回机械记账

目标是消除常规链路中的 get→resume/declare→finish 模型往返，不是移除持久 Goal。

- 已授权 UI 动作（例如“按已选航班生成攻略”）可携带服务端校验的操作类型和选择 revision，在领域边界创建/恢复匹配的 Goal/Run。客户端声明不替代 owner、上下文和用户授权校验。
- 自由文本仍由 Planner 判断。首个业务工具调用可携带紧凑 `intent` 或服务端提供的 `goalRef`；程序校验并原子接受目标、绑定本次 Run，再执行该操作。意图不清先澄清，不用 regex 选择目标。
- 接受后的目标约束在本次执行固定；工具不能借重新声明目标降低要求。另一个 generation 的 running Run 不被接管；改需求须明确新修订。
- 保存成功后由现有 completion 服务验收、更新 Goal/Run，并发布结果；不再要求模型决定“是否调用 finish”。模型可以读取未满足项继续修正；最终自然语言不阻塞已保存卡片。
- 迁移先加 feature flag 与兼容适配。目标为快速路径注册表隐藏机械 Goal 工具，兼容路径仍可读历史目标；不能同时出现两套完成权威。具体工具公开面必须同步 TOOLS/ADR 与测试。

## 3. 紧凑的行程决策接口

保持 `save_travel_guide` 业务职责，拟议新版输入使用稳定候选引用，不要求模型抄写 `researchArtifactIds[] + researchIndex + findingId` 的双层位置关系。

```json
{
  "candidateSetRef": "server-issued-set",
  "days": [{
    "day": 1,
    "cityRef": "server-issued-city",
    "theme": "街区与小吃",
    "items": [{"candidateRef": "candidate-17", "slot": "afternoon", "reason": "符合慢节奏和美食偏好"}]
  }]
}
```

这是拟议契约示意，不是当前可调用格式。候选 ID 为服务端集合内唯一、不依赖数组位置的引用，绑定 owner、Trip、contextVersion、证据版本与有效期；缓存/重启后可重建同一映射。不得信任模型自报来源、标题、票价或坐标。候选只表达可选择的资料，不代表证据已完全核实。

领域层完成 `candidateRef → Artifact/finding → 原有持久 payload` 映射。优先在现有 guide v1 可表达范围内落盘，**不以完整 visits v2 为首轮前置**。practical 可以在紧凑输入里单列 `supportingRefs`；映射保留独立资料语义，不能把交通提示硬塞为景点，也不能删掉该类覆盖要求。若 v1 reader 无法表达，采用最小可选字段扩展并测试旧数据，而非启动全量 schema 重写。

预算以结构化 amount/currency/scope/party basis 为权威；展示总预算不从模型散文抽取。发现“两天总预算变成每天预算”等语义偏差必须在质量评估中判错，即使 schema/Goal 通过。

## 4. 错误必须指向正确的修复动作

共享校验一次报告所有**当前可判定**问题；缺少引用导致不能判断的检查标为 blocked，不能声称已完成全部验证。

| 类别 | 返回内容 | 执行策略 |
| --- | --- | --- |
| `draft_invalid` | 字段路径、有效候选、受影响天数 | 使用已有材料修正对应字段/天；本错误不能触发自动联网 |
| `evidence_missing` | 缺少类别/地点/日期及现有可用引用 | 已有未选中的 practical 直接补选；仅真正缺证据时研究缺口 |
| `provider_unavailable` | Provider 身份、冷却/超时与可用成果 | 相同适配器跨工具共享冷却；允许部分交付或停止；不得换工具名绕过 |
| `context_conflict` | 过期版本/选择 revision | 终止旧写入、重新加载当前状态，不修补为假兼容 |

局部修订拟用 `draftRef + expectedRevision + replacementDays/supportingRefs`；只替换指定天，服务端重验整份受影响不变量。保留未修改日程和航班。先实现最小同轮 draft，不为了局部修复建立新工作流引擎；跨轮恢复仍以落盘 Artifact 为准。

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
