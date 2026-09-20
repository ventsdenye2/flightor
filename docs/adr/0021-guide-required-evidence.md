# ADR 0021：区分探索范围与必需证据类别

2026-09-20。已接受并实现，离线 758 项及专用 PostgreSQL 37 项通过；修复后真实 Provider 与平台尚未验证，本批结果及阶段耗时见 [progress](../design/budget-travel-agent/progress.md)。

## 原因与决策

G1 中 Planner 把希望探索的 event 写入 Goal `researchTypes`，现有验收将其作为必须交付项，继而产生补查与错误排程。研究请求与交付约束需要显式区分，而不能在保存失败后放宽既有目标。

攻略 Goal 新增可选 `requiredEvidenceTypes`。显式提供时，它是必需证据类别，必须为 `researchTypes` 的子集；此时后者表示本目标的探索范围，并不要求每种探索类别都有结果。显式空数组表示没有额外类别覆盖要求，仍保留每日内容、预算、城市、数量、证据有效性、航班与日期等约束。缺字段时严格沿用旧合同：所有 `researchTypes` 均必需。不得给该字段设空默认值、迁移旧 Goal，或从 Research Artifact 的 brief 反推用户要求。

Goal 领域的 `requiredGuideEvidenceTypes` 是唯一兼容解释函数，共享攻略验证器在保存与 durable completion 中使用；工具反馈与只读 planning context 也用同一个函数展示有效要求。研究工具的 brief 保持独立查询请求，不会改写或扩大已接受 Goal。所有参数仍参与 fingerprint、幂等及同轮不可变约束；减少 requiredEvidenceTypes 同样属于改变目标。

## 边界

这是结构化意图合同，不是自然语言理解证明。Planner 仍可能错误判断用户的必需类别，后续需真实链路验收；不引入关键词分类、自动删约束或新 Agent。旧 Goal/Run 不更新，新旧参数共用 JSON 存储，无 SQL 迁移。回滚旧代码前须考虑新参数无法被旧 strict schema 读取，不能声称可无损直接回滚。

可选 event 一旦被选入攻略，仍须满足 ADR 0020 日期证据门槛。`allowPartial` 不能豁免必需覆盖。只读摘要不接受、激活或修订 Goal。旧错误攻略继续按旧必需项失败，不将修改旧验收样本称为真实成功。

## 验收要求

覆盖新探索范围缺可选 event 的保存与完成、旧及显式必需 event 缺失、显式空类别仍有每日覆盖、可选 event 选入后的日期检查、同轮降低必需项被拒绝，以及 PostgreSQL 保存/恢复保留两个字段。离线、数据库、真实 Provider 和平台证据分别记录。
