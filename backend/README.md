# FlightOR Backend

FlightOR 的独立自部署后端，使用 Fastify、TypeScript、PostgreSQL/Kysely 和 Worker。
当前公开 Planner 自行选择与组合领域工具；领域服务提供事实、校验和持久化。
User Memory、Conversation、Trip Context、Artifacts 保持独立。

权威契约见 [FlightOR Architecture](../docs/FLIGHTOR_ARCHITECTURE.md)、
[Tool Registry](../docs/TOOLS.md)、
[ADR 0010](../docs/adr/0010-domain-owned-planning-workflows.md) 和
[ADR 0011](../docs/adr/0011-verified-delivery-and-workspace-consistency.md)。
历史兼容接口不再决定新 Planner 的状态或编排。

## 1. 配置

在仓库根目录执行：

```powershell
Copy-Item backend/.env.example backend/.env
```

已有配置时直接编辑现有文件。真实密钥只写入 `backend/.env`、服务器环境变量或部署平台
Secret Manager；不要提交到 Git 或注入小程序。

基础配置：

- `DATABASE_URL`
- `REDIS_URL`；开发环境可显式 `REDIS_ENABLED=false`，生产禁止关闭 Redis
- `JWT_SECRET`：至少 32 字符，每个环境独立
- `ADMIN_API_TOKEN`：启用管理同步接口时设置，通过 `X-Admin-Token` 传入

业务 Provider：

- `WX_APPID` / `WX_SECRET`：微信 code 登录
- `AERODATABOX_API_KEY` / `AERODATABOX_BASE_URL`：航空领域能力
- `SERPAPI_KEY`：真实航价及网页搜索
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`：代码默认 `deepseek/deepseek-v4-flash-0731`，运行环境可覆盖
- `PLANNER_MODEL` / `RESEARCH_MODEL`：为空时继承 `OPENROUTER_MODEL`
- 可选 OAG：`OAG_FLIGHT_INFO_KEY`、`OAG_CONNECTIONS_KEY`、
  `OAG_SCHEDULES_KEY`、`OAG_MASTER_DATA_KEY`

航空和航价事实由服务端 Provider 归一化，模型提供的名称、坐标、时区或价格不能替代权威事实。
共享 OpenRouter 适配器按模型能力处理 reasoning；V4 系列的业务 `none` 转为
`enabled:false`，模型选择与请求参数兼容性集中在配置/适配层。密钥存在不代表余额、订阅、
模型或端点当前可用。`/health/providers` 只报告配置状态，固定 `verified=false`。

## 2. 本地运行

需要 Node.js 22+、PostgreSQL，以及默认启用的 Redis。完整容器方式在仓库根目录运行：

```powershell
docker compose up -d --build
```

在宿主机开发：

```powershell
docker compose up -d postgres redis
cd backend
npm install
npm run migrate
npm run dev
```

另开终端：

```powershell
cd backend
npm run dev:worker
```

默认 API 为 `http://localhost:3000`，接口说明为 `/docs`。最小健康检查：

```powershell
Invoke-RestMethod http://localhost:3000/health/live
Invoke-RestMethod http://localhost:3000/health/ready
Invoke-RestMethod http://localhost:3000/health/providers
```

`live` 只证明进程存活；`ready` 检查数据库和启用的 Redis；二者均不验证付费 Provider。
演示配置与运行记录见 [DEMO_STATUS.md](../docs/DEMO_STATUS.md)。现有
`backend/.env.demo` 可配合构建后的 `npm run demo:api` / `npm run demo:worker` 使用；
启动 API 不会替代 Worker 执行持久任务。

## 3. 当前 API 与交付语义

Trip、Conversation、Artifact、Memory、Planner 和 route-generation 接口均由 JWT 确定 owner：

