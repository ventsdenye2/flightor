# ADR 0025：有界终稿与按语言发布

2026-09-22 收尾：针对 `main@a67ed77` 的三项修复已通过定向离线与数据库回归，见[收尾记录](../design/budget-travel-agent/FINALIZATION_FOLLOWUP_2026-09-22.md)。本批不进入概览/卡片 UI、地图、图片或全量 G1 验收。

2026-09-22，Accepted、已实现。用户授权发布末端局部修改；沿用主 Planner 模型、客户端、研究与 Goal/Run，不创建第二个 Agent。

终稿扩展既有 publication，按 zh/en 保存文本、具体问题和独立调用观测。原始攻略与研究保留内部审计；草稿不公开自由文本。GET/刷新仅投影持久结果，缺失语言明确准备状态；语言生成通过显式 POST，使用已接纳终稿，不重新规划或研究。验证见 [本轮报告](../design/budget-travel-agent/FINALIZATION_2026-09-22.md)。本 ADR 对新 Planner 攻略取代 0024 的来源标题公开表达；旧记录仍保留有限投影，不能追认为终稿接纳。

## 接点、权限与输入

`CloudPlannerService` 给 workspace 增加 `requireGuideFinalization`，正常业务保存先持久草稿及 `publication.finalization={version:1,variants:{}}`。主 runtime 返回后，只有本轮成功的 `save_travel_guide` / `build_travel_guide` 产物进入 `finalizeGuide`。不从通用读取、verifier、聊天或刷新启动完整终稿。原 Planner 的工具、研究 Provider、Goal 完成判断和运行流程不变；此处不再次 runTurn/run，也不向模型提供任何工具。不存在审核、润色、总结三段串联调用。

`runtime.publicationModel()` 返回实际 client、model、reasoning 配置；`GuideFinalizer` 直接使用同一实例，只设置编辑指令、JSON Schema、无工具权限、温度0、最多8000输出 token。本次实际模型仍为 `deepseek/deepseek-v4-flash-0731`，未更换供应商或模型。

初稿输入为当前原话、当前权威 Trip（含偏好/排除项、日期和预算）、已选航班、原始完整攻略（去掉公开 publication），以及引用研究记录与同 Trip/version 的其他研究；保留反证、原始 sources/snippet/page/claims/不确定性。按 Artifact id 去重，不只挑有利引用。Memory 关闭不注入 markdown；扩展研究限当前 conversation，必需来源仍来自本次已保存攻略。无工具定义、调试日志、认证参数或无关对话历史。研究是数据，系统指令明确拒绝其中的指令。

新增输入字符预算180000，不伪装精确 token；超过时不截断后送审，返回 `context_budget` 和 omitted。Trip 列表达到100条时承认可能漏掉研究并阻止全面接纳。缺引用正文/摘要、同主体结构化 claim 冲突直接返回具体 activityId。practical 来源绑定到非 travel 日的普通主活动时提前指出 invalid_plan；已有 day.kind=travel 或 item.category=practical/stopover 的交通事项进入现有模型语义检查，不能只凭来源 practical 类型拒绝，也不能借角色豁免伪装文化主景点。程序仍执行独立 schema、日/活动顺序、来源绑定和禁止表达检查。模型判断不等于独立事实认证；语言检测只拒绝错误正文，不删除字符、也不禁止原文地名。

活动 name 与 reply、overview、theme、introduction、recommendationReason 一起执行内部叙述、预算保证、精确费用/耗时、门票/营业时间、URL 等已有表达限制。正文语言判断仍允许原文地名；不按字符删除另一语言。逐项占位检查替代整份 every 检查，一次修复后仍占位的活动分别返回带 activityId 的 missing_material，不接纳部分空壳。

## 持久字段与下一任务接口

- 沿用 `publication.version=1` 的 Artifact/Trip/航班及 SHA-256 绑定；新增 `finalization.version=1` 与 `variants.zh/en`。
- 每个 variant 是 `accepted|blocked`，包含 `text|null`、带 activityId 的 issues、omitted、observation；追加可选 revision（旧结果默认1）和 history（此前尝试的原始结果及观测，最多2条）。`text` 为 `locale/reply/overview/days[{day,theme}]/activities[{activityId,name,introduction,recommendationReason,sourceRefs}]`。sourceRefs 是不可变的 `sourceArtifactId/sourceFindingId` 字符串；服务器按活动原始绑定精确校验，不容许模型新造来源。
- 稳定 activityId 直接取 `guide.days[].items[].id`；不以名称或数组下标重新创建身份。程序要求完整、唯一、按原顺序覆盖全部活动，日编号也严格同序。
- `guideContentHash` 仍针对原始攻略（排除整个 publication）；本地化只原子合并 publication，不改原始活动、日期、预算、航班、Trip/workspace版本或内容 hash。原始内容改变后旧 variant 不可再接纳。
- `saveFinalVariant` 是 owner-scoped publication-only 操作，短事务内重新检查 hash、Trip及航班 revision，行锁合并不同语言，调用前后检查取消。仅可重试失败接受 revision+1；accepted 不可覆盖。存储层自行追加 history，不信任调用方提供的历史。重复/迟到 revision 返回409，历史费用不清空。模型调用在事务外；未能提交的调用仍通过既有独立观测记录。
- 当前进程按 owner/Artifact/hash/locale/retryRevision 合并同次并发请求；只有 accepted 可永久复用，普通请求对 blocked 只读，不自动调用。沿用当前单进程临时 turn 架构，不声称支持跨服务实例分布式调用去重或崩溃续跑。数据库比较版本保证跨实例只有一份结果接纳，但不能阻止跨实例重复付费调用；多实例发布前需补持久调用租约，这不是另一个 Goal。
- `guideEnrichmentKey(record,activityId)` 为后续图片/地图提供 `{contentVersion,activityId}`。素材应独立保存/投影，不能写回原攻略散文或引起终稿失效；本轮不生成坐标或图片地址。

