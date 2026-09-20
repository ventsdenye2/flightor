> **历史归档，2026-09-20：不作为当前实现、执行指令或新费用授权。当前入口见 [docs README](../../README.md)。**

# FlightOR 项目上下文与开发交接

> 2026-09-13 最新本地集成进度见 [续作交接](../../HANDOFF_2026-09-13_CONTINUATION.md)：
> 日期冲突领域校验、真实行程修改后新攻略/刷新恢复、attempt 收尾及原生 HTTP 审计已补齐。
> 工作区是 `.worktrees/production-integration`，尚未合并主仓。

> 最后更新：2026-09-08
> 用途：为后续迭代快速恢复上下文。每次完成会影响架构、启动方式、接口、外部依赖或 MVP 范围的开发后，应同步更新本文。

## 1. 当前目标与产品原则

演示与真实验收状态见 [DEMO_STATUS.md](../../DEMO_STATUS.md) 和
[PHASE789_ACCEPTANCE.md](../../PHASE789_ACCEPTANCE.md)，不要把历史样本当作当前验收结果。
启动用 `backend/.env.demo` 和 `demo:api` / `demo:worker`，开发环境显式
`REDIS_ENABLED=false` 可保留真实 PostgreSQL 队列运行，生产不可关闭。小程序默认真实模式；
仅 `FLIGHTOR_USE_MOCK=true` 启用离线 Mock。产品运行边界见 ADR 0009；Agent 自主编排和
服务端完成校验见 ADR 0010、[ADR 0011](../../adr/0011-verified-delivery-and-workspace-consistency.md)。

FlightOR 是国际航线比价与多城路线规划微信小程序，前端使用 Taro + React + MobX。

当前目标不是执行旧的十几天瀑布式计划，而是敏捷跑通可演示 MVP：

1. 用户用自然语言描述出发地、目的地、日期、预算和偏好；
2. 自建后端 Agent 多轮补齐检索参数；
3. 参数齐全后通过 SerpApi 返回真实报价和备选方案；
4. OAG Schedules / Master Data 尚在申请，不阻塞本轮 Agent MVP；
5. 外部服务不可用时返回明确状态或可信降级，不伪造实时结果。

长期架构以自建 API、Worker、PostgreSQL、Redis 为核心。微信云函数仅保留为迁移期兼容/测试资产，不应成为核心业务的强依赖。

## 2. 仓库结构

```text
src/                 微信小程序前端
  pages/             主包页面
  subpages/          分包页面
  components/        UI 组件
  services/          搜索、登录、规划等前端服务适配层
  stores/            MobX 状态
  mocks/             演示与离线数据
  utils/             请求、存储、格式化等工具

backend/             可独立部署的 Fastify 后端
  src/agent/         旧对话兼容层 + 新 Tool Calling Runtime、Core Tools 与 authenticated cloud Planner
  src/flight-routing/ Phase 4 production Connection/Path/Pareto Optimizer、contracts 与 Mock seams
  src/research-agent/ 受限 production Research Agent、验证、SerpApi search adapter 与 Mock seam
  src/routes/        HTTP API
  src/providers/     OAG、SerpApi、OpenRouter 适配器
  src/topology/      OAG 同步、拓扑版本构建
  src/search/        报价标准化与搜索领域逻辑
  src/auth/          微信登录与 JWT/Refresh Token
  src/db/            Kysely 类型、迁移和连接
  src/jobs/          PostgreSQL 持久任务队列
  src/worker.ts      Worker 入口

cloud/               旧微信云函数兼容/测试资产（非当前运行链路）
config/              Taro 构建配置
scripts/             离线测试与生成脚本
docs/                架构、部署、OAG 与多城设计文档
dist/                小程序构建产物
compose.yaml         PostgreSQL、Redis、API、Worker 编排
```

`cloud/` 中仍保留多城规划、聊天、价格趋势等遗留实现及协议测试，但当前小程序运行链路不再调用它们。新功能应进入 `backend/`；若复用旧云函数中的纯算法，应迁移纯逻辑，不要把 `wx-server-sdk` 或云数据库依赖带入自建后端。

权威开发文档统一位于 `docs/`。阅读顺序与文档职责见
`docs/README.md`；架构冲突时以 `docs/FLIGHTOR_ARCHITECTURE.md` 和已接受 ADR
为准。不要在仓库根目录新增新的规范性架构/需求文档。

### 新 Agent 与 Workspace 实现状态

- Phase 0/1：Tool Calling Runtime、Tool Registry、Aviation/Fare Provider 抽象及
  `get_trip_context`、`update_trip_context`、`resolve_location`、`search_flights`
  vertical slice 已完成。
- Phase 2：internal user identity、owner-scoped cloud Trip/Conversation/Artifact、
  versioned Trip Context、Markdown Memory 已完成；`/v1/agent-v2/converse` 只是已移除的
  历史迁移 seam，不是当前 API。
- Phase 3：`search_flexible_flights` 已接入 FareProvider 并持久化 v2 fare artifact；
  `search_connection_flights`、`plan_flight_route`、`optimize_route` 已建立严格的
  deterministic service/tool/artifact contracts；`web_research` 已接入受限
  Research Agent contract。
- Phase 4：AeroDataBox primary aviation adapter、PostgreSQL normalized topology
  repository、preferred-first/general connection discovery、bounded deterministic path
  planner、Pareto optimizer、structured explanations 与 golden-world tests 已接入
  cloud Agent composition；OAG 仍为可选 ingestion source。
