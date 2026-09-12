# FlightOR 活动研究实验

独立分支 `codex/model-architecture-lab`，基点 `65679d0`。当前后端从主仓实际源码冻结读取，包含未提交改动；UI 工作区与生产配置均不修改。详细设计见 [架构实验设计](../../docs/experiments/model-architecture-design.md)。

## 当前范围

16 个中文案例，Qwen 3.8 Flash / GLM 5.3 Flash / Kimi K2.6 / DeepSeek V4 Flash 四个已通过账号调用检查的模型，三方案：

| 方案 | 行为 |
| --- | --- |
| direct-web | 联网模型直接给可读候选与引用 |
| thin-web | 同样联网，要求结构化候选，普通函数验证引用与范围 |
| current-system | 冻结的真实 ProductionResearchAgent：SerpApi 搜索、一次综合、领域验证 |

默认对 direct/thin 统一 Exa；当前模型配置的 preferred 也均为 Exa。配置的引擎不一定是实际引擎，保留供应商回执。当前体系仍是 SerpApi，因而三方案比较包含搜索/证据差异；不能把差异全部归因于代码复杂度。GLM endpoint 不允许禁用 reasoning，单独固定 low 并记录 token；其他三模型请求禁用 reasoning，不能称推理预算完全相同。

这里不运行完整 Planner、航班报价、持久化、恢复或 UI；研究返回不能称为完整行程完成。100 分内容尺度在 [rubric.md](./rubric.md)，需要逐条证据评审。自动报告只给真实运行和结构诊断，不制造模型总分。

## 可复现运行

在本实验 worktree 根目录，用 Node 22 与主仓已安装的 backend 依赖：

```powershell
node --test --experimental-test-isolation=none experiments/travel-research/*.test.mjs
node experiments/travel-research/run.mjs plan
node --env-file=../../backend/.env experiments/travel-research/run.mjs preflight
node --env-file=../../backend/.env experiments/travel-research/run.mjs probe --live --cases activity-01 --out experiments/travel-research/.runs/my-probe
node --env-file=../../backend/.env experiments/travel-research/run.mjs run --live --cases activity-01 --budget-usd 5 --out experiments/travel-research/.runs/my-pilot
```

`--env-file` 只在 Node 进程内加载已配置的密钥，不输出或复制密钥文件。OpenRouter 请求固定发往官方 endpoint；SerpApi 复用现有 Provider 配置。没有额外安装实验依赖。

其他参数：`--models` 使用 models.json 中逗号分隔的完整 ID；`--arms` 接受上述方案名；`--cases` 接受 activity-01 至 activity-16；`--repeats` 为 1–10；`--baseline` 指向当前后端工作区；`--max-searches` 默认 96。不指定筛选项时计划为 16 × 4 × 3 = 192 格，**plan 不是已跑完**。

首轮使用 `--design research-screen --concurrency 2`：四模型 thin-web × 16 案例，另以现有 DeepSeek 做 direct-web/current-system × 16，共 96 格。这是同方案筛模型 + 同模型筛系统两条轴，不是所有模型/架构的完整交叉试验。GLM、Qwen、Kimi 的现有体系和完整 Planner 仍需后验；并发为 2 的结果不能直接当单用户无争抢延迟。

用户于本轮明确排除 Anthropic、Google、OpenAI。OpenAI probe 的地区 403、MiniMax M3 的 Provider 403 及 GLM 禁用推理的参数 400 均保留在旧批次；Google、Anthropic 不再发请求。模型替换不是地理限制绕过。

正式数据使用协议 v3：同一个按案例约束的 schema 生成 API response_format 和系统提示，并恢复同模型 Provider fallback。v1/v2 的格式失败保留为旧协议，不与 v3 混成一个成功率。首轮实际覆盖、统计和后续边界见 [首轮结果](../../docs/experiments/model-architecture-results-2026-09-13.md)。

当前代码的计划版本为 `research-v4-audited-controls`：收尾审查加强预算/锁、续跑配置一致性和截断状态，并补齐文本长度的 API schema 限制。v4 只做离线测试，没有付费结果；不能把本轮 v3 数据当成 v4 的真实验证。续跑还比较模型配置、引擎、并发与请求代码哈希，修改配置后应建立独立实验批次。

模型 catalog 可见不代表账号/地区可调用。不可用模型保留失败，不偷偷替换，不修改网络位置绕过地区限制。对当前地区不可用的模型，应从后续批次 `--models` 中排除。

## 预算与审计

