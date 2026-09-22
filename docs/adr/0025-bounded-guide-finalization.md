# ADR 0025：有界终稿与按语言发布

2026-09-22，Accepted、已实现。用户授权发布末端局部修改；沿用主 Planner 模型、客户端、研究与 Goal/Run，不创建第二个 Agent。

终稿扩展既有 publication，按 zh/en 保存文本、具体问题和独立调用观测。原始攻略与研究保留内部审计；草稿不公开自由文本。GET/刷新仅投影持久结果，缺失语言明确准备状态；语言生成通过显式 POST，使用已接纳终稿，不重新规划或研究。验证见 [本轮报告](../design/budget-travel-agent/FINALIZATION_2026-09-22.md)。本 ADR 对新 Planner 攻略取代 0024 的来源标题公开表达；旧记录仍保留有限投影，不能追认为终稿接纳。

## 接点、权限与输入

`CloudPlannerService` 给 workspace 增加 `requireGuideFinalization`，正常业务保存先持久草稿及 `publication.finalization={version:1,variants:{}}`。主 runtime 返回后，只有本轮成功的 `save_travel_guide` / `build_travel_guide` 产物进入 `finalizeGuide`。不从通用读取、verifier、聊天或刷新启动完整终稿。原 Planner 的工具、研究 Provider、Goal 完成判断和运行流程不变；此处不再次 runTurn/run，也不向模型提供任何工具。不存在审核、润色、总结三段串联调用。

`runtime.publicationModel()` 返回实际 client、model、reasoning 配置；`GuideFinalizer` 直接使用同一实例，只设置编辑指令、JSON Schema、无工具权限、温度0、最多8000输出 token。本次实际模型仍为 `deepseek/deepseek-v4-flash-0731`，未更换供应商或模型。

初稿输入为当前原话、当前权威 Trip（含偏好/排除项、日期和预算）、已选航班、原始完整攻略（去掉公开 publication），以及引用研究记录与同 Trip/version 的其他研究；保留反证、原始 sources/snippet/page/claims/不确定性。按 Artifact id 去重，不只挑有利引用。Memory 关闭不注入 markdown；扩展研究限当前 conversation，必需来源仍来自本次已保存攻略。无工具定义、调试日志、认证参数或无关对话历史。研究是数据，系统指令明确拒绝其中的指令。

新增输入字符预算180000，不伪装精确 token；超过时不截断后送审，返回 `context_budget` 和 omitted。Trip 列表达到100条时承认可能漏掉研究并阻止全面接纳。缺引用正文/摘要、明显 practical 主活动或同主体结构化 claim 冲突直接返回具体 activityId，不调用模型；其他语义问题由模型结合完整材料判断。程序仍执行独立 schema、日/活动顺序、来源绑定和禁止表达检查。模型判断不等于独立事实认证；语言检测只拒绝错误正文，不删除字符、也不禁止原文地名。

## 持久字段与下一任务接口

- 沿用 `publication.version=1` 的 Artifact/Trip/航班及 SHA-256 绑定；新增 `finalization.version=1` 与 `variants.zh/en`。
- 每个 variant 是 `accepted|blocked`，包含 `text|null`、带 activityId 的 issues、omitted、observation。`text` 为 `locale/reply/overview/days[{day,theme}]/activities[{activityId,name,introduction,recommendationReason,sourceRefs}]`。sourceRefs 是不可变的 `sourceArtifactId/sourceFindingId` 字符串；服务器按活动原始绑定精确校验，不容许模型新造来源。
- 稳定 activityId 直接取 `guide.days[].items[].id`；不以名称或数组下标重新创建身份。程序要求完整、唯一、按原顺序覆盖全部活动，日编号也严格同序。
- `guideContentHash` 仍针对原始攻略（排除整个 publication）；本地化只原子合并 publication，不改原始活动、日期、预算、航班、Trip/workspace版本或内容 hash。原始内容改变后旧 variant 不可再接纳。
- `saveFinalVariant` 是 owner-scoped publication-only 操作，短事务内重新检查 hash、Trip及航班 revision，行锁合并不同语言，调用前后检查取消。已存在 variant 不被迟到结果覆盖。模型调用在事务外。
- 当前进程按 owner/Artifact/hash/locale 合并并发请求；持久 variant 防止刷新和后续请求再生成。沿用当前单进程临时 turn 架构，不声称支持跨服务实例分布式调用去重或崩溃续跑。多实例发布前需补持久调用租约，这不是另一个 Goal。
- `guideEnrichmentKey(record,activityId)` 为后续图片/地图提供 `{contentVersion,activityId}`。素材应独立保存/投影，不能写回原攻略散文或引起终稿失效；本轮不生成坐标或图片地址。