- Phase 4B/Research：目的地发现与推荐、确定性 trip route、不可变航价/路线确认、
  独立 SerpApi web-search domain、受限 OpenRouter synthesis、逐 finding verification、
  `research_destination` 与 `save_travel_guide` 已注册到 cloud Planner。主 Planner
  编写逐日顺序、时段、主题和推荐说明，服务端恢复来源事实并在保存前共用 Goal 内容校验。
  旧 deterministic `build_travel_guide` 保留在完整 Core registry 供兼容调用。
  `PLANNER_MODEL` 与 `RESEARCH_MODEL` 可独立配置；缺少 SerpApi key 时 Research 明确
  unavailable，但路线、目录与 trip-structure 能力继续运行。
- Agent 是唯一规划编排层，可根据结果自行选择、跳过、重试和调整工具顺序；没有固定的
  “目的地 → 日程 → 研究 → 攻略”应用流程。领域服务负责事实、约束与持久化，不能反调
  Agent tool 或嵌套 Planner runtime。
- Durable delivery：`finish_goal` 和本轮结束前的自动校验共用
  `backend/src/agent/goals/completion.ts`；模型漏调完成工具也会校验本轮涉及的 Goal。
  领域 verifier 检查接受的日期、目的地、天数覆盖、证据资格及 lineage，不能仅凭存在
  Artifact 判定成功。Goal 与 Goal run 经 `commitCompletion` 原子提交，校验 owner、
  revision、Trip version 与终态规则，避免并发取消或版本变化造成一半成功、一半未完成。
- Artifact workspace：`backend/src/artifacts/workspace.ts` 统一读取、来源版本和写入检查，
  在服务端冻结 Trip version，并在外部调用后及写入前复查；PostgreSQL insert transaction
  再次检查当前 Trip 和 Goal/run。相同 owner/Trip/version 的来源可跨 Goal/run 复用；
  旧版本或无版本的历史 Artifact 可读，但不能直接组合成当前版本结果。当前没有跨版本
  兼容策略，必须返回稳定冲突，由 Agent 重新选择证据或规划。
- Phase 5 backend cutover：公开 Planner 对话契约为经过 JWT 认证的
  `POST /v1/agent/converse`，使用严格 camelCase `{ tripId, conversationId, message }`
  请求和 compact Trip/Artifact response。Conversation Planner registry 不含最终连接搜索、
  路径规划、优化或路线报价确认工具；它只可在当前用户消息明确要求生成路线时调用零参数
  `start_route_generation`，由该操作创建显式 route-generation run。
- [ADR 0015](../../adr/0015-transient-planner-progress.md)：小程序通过
  `POST /v1/agent/turns` + `GET /v1/agent/turns/:turnId` 短轮询等待同一 Planner
  工作流，整轮上限为 300 秒。阶段与连接状态只保存在临时 UI/进程缓存，不进入
  对话上下文或历史；服务重启后临时状态不可恢复，已保存的 workspace 仍可读取。
- Phase 5 route-generation contract：`POST /v1/trips/:tripId/route-generation-runs`、
  `GET /v1/route-generation-runs/:runId`、`DELETE /v1/route-generation-runs/:runId` 使用
  `Idempotency-Key`、owner-scoped auth、冻结 Trip Context、协作取消和 terminal immutability。
  按钮入口记录 `button` 授权；明确的对话指令记录 `explicit_user_message` 授权；两者共用同一
  domain service，并创建持久化 Goal/Goal run lineage。
  冻结 snapshot 不允许绕过实时版本校验：排队或运行中遇到 Trip 变更时，当前 attempt 以
  `TRIP_CONTEXT_VERSION_CONFLICT` 失败；新条件需新 run。已完成后才发生的编辑仅把历史结果
  标记为 stale，不把旧结果当作当前交付。
  worker/API 与 mini-program authenticated Trip/Conversation session 已切换完成；客户端支持
  persisted run 恢复、bounded polling retry、取消和 late-response invalidation。Phase 5 gate 已通过；
  真实 PostgreSQL 并发套件需要显式 `TEST_DATABASE_URL`，无测试库时会明确 skip。
- Phase 6 Plan/Flight Workspace：一级 Tab 已调整为 `Plan → Explore → Trips → Profile`；
  Search 保留为非 Tab 的 Flight Explorer。Plan 使用服务端 `tripContextSummary` 渲染 compact
  chips，并按 turn 或 workspace 分区加载 typed Artifact cards；完整 payload 只经 owner-scoped
  `GET /v1/artifacts/:id` 获取。手动航班搜索已改为 authenticated Trip/Conversation action，
  与 Agent `search_flights` 共用 `backend/src/fares/search-service.ts`，创建同一
  `FlightSearchArtifact` 后仅返回 compact ref/summary。请求使用 owner-scoped
  `Idempotency-Key`，FlightStore 对账号/会话切换和 late response 失效；当前手动 UI 只提交
  单一机场对、精确出发日和可选精确返程日，不再展示未执行的邻近机场/stay-range 查询。
  Phase 6 自动化 gate 已通过；实际微信登录、真实 SerpApi 报价与真机视觉/交互仍属于凭据
  和设备验收。

## 3. 当前系统链路

