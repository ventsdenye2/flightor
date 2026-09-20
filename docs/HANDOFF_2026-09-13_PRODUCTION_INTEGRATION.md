> **历史记录（2026-09-20 归类）：下文工作区、命令、进度、费用和验收只适用于记录当时；不作为当前执行入口。现状见 [PROJECT_CONTEXT](PROJECT_CONTEXT.md)，当前计划见 [DPS](design/budget-travel-agent/DPS.md)。**

# 2026-09-13 生产集成交接（本地验证）

> 后续日期修复、真实修改验收及测试结果见
> [2026-09-13 续作交接](HANDOFF_2026-09-13_CONTINUATION.md)。下文保留原始阶段证据。

## 开始工作前先读

权威顺序：`FLIGHTOR_ARCHITECTURE.md` → 已接受 ADR → `TOOLS.md` → `PROJECT_CONTEXT.md` → 本文。此次决策见 `adr/0016-native-research-production-integration.md`；后端细节另见 `HANDOFF_2026-09-13_NATIVE_RESEARCH.md`。

用户要求节省 Codex token、积极使用便宜子 agent，账户额度剩约 3% 时写好交接并准备停工。不要为了达到阈值继续耗用额度。用户最初要求微信真机验收，已在本机填入 WX_APPID/WX_SECRET；随后明确改成**先在本地运行，不要求此轮配置 HTTPS**。密钥仅确认存在，尚未证明真实微信 code 交换成功。

用户已明确授权将合成东京行程发送 OpenRouter 验证；此前自动审批拒绝已获得用户补充授权，**不需再次索要同一授权**。最后又授权“5 美元测试费用重置，之后不必特别在意费用”：新开第二轮 $5，不删除第一轮账目或未知预留。Codex token 配额与 OpenRouter 美元预算分开。

## 工作区与保留点

- 主仓：`D:\FunnyProject\flightor-repo`，基线提交 `c604bf4343ba5c5c3d19adc4d5da2c7e6c7f8c19`，129 个文件。保留原开发成果，无 push。
- 原 UI：`.worktrees/ui-experience`，UI 提交 `09f02e73aa12e4c04bf454d9962924bec9334180`、`060d0debe08e121e22a88695a31aa67ad1929af5`。不要覆盖原工作区。
- 原研究实验：`.worktrees/model-architecture-lab`，提交 `f3906e3ab785f46bbf48b68d1a4d23837b6cfac1`、`2dc88414c32e4030f1f2447877c2a60b63bd150e`。
- **本轮所有集成修改**：`.worktrees/production-integration`，分支 `codex/production-integration`。从主仓基线创建，依次 cherry-pick 为 `80c5271`、`d8cfcdf`、`f0ddbaf`、`8fdf679`；没有整体合并旧实验 backend。
- 三个 node_modules 是已有依赖的目录联接。不要对联接执行删除或重新安装。
- 实际业务集成尚未整体合并回主仓；后续先验收，再决定合入。

## 用户确认的界面基准（非常重要）

用户提供截图是微信中**里斯本 → 每日行程 → D2「在老城里，慢慢走」**：日期横栏、地图标记、活动列表、底部规划/探索/行程/我的。

对应现有 `src/features/ui-experience/TripExperience.tsx`、`DayPlan.tsx`、`AppExperience.tsx`，**不是旧版 AgentChat，也不是新版 PlannerPage 首页**。本轮先后展示错了两个首页，用户两次纠正，之后已使用现有组件打开正确 D2 页面。不要再把规划首页声称为截图对应页面，不要另拼另一套产品界面。

原 UI **固定样例**直达地址是 `http://127.0.0.1:4179/?page=trip&tab=days`，已实际核对打开 D2「在老城里，慢慢走」。根路径 `/` 仍可访问其他样例页面；`/live.html` 是新加的本地真实业务验证入口。网页 Leaflet 与微信腾讯地图的渲染有差异，不能用网页图钉点击替代真机证据。样例仍保留；真实页面不得借用里斯本照片/坐标/票价填空。

## 已落地的改动