首轮授权是 5 美元。默认所有批次共用 `.runs/budget-ledger.json`；不要另起 ledger 重置已用额度。每个请求派发前落盘预留 $0.25，获得合法 `usage.cost` 后结算。没有回执的超时/网络错误会暂停下一次派发，保留预留。明确的网关 4xx 拒绝且无 generation ID、无 choices 时保留全部预留，允许其他合法请求；不把拒绝费用写成实测 0。此规则依据 [OpenRouter 失败请求计费说明](https://openrouter.ai/blog/insights/reliability-failover/)，最终仍以账单为准。

这是本地准入预算，不是修改账号的供应商硬限额。默认 Exa 请求限制两步、十条结果、单条摘要 1500 字符、输出 3200 token；当前综合保持原实现 4000 token。原生服务未必执行相同限制，首轮只做受控 Exa 组。SerpApi 另设累计调用次数预算，套餐实际美元成本未知，报告不当作免费。

不自动重试或恢复付费请求。输出目录必须不存在，以免覆盖旧证据。台账锁避免两个 runner 同时计费；崩溃留下锁时先检查进程和回执，不盲删。台账的未知预留不能因为请求失败就释放。

`reconcile-budget.mjs` 只读请求 OpenRouter 当日 key usage，把该 key 当日全部消费保守计入准入账本，同时保留每个未知调用的 $0.25；它不证明单次失败免费。当前 UTC 日跨日、运行未结束或回执无效时停止核对。核对后只运行 `--skip-runs` 指定批次中尚未尝试的格；已失败的格也跳过。不得以新 ledger 或重复同一格掩盖失败。

本轮额外使用 SerpApi 官方只读 Account API，实测套餐为 Free Plan、月费 $0，搜索均在既有免费额度内。首轮结果中的账户快照说明此次增量支出；通用 runner 仍将未知套餐成本记录为 null，不把其他账户默认为免费。

## 产物

本轮可随 Git 提交阅读的脱敏归档在 [results/2026-09-13](./results/2026-09-13/README.md)，保存全部 106 条记录、原始可见输出、来源、费用、错误、配置及 SHA-256 索引。`export-results.mjs` 只导出已有证据，不发请求；完整后端源快照和依赖仍留在本机忽略目录。

运行数据放在忽略目录 `.runs/`：

- `manifest.json`：模型目录/价格、输入与实验代码哈希、请求预算和选项。
- `baseline/`、`baseline-manifest.json`：实际当前后端源码快照、HEAD、dirty 状态及逐文件 SHA-256；不复制 `.env`。
- `schedule.json`：固定种子打乱的计划顺序；默认串行，可显式选择最多两格并发并记录。
- `sample-*.json`：精确请求、原始可见回答、引用、错误、token/费用和时间；不存隐藏推理或鉴权头。
- `report.md`、`summary.json`：运行诊断、已跑与未跑格数；失败保留分母，样本少于 20 不报告 p95。
- `blind-review.json`、`scores-template.json`：匿名评审材料及未填的人工评分表。

结构合法和 citation-linked 都不等于事实真实。真实引用+伪造引用的混合也单列异常。澄清可以没有候选；直接文本方案的 JSON 指标记 N/A。任何额外模型修复必须成为新的明示方案并计入时延与费用，不能抹掉原始失败。

离线机械归一化消融仅处理 `thin-web`：允许提取唯一尾部 JSON fence、提取无 `{}` / `[]` / 反引号前言后的单一 JSON object，以及删除未知顶层或候选字段。其余已知字段原样保留，不补字段、不改内容、URL、日期或类别，再交给同一个 `parseResearch` 验证。聚合报告按协议、并发、模型和搜索引擎分别展示原始契约通过率与机械归一化通过率；失败、超时仍在分母中，缺少 `content` 不可修复。`direct-web` 不参与此消融。

运行 `node experiments/travel-research/aggregate.mjs OUTPUT RUN_DIRECTORY...` 可只读聚合已有批次；独立 `normalization-results.json` 保存逐样本 `rawValid`、`normalizedValid`、`transforms`、离线 `elapsedMs`、原始验证结果和归一化结果，并记录归一化代码/合同/案例哈希。原始 `sample-*.json` 不变。这里的耗时是后来离线解析与投影的耗时，不是原 live 延迟；没有额外模型调用，结构规范化也没有纠正或验证事实。

## 已核对的官方接口

- [OpenRouter Web Search Server Tool](https://openrouter.ai/docs/guides/features/server-tools/web-search)：本实验使用 `openrouter:web_search`，不是旧的 `:online` 快捷后缀。
- [Server Tool 步数限制](https://openrouter.ai/docs/guides/features/server-tools)：模型可决定是否搜索；一次 HTTP 不代表一次搜索。
- [Usage Accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)：保存响应 usage；缺失不是零费用。

API 说明、模型与价格于 2026-09-13 读取。实际 API 行为与文档不一致时保留原始回执，并以实测限制结论。