```text
微信小程序
  -> FlightOR Fastify API :3000
      -> PostgreSQL：用户、偏好、拓扑版本、任务、业务数据
      -> Redis：限流和报价短缓存
      -> SerpApi：Google Flights 真实报价
      -> OAG：Flight Info、Connections、Schedules、Master Data
      -> OpenRouter：Planner 自然语言理解（缺少凭据/Provider 失败时返回明确 unavailable 或 warning）

FlightOR Worker
  -> PostgreSQL jobs 队列
  -> OAG 同步
  -> 新拓扑版本构建并原子激活
  -> route-generation run：heartbeat、stale recovery、deterministic Artifact chain
```

当前公开 Planner 对话契约是经过 JWT 认证的 `POST /v1/agent/converse`；小程序按
ADR 0015 通过 `/v1/agent/turns` 提交和轮询同一工作流。请求严格为
`{ tripId, conversationId, message }`；用户身份来自 access token，Trip、Conversation、
Memory 和 Artifact 均按 owner 读取。响应只返回 `conversationId`、`tripId`、compact
`tripContextSummary`、`reply`、带 `presentationHint` 的 typed `artifactRefs`、
`suggestedActions`、可选 `memoryChanged`、有上限的 `warnings`、`stopReason` 和 `delivery`。
完整 Artifact 通过 owner-scoped `/v1/artifacts/:id` 获取，不嵌入对话文本。

`stopReason=completed` 仅用于领域校验得到 `delivery.status=satisfied` 的交付；
`responded` 仅表示没有 durable Goal 的普通文本回应，对应 `not_requested`。
未完成 Goal 使用 `goal_pending|goal_partial|goal_failed|goal_cancelled`，运行时超时等错误
保留独立 stop reason。`delivery` 包含整体及逐 Goal 的 status、Artifact IDs、missing 和
warnings；客户端必须采用服务端 verdict，不能从回复文案、工具调用成功或 route run 的
`succeeded` 推断业务完成。

`suggestedActions` 中的 `generate_route` 只是用户可点击的元数据，本身不会触发路线生成。
用户点击按钮，或在当前消息中无歧义地明确要求生成路线，才会通过同一 domain service 创建
显式 route-generation run；讨论、准备状态和 Planner 自行推断均不构成授权。按钮可用
`Idempotency-Key` 重试，对话入口使用服务端派生的幂等键；run 使用冻结的 Trip Context，支持 owner-scoped 查询、协作取消、
进度/警告/错误和 terminal immutability。当前生成 slice 只支持一个 canonical airport
origin、一个最终 visit destination 和 bounded departure window；return window、多个
visit destination、round-trip composition、required ground legs 必须显式返回 unsupported，
不能静默截断或伪造完整路线。缺少凭据或报价部分失败时返回明确 unavailable/warning，绝不编造价格。

小程序 adapter 已迁移为 authenticated Trip/Conversation session；创建顺序固定为 Trip 后
Conversation，请求只发送当前 message。owner-scoped cloud IDs、Artifact refs 与 route run 会
持久化，logout 清除 credential 和 owner-bound session。旧本地 history 只做兼容读取，不再
作为新 API 的权威 state，也不会将旧 `state`、recommendations、routes 或价格对象拼接回
新响应。已受理的 queued/running run 可在重启或重新进入页面后恢复轮询；取消、切换会话和
logout 都会使迟到响应失效。

对话返回后客户端读取 `GET /v1/trips/:id/workspace`，将对话入口创建的后台 run 接入既有
轮询和取消流程，不重复 POST 创建。Workspace 读取通过相同领域 verifier 刷新尚未完成的
message delivery；前端按 Goal 身份同步该 verdict。首次发送会先引导登录，取消登录或
Trip/Conversation 初始化失败时保留草稿；Token refresh 与一次 401 重试由共享 session
边界协调，登出和身份切换后的迟到响应不能恢复旧凭据或旧 owner 数据。

Plan 的旧 `UnderstandingPanel` 已删除；当前行程只由服务端 compact summary 生成 chips。
移除 chip 会发起显式的新 Planner edit，组件本身不会篡改 Context。旧轮次的 compatibility
recommendations/routes/travelGuide 仍可只读展示，但不再作为新 Planner authority。每轮
`artifactRefs` 在 Planner reply 后独立渲染；手动搜索与 route-generation 结果作为 workspace
Artifact 渲染。完整 payload 不进入本地 history。

规划页是 `src/app.config.ts` 的 pages 第一项，也是首个 tab；四个 tab 顺序为
“规划 → 探索 → 行程 → 我的”。Flight Explorer、route detail 保留为非 tab 页面。旧本地
history 仍按 `chat-history-v1` 做兼容读取，但不是 cloud Conversation authority。新 API session
必须在 authenticated owner 下创建或恢复 Trip/Conversation；logout 或 session switch 会清理
Artifact cache identity 并使迟到响应失效。

单目的地选中航班后的行程规划已迁移到自建后端 `POST /v1/trip-plans`。非 Mock 小程序只由 `src/services/tripService` 发送结构化事实素材，不暴露 OpenRouter key，也不依赖旧的 `cloud/tripAgent` 云函数。

## 4. 已实现的 MVP 后端能力

- Fastify API、统一错误格式、请求 ID、CORS、Redis 限流和日志脱敏；
- PostgreSQL/Kysely 迁移；
- 微信 `code2Session` 登录、Access Token、Refresh Token 轮换；
- 国家与机场搜索；
- 用户中转国家偏好；
- OAG 响应归一化、同步任务和 Worker；
- 带版本的航线拓扑、最多两次中转、无闭环、三态可达性；
- 中转国家排除/偏好、安全衔接时间和长中转软排序；
- SerpApi 实时报价搜索、标准化和 Redis 10 分钟缓存；
- 经过 JWT 认证的 `/v1/agent/converse` 新 Planner API，严格校验 owner-scoped Trip/
  Conversation，返回 compact context、Artifact refs、suggested actions、warnings 和
  stop reason 和服务端 delivery verdict；旧 rule-first converse route 已不再注册；