公开投影只返回所选 locale 的接纳文本；`status=preparing|blocked|accepted` 与 `canLocalize` 描述内容状态，不改变领域 `delivery.satisfied`。内部 variants、调用观测和 sourceRefs 不整体下发；公开来源引用沿用现有 references。接纳名称/简介/理由直接映射到 title/description/recommendationReason，后续不再退回网页标题。未接纳时 days 为空、回复为固定状态、具体问题保留；不把零内容标作 ready。

旧记录没有英文终稿时同样返回英文准备状态，不将旧中文摘录伪装成英文版本；旧中文有限投影保留兼容，不由读取自动升级。

## 多语言、取消和失败

生成请求显式 locale（后端 enum校验，旧客户端缺省zh）。GET Artifact、Workspace、消息历史支持 locale，只读恢复。`POST /v1/artifacts/:id/localization` 首次缺失语言基于已接纳终稿翻译，只用固定身份和已接纳文本；没有接纳底稿时保持准备状态，不能借此重试完整审核。前端按语言缓存，语言加入页面请求key，迟到结果只能进入对应语言缓存，不能改当前选择。已生成版本直接读取。

一次初始调用；只允许一次结构/表达修复，共享90秒上限（仍受整轮300秒剩余截止和外层取消约束）。材料/计划问题、Provider失败、超时不重试。错误/超时保留草稿和问题。取消/版本变化不接纳迟到文本；中断前已保存草稿保留，仍可能没有 variant（准备状态）。修订问题供原有 read_artifact/后续用户修订读取；不自动回调 Planner、改 Goal 或偷偷联网。

独立 phase名为 `guide_finalization`、`guide_finalization_repair`、`guide_localization`；variant记录耗时、调用数、prompt/completion token、已知微美元费用、未知费用调用、失败码和修复原因，默认API日志另记独立终稿观测。取消后无可提交 variant时仍有调用观测。不能将未知费用当作零。失败回退不暴露原始模型回复；禁止占位正文接纳。

真实烟测入口 `backend/scripts/verify-guide-finalization.mjs`，默认 dry-run。用户本轮新增明确 US$2；执行需 `FINALIZATION_AUTHORIZED_USD=2`，只允许现有 OpenRouter 模型端点，禁止搜索。固定新账本 `.demo/guide-finalization-20260922/ledger.json` 自动续用、最多12模型调用；原两份账本仅记 hash 并验证未改动。复用现有预留计费器，未知费用仍占用预留，不绕过费用上限。输入为原公开合同测试留存的完整研究 fixture，不是新规划/真实微信端到端验收。

首批真实失败保留：12k token 被计费器拒绝（未出站），修改为8k；45秒共同窗口内两种语言各触发一次修复后超时，4次出站中2次未知费用继续占用预留。根据本次实测将终稿共同上限调整为90秒，仍受整轮300秒剩余时间与取消限制；不宣称提速。runner 增加安全输出诊断和等待已取消请求结算，避免账本锁清理先于请求完成。先前退出进程41180的锁经检查进程不存在后归档，账本调用原样保留。
