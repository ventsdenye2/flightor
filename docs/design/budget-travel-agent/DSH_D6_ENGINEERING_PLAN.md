# DSH D6 工程计划

状态：实施中；2026-10-06，Asia/Shanghai。验收标准 v1 在业务代码修改前冻结，见 [验收](DSH_D6_ACCEPTANCE.md)。附件是用户本次明确采用的任务说明；历史报告仅作证据。

## 基线及保护范围

实际执行了 status、worktree list 和 fetch origin。最新 `origin/codex/dsh-backend` 为 `f2ec6c1f75000d368d4d83b7ae6428c17dea3e0c`，与附件一致；前一代码/测试提交 `9cae53b`。main 为 `a535bb5`，不是本次 DSH 基线。主工作区已有 `project.config.json`、`project.private.config.json` 修改；保留不纳入本任务。既有 `.worktrees/dsh-backend` 及其他工作树保留。

独立目录 `.worktrees/dsh-reliability-d6`，分支 `codex/dsh-reliability-d6`，从最新 DSH remote HEAD 创建。只本地提交，不推送、合并、部署，不更改现有服务、数据、会话或账本。

## 源码诊断与修改边界

已存在官方 DSH AgentLoop、Provider 有界恢复、参数/内容分账、Goal/Run 接受及完成、candidateRef、原始证据持久化、局部 slot 合并、publication CAS；复用这些能力。

已核实缺口：`withGoalIntent` 已允许同轮省略重复意图，但 commit description、JSON schema anyOf、persona、turnState 仍强制每次 intent/goalRef；局部编辑仍要求模型抄写 baseGuideId/hash；工作区默认在工具执行时读 Trip 而非显式使用模型依据的快照；公开文本规则及纠正说明禁止预算目标中的金额。候选与地点、真实错误分类、去重边界由定向测试进一步确认，不凭提示文档推断它们已坏或已通过。

实施边界：薄 DSH 输入适配与准备快照；短引用只映射已校验材料；唯一城市身份补齐；证据与候选保留原作用域；公开错误与预算确认修复；必要的 UI 恢复小修；隔离测试/观察脚本。第一业务操作仍须真实语义 intent。编辑跨消息新建 Goal，不复活历史 satisfied/cancelled Goal。受控 Trip update 后重新准备，不把旧草稿/证据贴成新版本。

不做：第二产品 LLM、Research/Critic Agent、新 workflow/Goal/数据库真相、UI 重做、降低权限/版本/证据/发布校验、改变模型/路由/thinking/max_tokens/超时默认值。

## 实施及验收顺序

1. 冻结 v1 标准与失败台账；准备依赖、独立 loopback PostgreSQL 和 H5 环境，先观察一轮基线；不可运行时保存准确原因。
2. 原失败语义先补回归；完成快照/Goal 输入面、候选/地点、公开错误最小修复，分别跑定向测试。
3. 同一版本运行 backend check/build/test、真实隔离 test:db、DSH runtime、D5 30 场回归、相关前端 suites 和两端构建。
4. 冻结代码 SHA/源码及构建指纹、真实配置、日期；执行完整 12 固定 UI 旅程及 4 探索。代码或核心配置修订使最终批次失效，修复后完整重跑，失败不删除。
5. 只在完整冻结验收达标时 PASS；硬阻塞完成其余工作并保留准确续作入口，按层级 BLOCKED。

子 agent 使用本次明确授权的较便宜 Codex 模型，分别负责证据/地点、公开提示、隔离验收工具；这不改变产品单主 Agent 或产品主模型。

## 本轮授权及计量

附件本身未新增金额；随后用户明确授权「没有金额额度，随便调用deepseek api」。这是当前 D6 DeepSeek API 金额不限授权，适用于当前配置 DeepSeek 主模型及同供应商搜索，保留逐次准入/usage/未知费用和累计账本。不继承旧 unlimited，不扩大到购买额度、换模型/账号或其他供应商无限调用。真实 fare 使用当前实际可用且授权范围内的 provider；无有效授权或凭证记录具体缺口。所有网络与模型阶段在数据库事务外。