1. 后端可配置 native ResearchAgent：默认仍 SerpApi；仅 cloud Planner 的研究槽可选 OpenRouter Qwen/GLM。保留 DeepSeek Planner、Discovery、机票服务与 Goal 完成边界。原生请求带动态 strict schema；GLM 必须 low reasoning；单次请求，不做格式修复重试。
2. Migration 012 增加共享美元预算和生成审计。每次研究分配独立 generation UUID，数据库原子预留/结算；未知费用保留预留，超过预留记录失败并冻结额度。USD 小数保守向上转换为微美元，保留原始 usage。
3. 研究 Provider 不保存业务 artifact。workspace 保存时在同一 PostgreSQL transaction 关联 audit 与最终 artifact，检查 owner/Trip/Conversation/Goal/Run/context/status；取消、过期和回滚不能留下 delivered 标记。
4. `productionPresentation.ts` 纯转换真实 route + guide，严格检查关联。读取 `verification.sources` 与 provider/reference，保留部分核验/过期；不冒用城市中心作为活动坐标，不虚构日期、人数、照片、票价。只有当前 context 且对应 guide 的服务端 delivery satisfied 才显示完整状态。
5. `productionTripService.ts` 读取同 Trip 和 routeArtifactId 的攻略，避免串入任意旧攻略。Plan 通过现有 chatStore/认证/轮询收发；新 UI 默认入口可返回经典规划。详情复用原 TripExperience，修改跳转到**该行程**的规划记录。
6. 日程 route/guide 已由服务端自动保存，不能写入仅支持 optimized_routes 的 savedRoute 选择接口。日程详情不提供假的收藏/本地修改；原航班路线的选择保存保留。
7. 本地 Vite 验证入口复用生产 stores，浏览器实现 Taro request/storage/navigation；本地测试登录走真实 API/JWT/PG，不伪造 wx.login 或 bearer token。原 CJS connectivity 通过仅用于预览的桥接复用。样例入口不与真实数据混用。

## 本机服务与重启

工作目录统一在 integration，**不要使用旧 demo 数据库或端口**：

- PostgreSQL：`127.0.0.1:15432`，数据库 `flightor_integration_20260913`；数据在 `backend/.demo/pgdata`。基线 001–011 与 migration 012 已实际应用。
- API：`http://127.0.0.1:3011`；`/health/ready` 已返回 PG ok、Redis disabled_local。
- Vite：`http://127.0.0.1:4179/`（原 UI 样例），`http://127.0.0.1:4179/live.html`（真实业务本地验证）。旧 UI 的 4178 不要占用/停止。
- 配置：integration `backend/.env.demo`，被忽略，不提交。仅 loopback / development 可用本地登录。WX 配置从主仓 `.env` 同步，绝不打印密钥。

在 integration 的 backend 目录启动 API：

```powershell
node --env-file=.env.demo --import tsx scripts/local-integration-server.mjs
```

在 integration 的 apps/ui-preview 目录启动浏览器预览：

```powershell
node node_modules/vite/bin/vite.js --mode live
```

Vite live 模式禁止 export/build，只绑定 loopback，只将现有本地登录 key 注入本机 dev bundle，不注入 WX_SECRET、OpenRouter key 或整个 env。服务 fs.allow 显式涵盖 src/cloud/依赖联接，避免重启后源代码 403。

PG 二进制复用已有 `C:\Users\VENTSDENYE5\AppData\Local\Temp\flightor-pg16-20260908-01a07e88\pgsql\bin`，不修改该目录旧 data。重启本轮 PG 可使用 pg_ctl 的 `-D <integration>\backend\.demo\pgdata -o "-h 127.0.0.1 -p 15432"`。进程后台启动用 `Start-Process -WindowStyle Hidden`；**不要加 -Wait 等待 PostgreSQL 整个进程树**。随机数据库密码留在被忽略的 `.demo/pg-password`。本轮创建的 PG/3011/4179 可在确认没有验收请求执行后停止。

## 费用、证据与尚未完成的验收

第一轮实验已知 $1.197637138、未知预留 $2.25，合计准入 $3.447637138。本次第一轮本地验证另有 6 个 DeepSeek 请求，已知 $0.00168488；Qwen 研究请求 HTTP 429，没有 generation id/usage，继续保留 $0.50。旧合计准入 $3.949322018；**未知不是零费用**。

