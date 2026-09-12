# 研究 Provider 离线纵向集成，2026-09-13

首轮评测已独立提交为 `f3906e3ab785f46bbf48b68d1a4d23837b6cfac1`。后续在同一实验工作树实现了可注入真实 ResearchAgent 接口的薄适配器，并验证真实服务、Runtime、工具、内存仓库和服务端交付规则。主工作树、生产配置及微信适配工作树均未在本阶段修改；没有启动共享服务或占用验收端口。

本阶段新增 API 费用为 **$0**。Qwen/GLM 的 32 条输入均取自首轮已付费并归档的 v3 回执，不是第二轮真实调用。

## Provider 边界

适配器负责一次研究请求的结构转换、来源关联、领域 schema 和原始审计；实际预算/HTTP/取消由注入的 transport 负责。artifact 保存、Trip 版本、Goal/Run 归属、恢复与完成验证仍属于现有领域服务。没有增加固定业务工作流或模型修复重试。

以主工作树当时的 287 个后端文件创建冻结副本，SHA-256 摘要为 `48a972b50c1065098a6b7e60561ae4534178e760c66ee4f0d637e5f84715cc1c`，每次加载前校验。实验分支基于旧提交，故不直接导入该分支的旧后端。冻结副本及完整依赖不随 Git 提交；清单保存于结果归档，node_modules 只读共用且未完整冻结。

来源及转换原则：

- 复用首轮机械归一化，不补造内容或引入额外模型调用。
- 只接收 annotations 中确实存在且元数据符合要求的引用。长来源标题/片段可做有记录的摘录；候选事实不截断修补。
- 来源不合格会排除候选并保留原因；澄清请求保留不确定性，不生成推荐。
- 继续使用当前领域来源与核实策略；单纯 URL 关联不会成为 `verified`。`partially_verified` 仍只是当前策略标签，不证明事实准确。
- 搜索次数缺失、冲突、越界或模型未结束时明确失败。完整审计先落盘，成功返回不等于已经落库或完成交付。

## 录制样本的领域转换

下表只衡量同一批回执能否转换为领域结果，不是内容质量排名；空的澄清 artifact 也计入合法 artifact。

| 模型 | 样本 | 合法 artifact | 非空 artifact | 空澄清 artifact | 候选数 | 部分核实 / 未核实 / 已核实 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Qwen 3.8 Flash | 16 | 15 | 13 | 2 | 55 | 20 / 35 / 0 |
| GLM 5.3 Flash | 16 | 13 | 12 | 1 | 57 | 23 / 34 / 0 |

Qwen 的 `activity-14`、GLM 的 `activity-08` 因研究输出合同失败而拒绝。GLM 的 `activity-13/14` 原始回执没有搜索次数；即使回答是在澄清，也不能推断搜索次数为零。两模型各排除 6 条来源不合格的候选，分别记录 7/10 处来源摘录。

这比首轮“JSON 经转换后 15/16 通过”要求更严格：计费回执、来源字段、领域长度和核实边界同样决定能否落入领域合同。每个失败仍保留原始证据和完整审计。

## 真实领域链路与验证

使用实际 `CloudPlannerService`、`AgentRuntime`、工具注册表和 Goal verifier。每个夹具都有独立 owner、Trip、conversation、Goal、Run 与内存仓库；Planner 由显式离线脚本驱动，通过真实工具输出取回 artifact 引用。未加载服务器入口、数据库或生产环境变量。

全套 **67/67 离线测试通过**：首轮实验控制 45 项、薄 Provider 12 项、真实领域集成 10 项；没有取消、跳过或待办用例。Provider 测试包含审计保存失败、保存期间取消的排他写入边界，以及不响应取消信号的 transport 晚到结果。

10 项集成场景覆盖：两种候选模型配置的研究保存与 lineage；未核实证据不能完成攻略；独立合成双来源证据可保存攻略并由 `finish_goal` 确认 satisfied；格式失败保留审计且不落库；父请求取消、持久化 Goal 取消与 Trip 改版时拒绝晚到写入；显式恢复新 Run，通过 `read_artifact` 复用旧研究且不再次调用 Provider；owner 及来源隔离；未注入 transport 时禁用调用。

合成正向场景只证明现有服务的合法交付链路可达。两个 example 域名触发现有部分核实策略，没有获取或证实旅行事实。恢复测试保留旧 artifact 的 Run 归属，新攻略通过 sourceArtifactIds 关联旧证据，不重标历史记录。

32 条录制回执已逐条经过相同的真实领域链路，32 个 owner 与仓库相互隔离；代码和原始来源摘要在回放前后不变，网络尝试为 0。

| 模型 | 研究落库 | Provider 拒绝 | 攻略保存 | 服务端 satisfied |
| --- | ---: | ---: | ---: | ---: |
| Qwen 3.8 Flash | 15/16 | 1 | 0 | 0 |
| GLM 5.3 Flash | 13/16 | 3 | 1 | 1 |

这里的 0/1 不是模型自主规划胜率。脚本把候选按天分配到第一个目的地，没有根据核实状态优化选择，也没有多城市规划能力。保留这些拒绝是为了验证证据、每日覆盖和目的地匹配会真正阻止错误交付；不能把脚本选择缺陷解释为模型能力差异。

唯一成功为 GLM `activity-02`：[完整样本](../../experiments/research-provider/results/2026-09-13/backend/samples/sample-022.json) 记录真实研究、路线与攻略均归属于当前 Goal/Run，攻略引用路线和研究，`save_travel_guide=saved`、`finish_goal=satisfied`、最终 `delivery=satisfied`。其 3 项研究仍为部分核实，成功依赖此夹具显式允许部分结果，不能当作旅行事实已核实。

常见攻略保存拒绝包括证据资格不足 21 次、每日活动覆盖不足 18 次、practical 类别覆盖不足 11 次、activity 类别覆盖不足 7 次；同一样本可有多项原因。3 条空澄清 artifact 均被攻略验证拒绝。4 条 Provider 失败没有保存研究。

完整证据见 [Provider 回放](../../experiments/research-provider/results/2026-09-13/provider/provider-replay.json)、[后端回放](../../experiments/research-provider/results/2026-09-13/backend/backend-replay.json) 和 [67 项测试回执](../../experiments/research-provider/results/2026-09-13/verification/all-offline-tests.tap)。原始审计、每条真实工具输出与领域记录均随提交保存。

## 仍需完成的生产接线

1. 当前生产模型客户端需透传 server tool 的 annotations、结束状态与计费/搜索次数；将其接入既有预算与取消边界后才可真正替换 Provider。
2. 原始审计需正式持久化并与最终 workspace artifact ID 关联。适配器生成 ID 在领域保存时会被替换，当前实验通过 artifact warning 中的 audit.id 回溯；这尚不是生产审计索引。
3. ResearchAgent 接口目前只有 brief 和偏好，没有完整原始请求；领域 artifact 没有 typed disposition/uncertainties。本阶段用完整审计和显式警告防止信息静默丢失，后续需补齐正式合同。
4. 使用新案例和真实 Planner 测首个有用结果、完整交付时间与内容质量，另验 PostgreSQL 并发/恢复及微信端表现。本阶段不能替代这些验收。

首轮 $5 预算继续沿用原账本：保守已知 $1.197637、未知预留 $2.25，本阶段未新增调用或释放未知预留。没有更换生产默认模型、合并、推送或部署。移植时应只移植实验提交，不能整体合并包含旧后端基线的实验分支。