- 显式 route-generation run contract：创建、查询和协作取消均 owner-scoped，要求
  `Idempotency-Key`，冻结 Trip Context version，并把完整结果留在 Artifact；按钮和明确对话
  指令都创建带授权来源的持久化 Goal/run，Agent 不可直接调用内部路线引擎工具；
- Agentic Goal completion protocol：`declare_goal`、`get_active_goal`、`resume_goal`、`finish_goal`、
  `cancel_goal`；查询只读，显式恢复或声明才接受本轮目标。PostgreSQL 持久化 owner/Trip/Conversation、冻结 Context、幂等键、状态和
  working set；显式完成和本轮收尾共用领域 verifier，并原子提交 Goal/Goal-run 完成状态；
  校验包括接受的行程约束、Artifact lineage 与覆盖情况，不由模型措辞或工具名决定；
- `/v1/trip-plans` 接收选中航班与路线事实，服务端生成行程时间轴，支持 `source=llm|rules` 及非阻塞 `warnings`；
- OpenRouter、SerpApi 或路线 Provider 缺少凭据/不可用时返回明确 unavailable 或 warning；
  新 Planner 不把旧 rule-first converse 当作静默 fallback，也不编造 Provider 事实；
- 新 route-generation worker 的当前 MVP 边界是单一最终 visit destination、canonical airport
  origin 和 bounded departure window；多目的地、return window、ground composition 等输入
  显式失败，不伪装成完整路线；
- Planner 理解用户原文并调用受 schema/领域约束的工具；预算、兴趣和天数来自明确用户需求，
  不用业务关键词或规则解析器取代语义理解，也不引入用户未表达的默认硬约束；
- 新增 `005_seed_mvp_airports` 迁移，将 `src/mocks/airports.ts` 的 MVP 机场、城市、国家、常用中英文别名写入 PostgreSQL；
- 地点由航空领域解析；共享 Location Identity 保留机场身份与城市归属，fare domain 在付费
  查询前重新解析权威机场事实，不信任模型复制的名称、坐标或时区；
- OAG Schedules 不可用时，以 Flight Info Trial 作为直飞数据降级；
- 管理任务入队与 Job 状态轮询。

主要接口：

| Method | Path | 用途 |
|---|---|---|
| GET | `/health/live` | 进程存活 |
| GET | `/health/ready` | PostgreSQL、Redis 就绪 |
| GET | `/health/providers` | 仅检查是否配置，固定标记 `verified=false` |
| POST | `/v1/auth/wechat` | 微信登录 |
| POST | `/v1/auth/local` | 显式本地测试登录；默认关闭，非生产环境 + loopback + 本地密钥，独立测试账号；见 [本地登录说明](../../local-test-login.md) |
| POST | `/v1/auth/refresh` | 刷新会话 |
| POST | `/v1/agent/converse` | JWT 认证 Planner 对话；严格 `{tripId,conversationId,message}`，返回 compact Trip Context、typed Artifact refs、suggested actions、warnings、stop reason 与 delivery verdict |
| GET | `/v1/trips/:id/workspace` | owner-scoped 云端恢复；返回 Conversation、Artifact refs、后台 run 和经服务端刷新后的未完成 delivery |
| POST | `/v1/trips/:tripId/route-generation-runs` | Generate Route 按钮入口；要求 `Idempotency-Key`，可选 `conversationId`/`expectedTripVersion`，记录 `button` 授权；明确对话指令通过同一 service 的 Agent tool 入口 |
| GET | `/v1/route-generation-runs/:runId` | owner-scoped 查询 queued/running/succeeded/failed/cancelled、进度、冻结版本、warnings 与 Artifact ref |
| DELETE | `/v1/route-generation-runs/:runId` | owner-scoped 协作取消 queued/running run；terminal run 不可变 |
| POST | `/v1/route-plans/confirm` | 历史兼容路线卡报价确认；不属于新 Planner route-generation authority |
| POST | `/v1/flight-searches` | JWT 认证手动航班搜索；严格绑定 owned Trip/Conversation，调用与 Agent 相同 Fare/Artifact domain service，仅返回 `artifactRef` 与 compact summary |
| GET | `/v1/countries` | 国家列表/搜索 |
| GET | `/v1/airports` | 机场列表/搜索 |
| POST | `/v1/reachability/query` | 日期级三态可达性 |
| GET/PUT | `/v1/users/me/transit-country-preferences` | 用户中转偏好 |
| POST | `/v1/admin/sync/oag/location` | OAG 机场同步任务 |
| POST | `/v1/admin/sync/oag/route` | OAG 路线同步任务 |
| GET | `/v1/admin/jobs/:id` | 轮询任务状态 |
| GET | `/v1/admin/sync-runs/:id` | 查询同步执行记录 |

完整说明见 `backend/README.md`，OpenAPI UI 默认位于 `http://localhost:3000/docs`。

