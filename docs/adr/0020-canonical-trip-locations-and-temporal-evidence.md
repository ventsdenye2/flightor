# ADR 0020：Canonical Trip 地点复用与研究日期证据

日期：2026-09-20。状态：**已接受并实现；离线、PostgreSQL 和旧真实快照复验通过，修复后真实 Provider 与平台验收仍未完成。**

## 背景

Planner 每轮会创建新的地点 authority ledger。若当前 Trip 已持久保存 Tokyo id `8`，研究工具若只依赖本轮 `resolve_location` 结果，会把同一份服务端事实错误报告为 `LOCATION_NOT_RESOLVED`。另一方面，研究结果中的查询窗口或来源 expiry 不能证明活动实际发生日期；G1 已暴露日期错误不能靠普通来源摘要放行。

## 决策

1. `research_destination` 与共享研究执行边界在 canonicalize 前，从当前 owner-scoped Trip snapshot 将已保存的 `LocationRef` 回填本轮 ledger。该 snapshot 仍受 owner、Trip、context version 和 workspace 检查；复用只认可服务端保存的 canonical identity，不接受模型复制的名称、坐标、机场代码或任意 ID。
2. Research v2 finding 可携带可选 `temporalEvidence`，字段仅为 `from`、`to`、`sourceUrl`、`quote`。`from`/`to` 表示事件 occurrence 日期；`sourceUrl` 标识来源；`quote` 必须来自检索 snippet，并包含 1–2 个完整 ISO 日期。`queryWindow`、`expiry` 或只有模糊月份的文字不能替代 occurrence evidence。
3. 保存路径与 durable Goal verifier 共用 temporalEvidence 校验。日期绑定的 event 缺少证据、日期与 quote 不匹配或 quote 不满足格式时拒绝；`allowPartial` 不豁免此硬约束。Goal 的 `researchTypes` 必需语义保持不变。
4. 旧 Artifact 仍按兼容 reader 可读，但读取得到的旧 payload 不等于本次复验通过。当前 native research adapter 不产 temporalEvidence，因此 native finding 不能单独支持按 Trip 日期排程的 event；必须获得符合合同的来源证据或明确不能排程。

## 影响与边界

地点复用允许省去针对已存 canonical 地点的重复 provider resolve；实际调用减少量尚未通过新 live 批次测量。这一复用保持 Trip 的事实归属；它不改变跨 owner、跨 Trip 或跨 version 的兼容规则。日期证据合同让事件排程有可审计来源，但不证明来源本身真实、完整或永久有效，也不替代 provider/platform 运行验收。G1 当前仍未放行。

## 验证状态

地点复用及 temporalEvidence schema、源文校验、保存/持久完成有离线回归覆盖；完整后端 95 文件 / 745 项、PostgreSQL 7 文件 / 37 项通过。原真实 SQL 快照复验拦住错误电影节攻略，正常航班攻略仍通过，详见 [修复报告](../design/budget-travel-agent/G1_REPAIR_2026-09-20.md)。本批未重跑真实 Provider；native 适配器不产该字段的源码边界已审查，未把通用 event 缺证据回归称为 native 端到端验收。

日期证据仅验证源文绑定与日期抄录，不能证明该句谈论的日期一定属于该活动。精确日期行程按每日偏移匹配；浮动出发窗口要求活动覆盖该日所有可能日期。supportingEvidence 中的 event 也须有日期证据且与行程窗口相交。缺失/伪造证据为 guide_event_date_evidence_missing，缺排程日期为 guide_event_schedule_date_missing，日期不兼容为 guide_event_date_mismatch；不做自动付费研究修复。