公开投影只返回所选 locale 的接纳文本；`status=preparing|blocked|accepted` 与 `canLocalize` 描述内容状态，不改变领域 `delivery.satisfied`。新增 failureKind=accepted|retryable|revision_required、revision（未生成为0）、canRetry；仅 timeout/cancelled/provider_failure/format/language 且未耗尽次数为可重试，其余及混合材料问题需修订。内部 variants、历史、调用观测和 sourceRefs 不整体下发；公开来源引用沿用现有 references。接纳名称/简介/理由直接映射到 title/description/recommendationReason，后续不再退回网页标题。未接纳时 days 为空、回复为固定状态、具体问题保留；不把零内容标作 ready。

旧记录没有英文终稿时同样返回英文准备状态，不将旧中文摘录伪装成英文版本；旧中文有限投影保留兼容，不由读取自动升级。

## 多语言、取消和失败

生成请求显式 locale（后端 enum校验，旧客户端缺省zh）。GET Artifact、Workspace、消息历史支持 locale，只读恢复。`POST /v1/artifacts/:id/localization` 请求为 `{locale, retryRevision?}`；首次缺失语言基于已接纳终稿翻译，只用固定身份和已接纳文本；没有接纳底稿时保持原状态，不能借此重试完整审核。显式重试必须携带当前失败 revision（1或2），过期/不可重试/耗尽返回409；已有 accepted 无论重复请求还是刷新都直接复用。前端按语言缓存，仅 accepted 或无发布状态的其他 Artifact 可缓存；blocked/preparing 不缓存。localizeArtifact 的 context.retryRevision 供下一任务显式按钮使用，传输 retry=0；相同身份/语言/重试版本合并并发 POST，同语言旧 GET/POST 响应被 superseded 拒绝，不能更新缓存或作为当前请求结果返回。语言切换不改当前选择，owner/session 切换仍拒绝旧响应。

每次尝试一次初始调用；只允许一次结构/表达修复，共享90秒上限（仍受整轮300秒剩余截止和外层取消约束）。Provider失败、超时不自动重试；每个内容hash/locale最多两次显式技术重试，即最多3次尝试、每次最多2次模型调用。材料/计划问题不可重试，只能走既有修订。错误/超时保留草稿和问题。取消/版本变化不接纳迟到文本；中断前已保存草稿保留，仍可能没有 variant（准备状态）。修订问题供原有 read_artifact/后续用户修订读取；不自动回调 Planner、改 Goal 或偷偷联网。

独立 phase名为 `guide_finalization`、`guide_finalization_repair`、`guide_localization`；variant记录耗时、调用数、prompt/completion token、已知微美元费用、未知费用调用、失败码和修复原因，默认API日志另记独立终稿观测。取消后无可提交 variant时仍有调用观测。不能将未知费用当作零。失败回退不暴露原始模型回复；禁止占位正文接纳。

真实烟测入口 `backend/scripts/verify-guide-finalization.mjs`，默认 dry-run。用户本轮新增明确 US$2；执行需 `FINALIZATION_AUTHORIZED_USD=2`，只允许现有 OpenRouter 模型端点，禁止搜索。固定新账本 `.demo/guide-finalization-20260922/ledger.json` 自动续用、最多12模型调用；原两份账本仅记 hash 并验证未改动。复用现有预留计费器，未知费用仍占用预留，不绕过费用上限。输入为原公开合同测试留存的完整研究 fixture，不是新规划/真实微信端到端验收。

首批真实失败保留：12k token 被计费器拒绝（未出站），修改为8k；45秒共同窗口内两种语言各触发一次修复后超时，4次出站中2次未知费用继续占用预留。根据本次实测将终稿共同上限调整为90秒，仍受整轮300秒剩余时间与取消限制；不宣称提速。runner 增加安全输出诊断和等待已取消请求结算，避免账本锁清理先于请求完成。先前退出进程41180的锁经检查进程不存在后归档，账本调用原样保留。

## 2026-09-22 正式 UI 接续

上述“供下一任务按钮使用”的接口已接入正式概览、每日行程及详情。包括缺失语言首次生成在内，页面挂载、刷新、轮询和语言切换只读，不自动 POST；用户明确点击准备/重试才进入既有本地化接口。重试前强制读当前状态，要求 canLocalize 与 canRetry 同时成立且 revision 匹配。语言/owner/session 与同步点击去重保护保留。accepted、preparing、retryable、revision_required、legacy、stale 分开展示，不将领域 satisfied 当作正文可发布。公开终稿字段及业务版本不变；新增的可选只读 enrichment 是后续地图/图片接入位置，不生产素材。映射与平台证据见 [正式页面报告](../design/budget-travel-agent/PUBLICATION_UI_2026-09-22.md)。