Phase 5 contract/test pointers：`backend/src/routes/agent-cloud.test.ts` 覆盖新的
authenticated conversation response；`backend/src/agent/tools/core.test.ts` 与
`backend/src/agent/runtime/runtime.test.ts` 覆盖 Planner registry 不暴露最终路线 primitives、
但提供专用显式 start operation；
`backend/src/route-generation/contracts.ts`、`repository.ts` 和数据库迁移
`backend/src/db/migrations/007_route_generation_runs.ts`、`010_planning_goals.ts`、
`011_route_generation_goal_lineage.ts` 保存 run/Goal/lineage contract；HTTP/worker、
取消/恢复、no-fake-fare 与 client session transport 均有自动化测试。真实数据库下的
Trip-acceptance、cancel-vs-progress 与 stale-job recovery 并发测试位于
`backend/src/route-generation/postgres.integration.test.ts`。

交付与一致性 contract pointers：`backend/src/agent/goals/completion*.test.ts`、
`default-verifiers.test.ts` 和 `postgres.integration.test.ts` 对应共享校验、Goal/run 原子
完成及竞态；`backend/src/artifacts/workspace.test.ts`、`postgres.integration.test.ts`
对应来源版本与并发写入边界。测试文件存在不代表本轮已运行或真实 Provider/设备已验收。

## 5. 后端启动方式

运行要求：

- Node.js 22 或更高版本；
- Docker Desktop；
- `backend/.env`，可从 `backend/.env.example` 复制；
- 不要把真实 `.env`、Token 或 Provider 响应提交到 Git。

完整容器启动：

```powershell
docker compose up -d --build
```

开发模式：

```powershell
docker compose up -d postgres redis
cd backend
npm install
npm run migrate
npm run dev
```

另开终端启动 Worker：

```powershell
cd backend
npm run dev:worker
```

检查：

```powershell
Invoke-RestMethod http://localhost:3000/health/live
Invoke-RestMethod http://localhost:3000/health/ready
Invoke-RestMethod http://localhost:3000/health/providers
```

2026-09-02 root 真实审核（旧 `:3000` 镜像历史记录）：当时 Docker Compose 重建成功；API、Worker 正常运行，PostgreSQL、Redis 均为 healthy；数据库 migrate exit 0；`/health/ready` 返回 `ready`，其中 `postgres=ok`、`redis=ok`；`/health/providers` 显示 OpenRouter、SerpApi 已配置，微信登录未配置（`false`）。`GET /v1/airports?query=东京` 返回 HND/NRT。非法 trip-plan 航段拓扑请求返回 HTTP 400 `INVALID_REQUEST`。这条记录仅描述旧镜像，不代表 2026-09-04 的 Docker 状态；本轮 Docker/HTTP/UI 状态见第 8、10 节。

## 6. 小程序启动方式

默认构建使用真实后端模式：

```powershell
npm install
npm run dev:weapp
```

连接本机自建后端：

```powershell
$env:FLIGHTOR_USE_MOCK='false'
$env:FLIGHTOR_API_BASE_URL='http://127.0.0.1:3000'
npm run dev:weapp
```

真机不能使用手机自身的 `127.0.0.1` 访问电脑。真机调试时应改为手机可访问的局域网地址；上线时必须使用已备案 HTTPS 域名，并在微信公众平台配置 request 合法域名。

注意：环境变量是构建时常量。修改 API 地址或 Mock 开关后必须重新构建；仅显式
`FLIGHTOR_USE_MOCK=true` 启用离线 Mock，不能据旧 `dist/` 或历史构建记录推断当前产物模式。

## 7. 环境变量

必须配置：

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`：至少 32 字符，每个环境独立生成
- `ADMIN_API_TOKEN`：使用管理同步接口时必需

业务 Provider：

- `WX_APPID` / `WX_SECRET`
- `SERPAPI_KEY`
- `OAG_FLIGHT_INFO_KEY`
- `OAG_CONNECTIONS_KEY`
- `OAG_SCHEDULES_KEY`
- `OAG_MASTER_DATA_KEY`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`

前端只允许配置：

- `FLIGHTOR_API_BASE_URL`
- `FLIGHTOR_USE_MOCK`

第三方密钥必须只存在于 `backend/.env`、部署平台 Secret Manager 或服务器环境变量中。禁止恢复根目录 `openrouter.txt` / `serpapi.txt` 的编译期注入方式。

后端通过 OpenRouter 正式默认使用精确模型 `deepseek/deepseek-v4-flash-0731`（2026-09-07 用户指定），最终以部署环境的 `OPENROUTER_MODEL` 配置为准；可替换为当前可用的其他模型。该付费模型需要有效 `OPENROUTER_API_KEY`、OpenRouter 账户余额和可用配额；如需替换，只通过部署环境或 `backend/.env` 的 `OPENROUTER_MODEL` 配置，不要在业务模块中硬编码模型 ID。共享 `OpenRouterClient` 会按目标模型能力处理 reasoning：业务传 `none` 时 V4 系列转换为 `enabled:false`，Planner/Research 也显式关闭推理；此前省略参数会继承模型默认推理；DeepSeek Chat 继续省略 reasoning，其他模型保持既有行为，不会因切换默认模型自动开启高推理。没有 key、余额不足、Provider 失败或模型输出不合规时，新 Planner 返回明确 provider/unavailable 状态与 bounded warning，不把旧 rule-first converse 当作静默 fallback；自动化测试不发起真实付费调用。此前 DeepSeek V3 与 V4 Flash 的直连结果仅作历史样本，不代表当前默认模型。

历史 rule-first 服务中保留的预算口语解析仅供兼容路径和旧协议测试使用。当前公开 Planner
直接理解用户原文，调用 `update_trip_context` 并由服务端做 schema、版本和领域校验；
客户端不回传旧 state，也不以该预算解析器或关键词分流充当新 Planner 的语义权威。