用户新增第二轮 $5。全局 Planner+Research ledger 位于 `.demo/live-integration-ledger-round2.json`，native DB budget id `integration-20260913-round2`，两者是同一批费用的不同控制层，**不得相加计费**。旧 `.demo/live-integration-ledger.json` 和旧 DB budget 不变。第二轮先试 GLM 超时，最终使用 Qwen 成功；不得据此推导 Planner 模型排名。当前 `.env.demo` 的 `LOCAL_INTEGRATION_BUDGET_ROUND=2`，Research 为 `qwen/qwen3.8-flash`，Planner 为 `deepseek/deepseek-v4-flash-0731`；provider `allow_fallbacks=false`，不启用被用户禁止的模型。

第一轮真实链路已验证浏览器本地登录、空白 Trip 建立、真实 Planner 更新 context/Goal、HTTP 429 失败提示与费用保留；**尚未得到 guide artifact，不是端到端成功**。合成测试数据：东京 2026-10-12 至 13、上海出发、1 人、每天一个文化景点、机票自行处理、不调用航班搜索，允许部分核验但必须显示不确定信息。真实微信登录与手机安全区/键盘/地图仍未验收。

日志与回执（均被忽略，不当成源码提交）：

- `backend/.demo/live-receipt-*.json`、`live-round2-receipt-*.json` 与全局 ledger；包含合成模型请求回执，不含认证头。早期 launcher 未按轮次区分回执文件名，第二轮前五次覆盖了第一轮同名 raw 回执；第一轮 ledger 的 generation id/usage/费用仍保留，但前五份完整 raw 消息不能声称完整留存。命名问题已修复，第二轮回执已整理到独立前缀。
- `backend/.demo/integration-db-evidence.json`：Trip/Goal/Run/artifact/audit 实际数据库状态。
- `backend/.demo/integration-frontend-final-tests.log`：前端 npm test 退出 0。
- `backend/.demo/integration-backend-tests.log`：全量 Vitest 两次卡在 RUN/collection，没有可靠通过数，已中断；另含成功 typecheck。

已通过：根 TypeScript、前端 npm test、原展示数据 26 项、production converter 8 项行为测试；backend typecheck、native/client 原有 15 项单测、4 项真实 PG budget/audit/link 事务测试。最后 framing 修复后的 native 单文件为 7/7，backend typecheck 再次通过；样例直达参数改动后根 TypeScript 与 converter 8/8 也再次通过。全量 backend suite 与预览专用 typecheck 曾无输出长时间阻塞，不能写“全部检查通过”。本轮新代码尚需重新构建微信目标；真实 guide 的网页渲染/刷新恢复见末尾补记。

## 下一位先做什么

1. 读取本文末尾最终验收补记、git status、两轮账本、DB evidence；确认进程和分支，不重复消耗已经失败/未结算的请求，不 reset 账目。
2. 优先修复日期事实一致性：用户要求 10 月 12–13 日、两天，现有 Trip context 和页面显示返程 14 日。沿用户输入 → context update → route/guide → completion 检查日期约束，不用 UI 减一天掩盖领域错误；保留现有失败证据，并核实早期失败后仍 running 的 GoalRun 应如何终结。
3. 已实现 TripExperience/DayPlan 消费真实 guide、未知坐标空态、来源状态与刷新恢复。下一轮验证从详情回到对应行程后修改生成新 immutable artifact、取消/换账号隔离；不要重复搭建另一套 UI。最后 framing 修复仅离线验证，后续必要真实请求可顺带验证，不必为重复证明已保存攻略单独付费。
4. 修正或定位全量测试 collection/worker 阻塞，再跑受影响 suite；预览 shim 与小程序独立检查，网页通过不代表微信通过。
5. 尚存架构缺口：非 2xx raw HTTP 回执目前被共享 fetchJson 转为 AppError，原始 429 只在验收外层 meter 中完整保留，生产 audit 未保留完整 raw HTTP body；需要运输层提供错误回执，而不是放宽 domain 校验。日程详情直接局部修改/通用对话取消尚未形成已验收闭环。
6. 确认准备发布/部署时再配置 HTTPS 和微信 request 合法域名，使用真实微信登录与手机验收；本轮用户明确先本地，不催其配置。

