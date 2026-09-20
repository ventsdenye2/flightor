# B0 基线 A：现状指纹与返工诊断

更新：2026-09-20。本文完成 DPS B0 的基线记录，冻结 B1 开始修改前的 A 源码和已有历史证据；不是本批修改后的当前实现说明，也不构成新的付费运行授权。

## 1. 可复现基线

本次读取时仓库状态如下：

| 项目 | 值 |
| --- | --- |
| Git branch | `main` |
| `HEAD` | `9954c34cb7812122afdfe00bd0f8a867d0e3e718` |
| 业务源码 diff | 未发现 `backend/src`、`src` 或其它业务源码改动 |
| 工作区状态 | 文档治理相关既有修改，以及大量未跟踪的文档、归档和检查脚本 |
| 基线性质 | 当前工作树基线；不是干净 checkout，也不是精简实现 |

当前已修改（`git status --short`）的既有文档包括 `docs/README.md`、`docs/PROJECT_CONTEXT.md`、`docs/DOCS_MAINTENANCE.md`、`docs/TOOLS.md`、架构/部署、历史验收、交接和实验报告等；未跟踪内容包括 `AGENTS.md`、`docs/archive/`、`docs/adr/0018*`、`docs/adr/0019*`、`docs/design/budget-travel-agent/` 及 `scripts/check-docs.cjs`。因此本文件不能把工作树描述为只有 A 业务实现，也不能把当前大量文档改动归因于 B0。

本文件只新增于 `docs/design/budget-travel-agent/BASELINE_A.md`。它没有读取或记录任何密钥、令牌、完整配置值、登录信息或供应商私密响应，也没有发起付费模型、联网研究或实时 Provider 调用。

## 2. A 业务源码 SHA256 指纹

以下哈希由当前工作树文件内容使用 PowerShell `Get-FileHash -Algorithm SHA256` 计算。复核时应在同一路径对同一文件重新计算；任何源码修改都应使相应指纹变化。

| 文件 | SHA256 |
| --- | --- |
| `backend/src/agent/cloud/service.ts` | `F1374B046ACFCBFD5A50DDF740D5A0CBDE8B3A66A279AA91D686ADF0522E2802` |
| `backend/src/agent/goals/working-set.ts` | `C77CD6B8A1EF3B34EEDD8BC3EE372398B010C803476EEF08C940CAE6ECAA6E4A` |
| `backend/src/agent/goals/completion.ts` | `ED64722089A117F6ACB13D3ED5D1681A1E90951FEEBB504773C7A59FAEAB1F92` |
| `backend/src/agent/tools/goals.ts` | `56B0DC8441BC7408124ECCD65DEFF033CD28756ED80CD2F6D4734792C325FE8E` |
| `backend/src/agent/tools/core.ts` | `22D8DF3FE3FBED4747F3BF69C1CC7FFEBEC01A1A22C2CB451F129465CE8D0F26` |
| `backend/src/agent/tools/travel-guide.ts` | `BD063A29D7175BCE46FF7B0E013A6E46C24FA56528091CD21DF04B66F1EBFF31` |
| `backend/src/agent/tools/authored-travel-guide.ts` | `D8FECE1C14B76CB11A40D5DBBA6B49281C24237B2D94C83A5853AA5DE79F80D9` |
| `backend/src/travel-guides/authored.ts` | `A0553F4C848F153C0F255D710D320582A6AB62F0147E32BA734C22F6FDC3C02C` |
| `backend/src/travel-guides/validation.ts` | `972B1AFF4D56F057D61A7E949F618CF21FB5DBAC508FBAB7CA49002D884D37F9` |
| `backend/src/research-agent/types.ts` | `B047717B3C79703598FFF050CC55580FA119A21A5034E43275B7B343AE401071` |

哈希是当前源码内容指纹，不等于已运行证明；它也不包含运行时模型、路由、环境变量或 Provider 配置值。

## 3. A 基线职责和可观察边界（B1 修改前）

基线 `CloudPlannerService` 把 Trip、选中航班、对话历史和启用的 Memory 组装进 Planner 上下文，再调用同一个 `AgentRuntime`。它把工具 trace、artifact 引用、warnings 和 `GoalDelivery` 写入对话元数据。基线允许 Planner 自主选择 `get_active_goal`/`resume_goal`/`declare_goal`、研究、保存和 `finish_goal`；冻结时 RUNTIME_PLAN 中的有界 PlanningContext、语义目标接受和收回机械记账均未实施。后续 B1 改动见 [运行方案](RUNTIME_PLAN.md) 和 [进度](progress.md)，不能用本节覆盖当前状态。