## 8. 外部 API 实测状态

以下记录区分外部 Provider/服务函数直连、旧接口历史样本、当前代码自动测试和 Docker HTTP/UI 验证。2026-09-04 的直连验证均从 `backend/dist` 调用、不依赖 DB，且未输出或记录 key；Docker 仍不可访问：`docker compose ps` 无法连接 `dockerDesktopLinuxEngine`，`localhost:3000` 拒绝连接，因此最终 compose 镜像和微信开发者工具 UI 尚未实测：

| Provider/API | 状态 | 结论 |
|---|---|---|
| OAG Schedules `/flights` | HTTP 401 | Production 订阅显示 `submitted`，需 OAG 激活或更换有效 key |
| OAG Master Data `/locations` | HTTP 401 | Production 订阅显示 `submitted`，需 OAG 激活或更换有效 key |
| OAG Connections `/flight-connections` | 成功 | 已返回并成功归一化连接数据 |
| OAG Flight Info `/flight-instances/` | 成功 | 已返回并成功归一化直飞数据，可作为 Schedules 降级 |
| SerpApi Google Flights | 成功 | 已返回真实报价并通过后端映射 |
| OpenRouter `/chat/completions`（历史 Pro 验证） | `deepseek/deepseek-v4-pro-0813`；2026-09-04 付费直连 `success=true`、`responseModel` 同为该 ID、content 为“V4 Pro 配置验证成功。” | 使用 `.env` 默认值且未传 model override；业务 `reasoning=none` 被适配器省略；prompt/completion/total tokens 为 97/60/157，cost `$0.00036564`；证明当前 key、余额、模型 ID 和默认适配路径可用，不代表 Docker HTTP/UI |
| OpenRouter `/chat/completions`（模型切换前历史直连） | `deepseek/deepseek-chat` 最小“仅回复 OK”请求返回 `success=true, content=OK` | 只证明当时旧模型与验证环境可用；未输出或记录 key |
| OpenRouter `/chat/completions`（旧联调） | 旧容器历史实测为 Dots 模型 | 仅作历史记录，不代表当前配置；模型 ID、配额和生命周期必须保持可替换 |
| OpenRouter Dots 免费模型（旧联调） | 旧容器历史实测调用成功 | 历史实测模型为 `dots-studio/dots-3-note-preview:free`；仅作可替换联调配置，不应长期硬编码依赖 |
| 历史自建行程 `/v1/trip-plans`（旧联调） | 旧容器曾实测 `source=llm`，约 6.1 秒 | 历史记录，不代表当前统一会话链路；预算项为 `2300 + 800 + 450 = 3550` |
| Agent `converse` 服务函数（模型切换前历史直连） | 从 `backend/dist` 直接调用成功 | 原文“我从北京出发，10月1日去日本玩7天，预算一万五，喜欢文化和美食，你帮我选择城市并规划路线”返回 `source=llm`、`phase=plan`、`origin=PEK`、7 天、预算 15000、`destination_mode=recommend`、推荐 `[KIX,NRT]`、2 条路线、`warnings=[]`；只代表旧模型样本，修复了此前预算 10000 的回归 |
| 攻略服务函数（模型切换前历史直连） | 首次组合调用瞬时 `search_failed` 后安全降级；SerpApi 直接重试 3 条结果，完整重试返回 `source=web` | 结果为 3 天游玩、4 个来源、网页域名 `www.facebook.com` / `mercure.accor.com` / `janicerohrssen.com`，`warnings=[travel_guide_llm_fallback]`；旧 DeepSeek 编辑未通过严格 grounding，保留网页摘要驱动的确定性日程，链路成功但不是当前 V4 Pro 的质量证明 |
| 历史 Docker HTTP/UI `/v1/agent/converse`（旧协议） | 2026-09-04 不可访问 | `docker compose ps` 无法连接 `dockerDesktopLinuxEngine`，`localhost:3000` 拒绝连接；该记录描述旧镜像，不能证明当前 authenticated Planner API 或新 route-generation run |
| 历史 Agent `/v1/agent/chat`（旧接口） | 2026-09-02 旧环境曾实测 `:3001` 三例 `source=llm`，约 2–3 秒 | 历史记录：东京默认 NRT、东京羽田 HND、只说日本不猜目的地；不代表当前 `/v1/agent/converse` |
| 历史多城 `/v1/route-plans/confirm`（旧接口） | 旧 Docker 联调约 9.426 秒，3/3 航段实时报价确认成功 | 历史记录；确认总价为 12051，单卡确认结果不会覆盖其它路线；不代表当前 route-generation authority |
| 微信登录 | 配置状态 `false` | `WX_SECRET` 为空，补齐后才能完成正式登录联调 |

`/health/providers` 只检查 key 是否存在，不进行付费/配额相关真实调用。不要用该接口判断订阅是否 active。

2026-08-31 历史旧链路查询 OpenRouter 实时模型列表时，没有可用的 `deepseek/...:free` 型号；历史 DeepSeek 免费 ID 均返回 404，并明确提示只能使用付费版本。这是当时的目录观察，不代表本轮当前模型配置；部署前必须确认运行环境 `OPENROUTER_MODEL`、账户余额和配额，如需零费用或其他供应商可替换模型并接受可用性变化。该旧链路曾在无 key、余额不足或 Provider/模型错误时返回确定性降级结果与 warning；新 Planner 不继承这一静默 fallback 语义，而是返回明确 unavailable/error。

