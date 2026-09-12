# ResearchAgent 薄适配器：离线纵向验证

在独立实验分支内，把第一轮的联网研究候选转换为真实领域 `ResearchArtifact v2`，再通过真实 `CloudPlannerService → AgentRuntime → tools → 内存仓库 → Goal delivery` 验证保存边界。这里不装配生产服务、不读取 `.env`、不访问数据库、不启动端口，也不调用模型或搜索 API。

第一轮代码和 106 条记录已保存于提交 `f3906e3ab785f46bbf48b68d1a4d23837b6cfac1`。本目录只使用其中 Qwen/GLM 正式 v3 的 32 条原始回执；原始证据保持不变。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `thin-research.mjs` | 可注入 ResearchAgent 槽位的适配器；单次 completion、机械归一化、领域 schema 与来源策略、完整审计；没有 HTTP 客户端或持久化 artifact 的权限 |
| `baseline.mjs` | 只读冻结另一工作树的后端源码，逐文件 SHA-256 校验后通过 tsx 加载；不执行本实验分支的旧版后端 |
| `planner-integration.mjs` | 显式脚本 Planner 驱动真实服务、Runtime、工具、内存仓库；每次夹具独立 owner/Trip/Goal/Run |
| `replay.mjs` | 回放 32 条原始回执，检查 Provider 转换；逐请求保存审计，逐样本保存结果 |
| `backend-replay.mjs` | 同批回执经过真实领域工具与交付验证；脚本选取攻略内容，只用于测试调用契约 |
| `export-results.mjs` | 校验旧证据、源码摘要、逐请求/逐样本持久化记录及测试回执后导出；不复制环境、后端快照或依赖 |
| `results/2026-09-13/` | 随 Git 保存的离线回放、测试、源码摘要和证据索引 |

## 适配器契约

`createThinResearchAgent` 接受真实领域 schema、`classifyResearchSourceAuthority`、`verifyResearchFinding`，以及 `model`、`complete` 和必需的 `saveAudit`。返回 `research(brief, {requestId, signal, preferenceSummary})`。

`complete({body, signal, timeoutMs})` 必须返回完整的 assistant message、annotations、finishReason 和可解释的搜索次数回执。只接收 `finishReason=stop`。搜索次数必须来自明确的 `searchCalls` 或供应商 usage 字段，缺失、冲突或越界都失败，不猜测为零。这里没有默认 transport；预算、HTTP、真实取消、账户可用性和用量核对仍属于 transport。

`saveAudit` 必须在适配器返回 artifact 之前按 audit.id 保存完整原始回执、请求、转换、未采纳项与不确定性。此审计描述 Provider 的生成过程；artifact 是否成功保存及 Goal 是否完成由下游领域服务判定。若保存期间发生取消，拒绝返回 artifact，同时保留已经写入的生成审计。回放使用每次执行独占的输出目录及排他写入文件。

来源仅从真实 annotations 关联；不得补造 URL、摘要或标题。长来源标题/片段按领域长度上限摘录，保留全量原文和明确摘录记录；候选事实标题/摘要不截断修复。来源不合格则排除整条候选，保留原因并将结果标记为 partial。澄清回答不会变成推荐。领域验证函数保持原策略，片段只能获得 `unverified` 或 `partially_verified`；适配器拒绝 `verified`。

截止时间会向 transport 发出取消信号，及时结束取决于 transport 是否响应。适配器会拒绝晚到结果；真实 Runtime 和工具的取消、Goal 终态、Trip 版本检查继续控制最终写入。这不是独立硬超时实现。

## 离线运行

需要已安装的后端依赖，不执行安装。先从需要验证的工作树冻结源码；目标目录必须不存在：

```powershell
node experiments/research-provider/baseline.mjs D:\FunnyProject\flightor-repo
node --test --experimental-test-isolation=none experiments/research-provider/*.test.mjs
node experiments/research-provider/replay.mjs experiments/research-provider/.runs/new-provider-replay
node experiments/research-provider/backend-replay.mjs experiments/research-provider/.runs/new-backend-replay
```

默认快照为本目录 `.cache/backend`；可使用 `FLIGHTOR_LAB_BASELINE` 指定另一份已校验快照。输出目录存在时拒绝覆盖，不自动续跑或重写旧证据。

本次冻结主工作树当时的 287 个后端文件，包括未提交修改，摘要为 `48a972b50c1065098a6b7e60561ae4534178e760c66ee4f0d637e5f84715cc1c`。源码只在本机忽略目录保留；Git 保存清单和摘要。其他机器重新冻结后须比较摘要，不能把另一基线的结果视为精确复现。已安装 node_modules 通过 junction 只读共用，锁文件有摘要，依赖字节未完整冻结。

## 解释边界

这批回执原先由完整用户请求加 brief 生成；当前 ResearchAgent 接口只收到 brief 和偏好，回放不会测量新提示下的生成质量。脚本 Planner 的工具选择和按天分配逻辑不是生产编排，不证明真实模型自主规划、事实正确、PostgreSQL 并发、微信端或完整在线 E2E。测试及两种回放没有新增 API 费用。

尚未实现生产接线：当前生产模型客户端需保留联网 annotations 和计费回执，审计需正式持久化并关联最终 artifact，disposition/uncertainties 也需可表达的领域接口。本实验用警告和独立审计保留这些信息，不将警告字符串冒充已完成的生产协议。

结果说明见 [离线集成报告](../../docs/experiments/research-provider-integration-2026-09-13.md)。后续应基于当前主分支移植本实验提交，并在合并前复验基线；不应把本实验分支的旧后端整体合并回去。

本轮归档为 136 个文件，其中 135 个内容文件列入 `sha256-index.json`（索引自身除外）。64 份独立审计与 64 份逐样本回执完整保留；原首轮归档 148 个内容文件哈希未变。目录级 Git 属性固定 JSON/MJS/Markdown/TAP 的 LF 换行，避免 Windows checkout 改变证据摘要。