`goals.ts` 将 Goal/Run 的 owner、Trip、context version 和运行中冲突交给服务端校验；`finish_goal` 通过 verifier 完成，而模型叙述或单纯工具技术成功不能直接满足 Goal。`working-set.ts` 只负责去重并合并 artifact/location 引用，尚未提供 B1 所需的完整预装上下文。

当前攻略入口仍是 `researchArtifactIds[] + researchIndex + findingId`。`saveAuthoredTravelGuide` 在保存前加载研究 Artifact、解析 finding、构造 route/guide，并调用 `validateGuideContent`；索引错误、城市/来源/证据 lineage、日期、研究类型、每日覆盖等问题返回 `needs_revision`，验证不通过时不写入攻略。技术执行返回成功与业务结果 `needs_revision` 是两个不同层次。

## 4. 历史证据拆分

### 模型判断

`CALL_ANALYSIS_2026-09-13_TOKYO.md` 记录一次自备机票东京攻略：11 次 DeepSeek Planner 请求、3 次 Qwen 研究请求，总后端整轮 129.758 秒。Planner 在第一次保存退回后又决定发起研究；随后读取已有材料并修正保存参数。这里能证明模型做出了这些工具选择和修正路径，不能证明选择是最短、最优或在其它案例稳定复现。

### 工具执行

该东京记录把 14 次外部请求和 11 个本地工具调用按序列出：第一次研究 HTTP 200 但合同校验失败；第二次研究接受 4 条结果；第三次研究 HTTP 429；第三次保存才创建路线和攻略。`FLIGHT_FIRST_ACCEPTANCE.md` 则记录真实航班查询、比较、用户采用、服务端持久化和刷新恢复均成功，但提交攻略后研究限流，未生成 `travel_guide`。

### 保存拒绝与最终交付

东京样本的第一次保存因 `guide_research_index` 退回，第二次因 `guide_research_type:practical` 退回，第三次保存成功。前两次 trace 的技术状态为成功，但业务状态是 `needs_revision`、没有 artifact；不能把技术成功计作攻略保存成功。最终 Goal `satisfied` 只说明既有 verifier 接受了落盘结构及其覆盖合同。

### 研究缺口

东京样本只有片段级来源证据，未证明对应日期的营业时间、门票、交通耗时或汇率；最终内容还把“两天总预算 1500 元”漂移成“每天预算”，现有 verifier 未拦截。航班优先验收没有攻略 Artifact，且最新研究在限流后失败。两份记录都不能合并成“完整端到端成功”。

## 5. 原始证据缺失和性能声明边界

当前工作区缺少东京分析引用的四个 `.demo` 诊断文件（脱敏时间证据、保存验证证据及两个只读脚本），因此本次只核对报告内嵌统计和当前源码，不能重新计算原始账本。东京报告本身也说明没有客户端点击到绘制日志、首 token/流式数据、供应商排队和逐条数据库耗时；`129.758 秒` 是该历史样本的后端整轮口径，不是可泛化的用户端延迟。

因此，当前不存在可声称的 A 性能基准、稳定 P95、总体成功率、成本基线或模型/Provider 最优组合。EVALUATION 规定的 A/B 多案例、固定输入、失败计入分母、同口径重复和费用/路由指纹尚未运行。历史单次样本只能用于定位返工与证据问题，不能作为 B 的提速百分比，也不能授权新的付费调用。

## 6. B0 结论与后续边界

B0 已固定 A 的 HEAD、branch、脏树范围和关键业务源码指纹，并确认最直接的返工点是：Planner 先发现已有材料不足、再研究；保存输入使用易错的数组索引；保存校验逐次暴露索引和类型缺口；技术执行状态与业务保存结果容易被混淆；预算口径不在当前攻略验收合同内。

这些结论支持 B1 优先建立有界、鉴权、版本绑定的 PlanningContext，并在 B3 处理稳定候选引用和一次性错误分类；它们不证明应立即切换模型、Provider 或 DSH，也不证明应放宽证据校验。任何性能收益必须等精简路径跑通后按 EVALUATION 重新测量。

## 7. 复核入口

- [DPS](DPS.md)：B0–B5 与 G1–G3 的唯一顺序。
- [RUNTIME_PLAN](RUNTIME_PLAN.md)：拟议 PlanningContext、目标接受、保存和观测边界。
- [EVALUATION](EVALUATION.md)：A/B 案例、失败分母和性能指标协议。
- [CALL_ANALYSIS_2026-09-13_TOKYO.md](../../CALL_ANALYSIS_2026-09-13_TOKYO.md)：历史东京调用与保存回放诊断。
- [FLIGHT_FIRST_ACCEPTANCE.md](../../FLIGHT_FIRST_ACCEPTANCE.md)：航班优先真实验收及攻略失败边界。