## 9. 核心业务与技术约束

### 产品规则

- 可达性必须返回 `reachable / unreachable / unknown` 三态；
- 数据覆盖不完整或 Provider 失败时不能把 `unknown` 当作 `unreachable`；
- 最多两次中转，禁止重复机场和闭环；
- 用户 `excluded` 中转国家是硬过滤，`preferred` 是软排序；
- 最低衔接时间是安全硬约束；自行中转采用更保守下限；
- 长中转不是硬过滤，应保留并标记 `long_connection` / `stopoverPlayable`；
- OAG 时刻不等于可售价格；真实价格以报价 Provider 为准；
- 大模型不能作为航班存在、价格、签证或安全衔接的事实来源。
- 机场事实来自服务端航空领域和 Provider；前端或模型不得提供可覆盖权威解析的机场表。
- 历史兼容接口的 `source=rules` 不代表已调用模型；新 Planner 失败时返回明确状态，不静默
  切换旧协议。真实报价始终只来自报价 Provider。
- 非 Mock 小程序不得直连 OpenRouter、SerpApi 或微信云函数；第三方密钥只在自建后端使用。

### 工程约束

- 首期保持模块化单体，不拆微服务；
- API 与 Worker 共用领域代码，但以不同进程运行；
- 所有 Provider 通过服务端适配器调用；
- 新接口使用 `/v1`、Zod 输入校验和统一错误格式；
- Fastify 请求解析类 4xx 错误必须保留为客户端错误，不能包装成 `INTERNAL_ERROR`；
- 日志不得记录密钥、Authorization、微信 code、refresh token、OpenID 或完整敏感响应；
- 数据同步构建新拓扑版本，完成后原子激活；失败时继续使用旧版本；
- 报价缓存只能短期使用，并保留“价格以实际购买为准”的提示；
- 修改已有未提交文件前先查看 `git diff`，不要覆盖用户或其他开发者的改动。

## 10. 历史验证记录与验证命令

以下 2026-09-04 记录仅保留历史背景；当前自动化、真实 Provider、数据库与微信设备验收
分别以 [DEMO_STATUS.md](../../DEMO_STATUS.md) 和
[PHASE789_ACCEPTANCE.md](../../PHASE789_ACCEPTANCE.md) 的明确记录为准。

截至 2026-09-04，root 真实审核与代码验证结果（Provider/服务函数直连与最终 Docker 镜像分开记录）：

- 2026-09-04 从 `backend/dist` 使用 `.env` 默认值直接调用当前 V4 Pro，调用处未显式提供 model override；请求带业务现有 `reasoning:{effort:'none',exclude:true}`，适配器省略该字段，返回 `configuredModel=deepseek/deepseek-v4-pro-0813`、`responseModel=deepseek/deepseek-v4-pro-0813`、`success=true`、`content=V4 Pro 配置验证成功。`、prompt/completion/total tokens 为 97/60/157、cost `$0.00036564`。未输出或记录 key；这证明当前 key、余额、模型 ID 和默认适配路径可用，不代表 Docker HTTP/UI；
- 同日从 `backend/dist` 直接调用模型切换前的 OpenRouter `deepseek/deepseek-chat` 最小“仅回复 OK”请求返回 `success=true`、`content=OK`；该旧模型样本不代表当前默认 V4 Pro，直连验证不依赖 DB，未输出或记录 key；
- 同日从 `backend/dist` 直接调用 Agent `converse`：原文为“我从北京出发，10月1日去日本玩7天，预算一万五，喜欢文化和美食，你帮我选择城市并规划路线”，返回 `source=llm`、`phase=plan`、`origin=PEK`、7 天、预算 15000、`destination_mode=recommend`、推荐 `[KIX,NRT]`、2 条路线、`warnings=[]`；修复前该回归曾得到预算 10000；
- 同日攻略直连验证：第一次组合调用瞬时 `search_failed` 后安全降级 catalog；同一 SerpApi Google Search 直接重试成功并返回 3 条结果；完整 SerpApi + DeepSeek 重试返回 `source=web`、3 天游玩、4 个来源、网页域名 `www.facebook.com` / `mercure.accor.com` / `janicerohrssen.com`、`warnings=[travel_guide_llm_fallback]`。DeepSeek 编辑输出未通过严格 grounding，保留网页摘要驱动的确定性日程；该链路成功但不是无 warning 的理想 LLM 攻略质量；
- Docker CLI/HTTP/UI 验证仍不可用：`docker compose ps` 无法连接 `dockerDesktopLinuxEngine`，`localhost:3000` 拒绝连接，故最终 compose 镜像和微信开发者工具 UI 尚未实测；
- 历史旧容器曾使用 Dots 模型（`dots-studio/dots-3-note-preview:free`）验证 `/v1/trip-plans`、旧 `/v1/agent/chat` 与 `/v1/route-plans/confirm`，记录见上表，不代表当前统一会话链路，也不作为当前模型配置声明；
- 独立复核：后端最终测试为 20 个 test files / 121 tests；根项目 `npm test` 为 140/140（含预算纯函数 12/12、会话缓存 17/17）；`npx tsc --noEmit`、后端 `check`、后端 build、小程序 `weapp` build、`git diff --check` 均通过；本轮未做微信开发者工具截图/交互 QA，需用户下一步验证实际小程序渲染。