## 最终验收补记

收尾时 Codex 账户额度剩约 5%，已进入停工交接；不为达到 3% 阈值额外消耗。第二轮 ledger 共 19 个请求：已知费用 **$0.034120684**，GLM 超时未知预留 **$0.50**，本轮累计准入 **$0.534120684 / $5**。没有运行中的付费请求；不自动续跑。费用重置是新一轮额度，未清除旧账。

### 本轮真实成功证据

合成输入经浏览器真实本地登录、真实 Planner、Qwen 原生联网研究、PG artifact 保存与服务端完成检查，最终生成攻略；未注入假 token、预置攻略或回放代替调用。证据快照 `backend/.demo/integration-db-evidence.json` 时间为 `2026-09-12T21:07:12.858Z`（本机 9 月 13 日）：

- Trip：`01a09762-033d-711a-ab6f-85adc017966a`，context version 1。
- 当前 Goal：`01a0976f-3280-70f3-a1a7-c1485ceb2b0e`；当前 Run：`01a0976f-328e-7670-b358-12086396fb28`，均 `satisfied`。
- research：`01a09770-0094-768c-b76a-5df5d0f54050`；route：`01a09771-4442-7198-87f4-6931eb0ae4eb`；guide：`01a09771-4451-718e-a88a-2bf856069741`，关联一致。
- native audit：`1c2f5fca-8af1-488f-858e-8738712932cb`，`succeeded`，结算 15105 微美元，`delivered_at=2026-09-12T21:04:54.950Z`。
- 服务端 delivery：`status=satisfied`、`kind=travel_guide`、`missing=[]`，仍有 `warnings=[evidence_partially_verified]`。这证明交付协议链路，**不证明全部事实正确或产品完全验收**。

真实结果地址：`http://127.0.0.1:4179/live.html#/pages/route/index?artifactId=01a09771-4451-718e-a88a-2bf856069741`。浏览器已打开 D1 浅草寺与街区、D2 上野公园与博物馆，活动坐标/照片缺失显示空态；来源面板五项均显示部分核验，点击来源实际复制 `https://www.japan-guide.com/e/e3004.html`。刷新后同一 guide 从 API 重新加载，恢复原结果；日标签回到默认概览，不声称保存了临时 UI 标签状态。页面保留服务端原始英文介绍，尚未验收中文表达和描述事实质量。

### 明确未完成

- **日期偏差**：请求 12–13 日，已保存 context 的返程为 14 日，页面同时显示两天。此问题没有在 UI 偷改；完整用户需求一致性尚未验收。
- 首次失败留下的 Goal `01a09762-6643-703c-b02c-075b5adb00aa` 为 `pending`，Run `01a09762-6658-77c0-81b8-5b166faf06ef` 为 `running`。不能将“当前 Goal 成功”写成全部旧任务均终结。
- 首次 Qwen prose+JSON 被拒，后一次研究成功；最后补入只接受唯一 prose/JSON suffix 或单一最终 JSON fence 的 framing normalization，并保留严格字段与歧义拒绝。7/7 离线测试通过，**成功付费调用发生在补丁之前，补丁没有再次付费验证**。
- 预览仍有 Taro 属性映射的 React 警告；原生专有页面/能力不完整。此 launcher 只放行 OpenRouter chat endpoint，因此真实微信 code 交换、SerpApi、实时机票请求不能用该 launcher 证明可用。
- 全量 backend suite、预览专用 typecheck、集成分支微信构建、真实微信登录与手机地图/键盘/安全区，以及直接修改/通用取消闭环仍待验收。

最新后端补丁已重启加载，保留本轮 PG/3011/4179 服务供用户本地查看；未修改或停止原 UI 的服务。本提交仅保存当前集成分支成果，未合并主仓、未 push。提交号在当前分支执行 `git log -1 --format=fuller` 查询，避免文档嵌入自身 SHA。