2026-10-06：只读核实主仓库 `backend/.env` 有现有 SerpAPI 票价账号凭据，DSH 专用配置未包含该凭据。用户随后明确授权「允许使用现有 SerpAPI 剩余额度」用于 B03/B04/B12 本轮真实航班验收，不购买、追加或切换账号。隔离 launcher 只读取该 fare key，不用主配置覆盖 DeepSeek 主模型/搜索配置；真实配额/鉴权结果及每次查询仍记录。

2026-10-06 12:40 Asia/Shanghai：使用同一 fare key 的 SerpAPI account 只读查询返回 HTTP 200，`total_searches_left=250`、`plan_searches_left=250`、`this_month_usage=0`、`last_hour_searches=0`。一条 account 查询单独记录于忽略目录 `output/d6/serpapi-allowance.log`，不是 fare lookup，不代表真实航班结果已验；未购买、追加或改变账号。实际可用性继续由正式页面查票检验。

## 观察与固定材料性能

复用 observer/日志/账本。每次保留 SHA/工作树与构建指纹、模型搜索路由/输出配置、用户输入、generation、耗时、token、search/fetch/fare、确定性补齐、参数/语义修复、错误阶段、成果/版本/publication/delivery、页面文字与截图。

分别记录受理、页面首个可读成果、终态；失败耗时单列。固定输入/固定来源在同配置同交付内容比较基线与 D6；所有样本和失败进入报告，给 p50，p95 仅描述本批。纯身份/版本/引用补齐新增 LLM=0，有效材料不得无理由重搜；新增 DB 往返/组装退化须定位。真实网络样本另列，不用 D5 历史 24.653s 作改前指标。

## 续作记录

起点：f2ec6c1；新工作树干净。待完成：定向修复、依赖/隔离数据库、页面基线及全部本版验收。后续每个里程碑在验收报告中追加命令、失败、进程与下一步，禁止以续作记录代替通过。

2026-10-06平台范围：用户在CLI实际确认服务端口关闭后明确要求先验证H5，暂不验收微信内部内容。不开启IDE安全设置；H5的12+4与所有领域/持久化/D5门槛不变，微信与真机不作本轮通过声明。

2026-10-06 续作检查点：本任务工作树为 `D:/FunnyProject/flightor-repo/.worktrees/dsh-reliability-d6`，所有命令显式使用此目录，不能因终端默认 cwd 回到 main 而修改主仓库。再次 fetch 确认远端 DSH 仍为 `f2ec6c1f75000d368d4d83b7ae6428c17dea3e0c`；当前本轮修改尚未提交。主工作区仍仅保留用户原有两份 project config 修改，旧账本 SHA-256 为 `3fdfdb12c1c3297c25548d54a53a2e4473f9f0d19c974f0f45a23afbd3d84126`。

专用 PostgreSQL 仍在 `127.0.0.1:58896/flightor_d6_validation`，用户名 `d6_test`；不重启旧服务。真实页面基线 `backend/.demo/dsh-d6-runtime/baseline-b01c` 使用归档 DSH backend、当前必要 UI 修复。B01 首次请求已到达真实模型，却因参数校验未保存攻略；后续解释、编辑均无 accepted 基底。报告/截图和全部历史初始化失败保留。其后续 turn 的旧 runner 终态耗时出现负值，相关指标无效，需用按本次提交关联的 runner 修后新批测量，不能重写原报告或宣称改前成功。

待完成：D6-09 城市缓存真实 PG 红绿回归、D6-10 跨语言基底准备与公开说明、冷重启身份读取和 runner 关联修复；收敛后运行 `npm --prefix backend run check` / build / test / test:db、runtime 和完整 D5 30。再按小批本地提交冻结源码、构建和配置，完整 H5 12+4；真实 B11/B12 冷重启、双入口和首次本地化仍不得跳过。私有 manifest/账本/登录密钥不提交。