模型环境边界：正式默认 `OPENROUTER_MODEL=deepseek/deepseek-v4-flash-0731`，最终部署以运行环境覆盖为准；该付费模型的计费、余额、配额、生命周期和可用性以 OpenRouter 当前目录及账户为准，不在文档中写死价格。此前 DeepSeek V3 与 V4 Flash 的直连结果仅作历史样本，连同旧容器 Dots 样本均不代表当前默认模型。没有 key 或调用失败时，新 Planner 和 route-generation run 返回明确 unavailable/error 与 bounded warning；历史 `route-plans`/`trip-plans` 兼容路径可以保留各自的确定性行为，但它们不是新 Planner 的 authority，任何 fallback 都不得编造 Provider 事实。业务不会因默认模型切换自动启用高推理。

提交或交付前至少运行：

```powershell
npm test
npx tsc --noEmit
npm run build:weapp
npm --prefix backend run check
npm --prefix backend test
npm --prefix backend run build
git diff --check
```

Vitest/esbuild 在受限沙箱中可能因 `spawn EPERM` 失败；这属于进程权限问题，应在正常终端或获准的沙箱外运行，不能当作代码断言失败。

## 11. 已知缺口与后续优先级

按可演示 MVP 的阻塞程度处理，不采用固定十几天计划：

### P0：完成新 Planner/route-generation 的真实环境验收

1. 在微信开发者工具中完成 authenticated Trip/Conversation session → 新 Planner response →
   Artifact fetch → 用户点击 Generate Route → run polling/cancel 的联调；
2. 按部署环境的 `OPENROUTER_MODEL` 选择目标模型；recreate API 后确认目标模型的余额、配额和请求参数兼容性；
3. 生产前验证 DeepSeek 账户余额与限额、模型输出稳定性和数据策略；没有 key、余额不足或
   Provider 失败时确认明确 unavailable/error 与 warning 对前端可见，不回退为旧 rule-first response；
4. 补 `WX_SECRET`，验证微信登录和 Token 轮换；新 Planner API 需要 authenticated owner，
   因此不能再把游客态旧 Agent 作为生产 cutover 的替代路径。

OAG Master Data 开通后，应通过现有 `oag_sync_location` 任务从 OAG 覆盖/更新本地种子数据；本地 `005_seed_mvp_airports` 作为 MVP 离线基线保留，OAG 数据进入后以 OAG 为权威并保留服务端白名单校验。

### P1：继续完善后端化业务

旧多城 `routePlanner` 只保留为兼容与离线协议测试；mini-program 已建立/恢复
owner-scoped Trip 和 Conversation，调用 `/v1/agent/converse`，并通过显式
route-generation run 触发最终路线。旧 `TripState` 或关键词分流不再是新 Planner
authority；完整 Artifact 拉取、typed renderer 和云端 workspace 恢复已接入，实际登录、
设备交互和真实交付覆盖仍按独立验收记录推进。

1. 让国家、机场选择器从 `/v1/countries`、`/v1/airports` 取数；
2. 将用户中转偏好接入后端并跨设备同步；
3. 在既有云端 Trips 基础上继续完善收藏、价格提醒和跨端体验；
4. 在既有服务端 Conversation 历史与 workspace 恢复基础上完善可观测性和提示词版本管理，
   保持 Agent 自主选工具及领域完成校验边界。

### P2：完善搜索产品能力

1. 当前 SerpApi 搜索保留直飞和航司联程，`selfTransfer` 暂为空；联程以完整报价单 edge 接入路线生成/比较/复核，保留全部航段与每次中转信息（[ADR 0014](../../adr/0014-provider-connecting-fares.md)）。`airline` 不自动证明行李直挂或衔接保障；未知全程时长不填 0。自行拼票仍需要独立 Provider/组合器；
2. 把同步报价快速路径升级为可持久化、可轮询的异步搜索；
3. 增加 Provider 调用审计、配额预算、重试/熔断与指标；
4. 增加行程、提醒、通知和生产部署监控。

## 12. 工作区注意事项

- 当前工作区已有较多未提交后端和文档改动，属于正在进行的 MVP 工作，不要擅自回滚；
- 仓库中存在大量 `._*` macOS 资源分叉残留文件，目前未清理；清理前先确认目标并避免误删业务文件；
- `docs/deploy.md` 主要描述旧微信云函数部署链路，可能已过时；当前自建后端启动方式以本文和 `backend/README.md` 为准；
- `docs/backend-architecture.md` 是完整目标设计，本文记录当前实际状态与近期优先级，两者发生冲突时先核对代码和最近验证结果。

## 13. 开发完成后的更新清单

每次重要开发结束后，至少检查本文以下内容是否需要更新：

- 当前 MVP 范围和完成状态；
- 新增/废弃的目录、服务和 API；
- 环境变量与启动命令；
- 外部 Provider 的真实状态和探测日期；
- 数据与安全约束；
- 测试数量、构建结果和已知未验证项；
- 下一轮最高优先级阻塞；
- 工作区中需要保护的未提交改动。

## Phase 7–9 当前实现（2026-09-07）
路线详情、云端 Trips/Memory、Explore 模板种子和独立 apps/admin 审核台已接入自建后端。迁移新增 008/009。启动与验收边界见 [PHASE789_ACCEPTANCE.md](../../PHASE789_ACCEPTANCE.md)。当前路线生成仅支持单起点、单终点、单程；AeroDataBox 机场、航线、时刻在线实测已通过，完整生成链路与微信真机仍待验收。默认单主 Agent，遵循用户选择的模型及思考强度。