```text
Authorization: Bearer <access-token>
```

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/health/live`、`/health/ready`、`/health/providers` | 进程、依赖就绪及 Provider 配置状态 |
| POST | `/v1/auth/wechat`、`/v1/auth/refresh` | 微信 code 登录、Refresh Token 轮换 |
| POST/GET | `/v1/trips` | 创建 owned Trip、查询云端行程 |
| GET | `/v1/trips/:id` | 读取 owned Trip |
| PUT | `/v1/trips/:tripId/context` | 按 expected version 更新 Trip Context |
| POST | `/v1/conversations` | 创建绑定 owned Trip 的 Conversation |
| GET | `/v1/conversations/:conversationId`、`/v1/conversations/:conversationId/messages` | 恢复 Conversation 与消息 |
| POST | `/v1/agent/converse` | 当前唯一 Planner 对话入口，返回 compact context、Artifact refs 与 delivery |
| GET | `/v1/trips/:id/workspace` | 恢复消息、Artifact refs、后台 run 和服务端 delivery verdict |
| GET | `/v1/artifacts/:id` | 按 owner 读取完整 Artifact |
| GET/PUT | `/v1/memory` | 独立的用户 Markdown Memory |
| POST | `/v1/flight-searches` | 认证手动航班搜索，与 Agent 共用 fare/Artifact domain service |
| POST | `/v1/trips/:tripId/route-generation-runs` | 显式创建路线生成 run，要求 `Idempotency-Key` |
| GET/DELETE | `/v1/route-generation-runs/:id` | 查询进度与结果、协作取消 |
| GET | `/v1/countries`、`/v1/airports` | 国家/机场检索 |
| GET/PUT | `/v1/users/me/transit-country-preferences` | 当前用户 preferred/excluded 中转国家 |
| POST | `/v1/reachability/query` | 日期级 `reachable / unreachable / unknown` |
| POST | `/v1/admin/sync/oag/location`、`/v1/admin/sync/oag/route` | 显式创建管理同步任务 |
| GET | `/v1/admin/jobs/:id`、`/v1/admin/sync-runs/:id` | 管理任务/同步执行状态 |

Planner 请求严格为：

```json
{
  "tripId": "<owned-trip-id>",
  "conversationId": "<conversation-bound-to-trip-id>",
  "message": "本轮用户原文"
}
```

客户端不回传旧 `state`、messages 数组、recommendations 或路线事实。服务端读取持久会话和
Trip；回复包含 `conversationId`、`tripId`、`reply`、`tripContextSummary`、
`artifactRefs`、`suggestedActions`、可选 `memoryChanged`、`warnings`、
`stopReason` 和 `delivery`。完整 Artifact 单独按 ID 获取。

Agent 可选择、跳过、重复或调整工具顺序；没有固定“目的地 → 日程 → 研究 → 攻略”流程。
需要持久交付时声明 typed Goal，使用 `finish_goal` 获取领域反馈；模型结束回复时，runtime
还会校验本轮涉及的 Goal，因此漏调 `finish_goal` 不会绕过完成校验。
`get_active_goal` 只读取旧目标；接受其条件继续执行需显式调用 `resume_goal`，
用户修改目标条件时由 Agent 声明新 Goal。

`delivery` 包含整体及逐 Goal 的 `status`、`artifactIds`、`missing`、`warnings`，
并在适用时带 `goalId` / `kind`。状态为
`not_requested | pending | satisfied | partial | failed | cancelled`：

- `stopReason=completed` 仅用于服务端验证的 `delivery.status=satisfied`。
- `responded` 表示普通文本回应，没有 durable delivery 请求，对应 `not_requested`。
- 未完成 Goal 使用 `goal_pending | goal_partial | goal_failed | goal_cancelled`。
- 超时、模型失败、取消等运行时退出保留自己的 stop reason，并另带 delivery verdict。

领域 verifier 检查持久 Artifact 的 schema、owner/Trip、当前 run、版本、来源 lineage、
接受的机场/日期/目的地和天数覆盖。证据已验证与业务已完成是不同结论；仅有 Artifact、
错误日期的报价或缺日攻略都不能满足完整请求。模型的成功措辞不是完成证据。

显式 `finish_goal` 和收尾校验共用 `src/agent/goals/completion.ts`。
`GoalRunRepository.commitCompletion` 在 PostgreSQL 事务内依次锁 Trip、Goal、Goal run，
复查 owner/scope、revision、版本和终态规则，然后一起提交两个 planning 状态。
不能改回两个独立 update，也不能让迟到成功覆盖取消或终态。

所有产出路径通过 `src/artifacts/workspace.ts` 冻结服务端读取的 Trip version，在外部调用后
及写入前复查版本、取消和运行身份；Artifact insert transaction 再检查 Trip/Goal/run。
来源可跨 Goal/run 复用，但必须同 owner、同 Trip、同 context version。无版本或旧版本
Artifact 可作为历史读取，不能直接用于当前组合；现阶段没有跨版本兼容策略，
返回 `ARTIFACT_CONTEXT_VERSION_MISSING` 或 `ARTIFACT_CONTEXT_VERSION_MISMATCH`，
由 Agent 重新规划，不能给旧证据贴上新版本。

研究领域先将问题分配为至多 8 个目的地/问题检索任务。可选的
`ResearchQueryPlanner` 只改写短检索词；任务覆盖、目的地、日期和来源限制仍由领域及
Provider adapter 控制。计划无效时保留原问题检索并记录 warning，不增加调用预算。
检索并发上限为 2；计划、检索和综合共享取消信号，原始问题保留在 brief 中供综合与审计。

航班和路线的原始时间戳保持不变。Artifact API 的 `presentation.airportTimes` 按
JSON pointer 提供服务端 `AirportTimeView`，Agent 读取和前端卡片使用同一投影。
有权威机场时区时显示当地时间及 UTC offset；缺少时区时明确标注 UTC 或时区未知，
不依赖浏览器所在时区推断。

### 显式路线生成

生成按钮的 POST body 为 `{ conversationId?, expectedTripVersion? }`，记录 `button`
授权；当前用户明确要求生成路线时，Planner 的零参数 `start_route_generation` 共用同一
领域服务并记录 `explicit_user_message`。讨论、建议、准备状态和模型推断不构成授权。
同幂等键和同请求返回原 run，不同请求复用键则冲突。Planner 不暴露内部连接搜索、
完整路径规划、优化或路线报价确认工具。

run 状态为 `queued → running → succeeded|failed|cancelled`。Snapshot 不可变，但不是继续
使用旧条件写入的许可：排队或运行中发现当前 Trip 版本变化时，attempt 以
`TRIP_CONTEXT_VERSION_CONFLICT` 失败，新条件需要新 run。已经完成后才发生的编辑可使历史
结果变为 stale，历史版本和 provenance 保留。路线 run 的 `succeeded` 只表示执行结束；
业务是否 satisfied/partial 仍由共享领域校验和 planning Goal/Goal-run 原子提交决定。

当前路线引擎支持一个 canonical airport 起点、一个最终 visit destination 和有限出发窗口。
返程窗口、多 visit 城市、往返组合、required ground legs 显式 unsupported，不截断成伪完整
路线。报价/Provider 部分失败保留明确状态，不编造航班或价格。

### 手动搜索与兼容接口

`POST /v1/flight-searches` 要求 `Idempotency-Key` 和严格的
`{ tripId, conversationId, origin, destination, departureDate, departureDateTo?,
returnDate?, currency?, travelClass? }`；单机场对，出发窗口最多 31 天。
服务端建立 workspace，调用与 Agent 相同的 `src/fares/search-service.ts`，
返回 `artifactRef` 和 compact summary。当前前端提交精确日期；价格确认产生不可变后继
Artifact，不改写旧报价。当前手动搜索幂等存储为有界进程内实现，多实例部署前需迁移到共享存储。

仍注册的 `/v1/route-plans`、`/v1/route-plans/confirm`、`/v1/trip-plans`、
`/v1/travel-guides` 为兼容接口，保留各自严格 schema 和降级语义，不作为 Planner 或
route-generation 的权威交付路径。旧匿名 rule-first converse 和 `/v1/agent/chat`
未在当前 app 注册，新 Planner 不会在模型故障时静默切回它们。

## 4. 小程序连接与恢复

在仓库根目录运行：

```powershell
$env:FLIGHTOR_API_BASE_URL='http://127.0.0.1:3000'
$env:FLIGHTOR_USE_MOCK='false'
npm run dev:weapp
```

默认真实模式，仅显式 `FLIGHTOR_USE_MOCK=true` 启用离线 Mock。配置是构建时常量，修改后
重新构建；真机使用可访问的服务器地址。Provider key 仅保留在后端。

首次发送会引导登录；取消登录、Trip/Conversation 初始化失败或请求错误时保留草稿。
共享 session 层处理 token refresh、并发协调和一次 401 重试；登出、账号切换和会话切换
使迟到响应失效。对话返回后，客户端 GET 当前 Trip workspace，把已受理的后台路线 run
接入已有 polling/cancel 流程，不再次 POST 创建。

`delivery` 随 assistant message 持久化；workspace GET 通过相同 verifier 刷新未完成
verdict。客户端按 Goal 身份同步服务端结果，不能从对话文本或路线执行成功推断完成。

## 5. 数据库迁移与 Worker

在 `backend` 目录执行：

```powershell
npm run migrate
```

迁移包含用户会话、航空数据、Trip/Conversation/Memory/Artifact、route-generation、
planning Goal/Goal run lineage 与 Discovery/审核等表。迁移
`005_seed_mvp_airports` 是离线种子基线；其保守 down 不删除已有机场和别名。
`010_planning_goals`、`011_route_generation_goal_lineage` 建立持久目标及运行来源关系。

Worker 从 PostgreSQL `jobs` 以 `FOR UPDATE SKIP LOCKED` 原子领取任务，
处理 OAG 同步、显式路线生成及 Discovery。路线任务使用 heartbeat、取消检查和 stale-job
恢复，队列中只传 opaque run ID。拓扑采用新版本构建完成后原子激活，失败继续保留旧版本。
来源覆盖不足时，可达性返回 `unknown`，不能当成 `unreachable`。
OAG 同步由管理任务触发；Discovery 按已配置的来源计划调度，发布需人工审核。

## 6. 验证

在 `backend` 目录运行代码检查：

```powershell
npm run check
npm test -- --maxWorkers=1
npm run build
```

真实 PostgreSQL 集成套件需要显式 `TEST_DATABASE_URL` 指向独立测试数据库；缺少该变量
时相关套件会 skip，不能记作通过。完整后端测试串行使用 `--maxWorkers=1`，避免并行
初始化 `pg_trgm` 等数据库资源的竞态。交付前从根目录补前端测试、类型检查、构建和
`git diff --check`。

关键回归覆盖 runtime finalization、领域约束与覆盖校验、Goal/run 原子完成、Artifact
来源版本、Provider 调用中 Trip 变更、取消与晚响应、workspace 恢复及登录 session 竞态。
这些是检查范围，不是本轮通过结论。当前运行结果见
[DEMO_STATUS.md](../docs/DEMO_STATUS.md) 和
[PHASE789_ACCEPTANCE.md](../docs/PHASE789_ACCEPTANCE.md)；
静态检查、Mock 测试、真实 PostgreSQL、真实 Provider E2E 和微信设备验收分别记录。

## 7. 安全边界

- 不提交 `.env`、Token、OpenID 或 Provider 原始响应。
- 小程序不持有 OpenRouter、SerpApi、AeroDataBox 或 OAG 密钥。
- 日志脱敏授权头、登录 code 和 refresh token；错误返回有界且不泄露 Provider 原始内容。
- owner、Trip 版本、Goal/run lineage 和显式生成授权来自服务端，不能接受模型声明作为凭据。
- 上线前替换开发凭据；已泄露的密钥应撤销并重新生成。
