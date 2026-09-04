# FlightOR 项目上下文与开发交接

> 最后更新：2026-09-02
> 用途：为后续迭代快速恢复上下文。每次完成会影响架构、启动方式、接口、外部依赖或 MVP 范围的开发后，应同步更新本文。

## 1. 当前目标与产品原则

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
  src/agent/         多轮槽位提取、白名单校验和规则降级
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

## 3. 当前系统链路

```text
微信小程序
  -> FlightOR Fastify API :3000
      -> PostgreSQL：用户、偏好、拓扑版本、任务、业务数据
      -> Redis：限流和报价短缓存
      -> SerpApi：Google Flights 真实报价
      -> OAG：Flight Info、Connections、Schedules、Master Data
      -> OpenRouter：自然语言需求理解（失败时本地规则降级）

FlightOR Worker
  -> PostgreSQL jobs 队列
  -> OAG 同步
  -> 新拓扑版本构建并原子激活
```

Agent 对话、目的地推荐和多城路线规划已经统一走自建后端 `POST /v1/agent/converse`。前端不再按“多城/几个城市”等关键词分流；每一轮都通过统一会话协议传递消息与结构化 state，返回当前理解、目录推荐、路线卡和 warnings。小程序包不再注入 SerpApi、OpenRouter 或 OAG 密钥。

路线卡的逐段报价确认仍由后端确认接口处理：多城会话按顺序合并用户原文（上限 1000 字符），用请求代次防止旧响应覆盖新规划；点击哪张路线卡只确认哪一张，确认结果按路线标识合并回列表。Mock 模式仅使用前端内置的确定性降级数据。

规划页的“当前理解”是对话区上方、输入栏上方且独立于聊天 `ScrollView` 的只读面板，默认折叠；展开后显示出发地、日期、天数、预算、区域、兴趣、必去/排除城市和 Agent 推荐模式，并提供“新行程”入口。对话输出以 `chatStore.timeline` 的 `ConversationTurnSnapshot` 为准：每个 assistant 轮次快照携带 recommendations、suggestedActions、warnings、routes 和可选 `travelGuide`，按 `user → assistant → attachments → next user` 时间顺序渲染；攻略卡默认显示双语摘要，可在页面临时状态中按 turn 展开天列表，列出 Day N、城市、活动标题/说明和来源标题/域名。仅 `web` 来源显示“复制链接”并通过剪贴板工作，catalog/rules 来源不可点击。新请求开始后旧附件保留查看/路线展开/攻略复制能力，但动作和报价确认均禁用，只有最新轮且非忙碌状态可操作。`reset`/“新行程”会清空 timeline、会话 state 以及本地折叠/展开状态。

规划页现在是 `src/app.config.ts` 的 pages 第一项，也是首个 tab；四个 tab 顺序为“规划 → 搜索 → 探索 → 我的”，搜索结果和路线详情仍保留为非 tab 页面。Agent 会话历史使用 Taro 本地 storage，游客可用且不依赖微信登录、云函数或后端会话：缓存带 `chat-history-v1` 版本号，最多 20 个会话；每个会话最多保存 24 条 API messages、12 轮 timeline、3 个推荐/快捷动作/路线以及每条路线最多 8 个航段。攻略只作为对应 turn 的可选结构化字段持久化，rehydrate 仅接受 `web/catalog/rules` 来源，限制天数≤60、每天条目≤4、来源数量和聚合文本长度；网页 URL 只接受无凭据的 `http/https`，catalog/rules 永远不提供复制入口。rehydrate 会严格校验并截断未知数据，攻略局部非法时只丢弃攻略，版本错误或损坏缓存安全忽略；isThinking、loading、报价中的请求和攻略展开状态等瞬态不持久化。切换、删除和新建会话都会使在途对话/报价响应失效，避免晚到结果写入错误会话。

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
- `/v1/agent/converse` 统一多轮需求、目录推荐与路线规划，服务端机场白名单与 OpenRouter 调用；
- `/v1/route-plans/confirm` 兼容路线卡逐段报价确认；规划轮次统一经 `/v1/agent/converse`；
- `/v1/trip-plans` 接收选中航班与路线事实，服务端生成行程时间轴，支持 `source=llm|rules` 及非阻塞 `warnings`；
- OpenRouter 不可用、超时或返回非结构化内容时自动规则降级，核心演示不因 Provider 或付费模型波动中断；
- 小程序 Agent 页参数齐全后可调用真实航班搜索并生成最省钱/最舒适/长中转备选卡；
- Agent 对预算、兴趣、天数、行程类型和中转偏好采用文本证据校验，防止模型填入用户未表达的默认值；
- 新增 `005_seed_mvp_airports` 迁移，将 `src/mocks/airports.ts` 的 MVP 机场、城市、国家、常用中英文别名写入 PostgreSQL；
- Agent 路由从 `airport_aliases` 读取别名，解析优先级为“明确 IATA > 具体机场名/别名 > 城市默认机场”；
- 同城多机场（如 PEK/PKX、NRT/HND、LHR/LGW）不会同时填入 origin 和 destination；
- OAG Schedules 不可用时，以 Flight Info Trial 作为直飞数据降级；
- 管理任务入队与 Job 状态轮询。

主要接口：

| Method | Path | 用途 |
|---|---|---|
| GET | `/health/live` | 进程存活 |
| GET | `/health/ready` | PostgreSQL、Redis 就绪 |
| GET | `/health/providers` | 仅检查是否配置，固定标记 `verified=false` |
| POST | `/v1/auth/wechat` | 微信登录 |
| POST | `/v1/auth/refresh` | 刷新会话 |
| POST | `/v1/agent/converse` | 统一多轮理解、目的地推荐与路线规划，返回 state、recommendations、routes 与 warnings |
| POST | `/v1/route-plans/confirm` | 仅确认提交的路线卡，返回逐段确认价与 warnings（兼容接口） |
| POST | `/v1/flight-searches` | MVP 同步真实报价搜索 |
| GET | `/v1/countries` | 国家列表/搜索 |
| GET | `/v1/airports` | 机场列表/搜索 |
| POST | `/v1/reachability/query` | 日期级三态可达性 |
| GET/PUT | `/v1/users/me/transit-country-preferences` | 用户中转偏好 |
| POST | `/v1/admin/sync/oag/location` | OAG 机场同步任务 |
| POST | `/v1/admin/sync/oag/route` | OAG 路线同步任务 |
| GET | `/v1/admin/jobs/:id` | 轮询任务状态 |
| GET | `/v1/admin/sync-runs/:id` | 查询同步执行记录 |

完整说明见 `backend/README.md`，OpenAPI UI 默认位于 `http://localhost:3000/docs`。

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

默认构建仍使用 Mock，便于离线演示：

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

注意：环境变量是构建时常量。修改 API 地址或 Mock 开关后必须重新构建。运行无环境变量的构建会恢复为 Mock。2026-09-01 最后一次生成的 `dist/` 为连接 `http://127.0.0.1:3000` 的非 Mock 产物。

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

后端通过 OpenRouter 正式默认使用精确模型 `deepseek/deepseek-v4-pro-0813`，最终以部署环境的 `OPENROUTER_MODEL` 配置为准；可替换为当前可用的其他模型。该付费模型需要有效 `OPENROUTER_API_KEY`、OpenRouter 账户余额和可用配额；如需替换，只通过部署环境或 `backend/.env` 的 `OPENROUTER_MODEL` 配置，不要在业务模块中硬编码模型 ID。共享 `OpenRouterClient` 会按目标模型能力处理 reasoning：业务当前传 `none` 时 V4 Pro 安全省略，未来显式 `high`/`xhigh` 才转发；DeepSeek Chat 继续省略 reasoning，其他模型保持既有行为，不会因切换默认模型自动开启高推理。没有 key、余额不足、Provider 失败或模型输出不合规时，会使用确定性规则降级并返回 `llm_fallback`/对应 warning；自动化测试不发起真实付费调用。此前 DeepSeek V3 与 V4 Flash 的直连结果仅作历史样本，不代表当前默认模型。

统一对话的预算解析支持 `一万五`、`一万五千`、`两万三`、`1万5`、`1万5千`、`1.5万`、`八千`和纯数字等明确格式；`一万零五百`按 10500 保留精度，不完整/歧义表达不覆盖。当前确定性预算对同轮 LLM 粗解析具有优先级，后续明确改预算可覆盖客户端旧 state。

## 8. 外部 API 实测状态

以下记录区分外部 Provider/服务函数直连、旧接口历史样本、当前代码自动测试和 Docker HTTP/UI 验证。2026-09-04 的直连验证均从 `backend/dist` 调用、不依赖 DB，且未输出或记录 key；Docker 仍不可访问：`docker compose ps` 无法连接 `dockerDesktopLinuxEngine`，`localhost:3000` 拒绝连接，因此最终 compose 镜像和微信开发者工具 UI 尚未实测：

| Provider/API | 状态 | 结论 |
|---|---|---|
| OAG Schedules `/flights` | HTTP 401 | Production 订阅显示 `submitted`，需 OAG 激活或更换有效 key |
| OAG Master Data `/locations` | HTTP 401 | Production 订阅显示 `submitted`，需 OAG 激活或更换有效 key |
| OAG Connections `/flight-connections` | 成功 | 已返回并成功归一化连接数据 |
| OAG Flight Info `/flight-instances/` | 成功 | 已返回并成功归一化直飞数据，可作为 Schedules 降级 |
| SerpApi Google Flights | 成功 | 已返回真实报价并通过后端映射 |
| OpenRouter `/chat/completions`（当前默认） | `deepseek/deepseek-v4-pro-0813`；2026-09-04 付费直连 `success=true`、`responseModel` 同为该 ID、content 为“V4 Pro 配置验证成功。” | 使用 `.env` 默认值且未传 model override；业务 `reasoning=none` 被适配器省略；prompt/completion/total tokens 为 97/60/157，cost `$0.00036564`；证明当前 key、余额、模型 ID 和默认适配路径可用，不代表 Docker HTTP/UI |
| OpenRouter `/chat/completions`（模型切换前历史直连） | `deepseek/deepseek-chat` 最小“仅回复 OK”请求返回 `success=true, content=OK` | 只证明当时旧模型与验证环境可用；未输出或记录 key |
| OpenRouter `/chat/completions`（旧联调） | 旧容器历史实测为 Dots 模型 | 仅作历史记录，不代表当前配置；模型 ID、配额和生命周期必须保持可替换 |
| OpenRouter Dots 免费模型（旧联调） | 旧容器历史实测调用成功 | 历史实测模型为 `dots-studio/dots-3-note-preview:free`；仅作可替换联调配置，不应长期硬编码依赖 |
| 历史自建行程 `/v1/trip-plans`（旧联调） | 旧容器曾实测 `source=llm`，约 6.1 秒 | 历史记录，不代表当前统一会话链路；预算项为 `2300 + 800 + 450 = 3550` |
| Agent `converse` 服务函数（模型切换前历史直连） | 从 `backend/dist` 直接调用成功 | 原文“我从北京出发，10月1日去日本玩7天，预算一万五，喜欢文化和美食，你帮我选择城市并规划路线”返回 `source=llm`、`phase=plan`、`origin=PEK`、7 天、预算 15000、`destination_mode=recommend`、推荐 `[KIX,NRT]`、2 条路线、`warnings=[]`；只代表旧模型样本，修复了此前预算 10000 的回归 |
| 攻略服务函数（模型切换前历史直连） | 首次组合调用瞬时 `search_failed` 后安全降级；SerpApi 直接重试 3 条结果，完整重试返回 `source=web` | 结果为 3 天游玩、4 个来源、网页域名 `www.facebook.com` / `mercure.accor.com` / `janicerohrssen.com`，`warnings=[travel_guide_llm_fallback]`；旧 DeepSeek 编辑未通过严格 grounding，保留网页摘要驱动的确定性日程，链路成功但不是当前 V4 Pro 的质量证明 |
| 最终 Docker HTTP/UI `/v1/agent/converse` | 2026-09-04 不可访问 | `docker compose ps` 无法连接 `dockerDesktopLinuxEngine`，`localhost:3000` 拒绝连接；最终 compose 镜像和微信开发者工具 UI 尚未实测 |
| 历史 Agent `/v1/agent/chat`（旧接口） | 2026-09-02 旧环境曾实测 `:3001` 三例 `source=llm`，约 2–3 秒 | 历史记录：东京默认 NRT、东京羽田 HND、只说日本不猜目的地；不代表当前 `/v1/agent/converse` |
| 历史多城 `/v1/route-plans/confirm`（旧接口） | 旧 Docker 联调约 9.426 秒，3/3 航段实时报价确认成功 | 历史记录；确认总价为 12051，单卡确认结果不会覆盖其它路线 |
| 微信登录 | 配置状态 `false` | `WX_SECRET` 为空，补齐后才能完成正式登录联调 |

`/health/providers` 只检查 key 是否存在，不进行付费/配额相关真实调用。不要用该接口判断订阅是否 active。

2026-08-31 查询 OpenRouter 实时模型列表时，没有可用的 `deepseek/...:free` 型号；历史 DeepSeek 免费 ID 均返回 404，并明确提示只能使用付费版本。这是当时的目录观察，不代表本轮当前模型配置；部署前必须确认运行环境 `OPENROUTER_MODEL`、账户余额和配额，如需零费用或其他供应商可替换模型并接受可用性变化。无 key、余额不足或 Provider/模型错误不会阻塞规则链路，服务返回确定性降级结果与 warning。

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
- Agent 只接受服务端数据库中的有效机场代码；前端不得提供可覆盖白名单的机场表。
- `source=rules` 是 OpenRouter 降级结果，不代表已调用模型；真实报价仍只来自报价 Provider。
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

## 10. 当前验证基线

截至 2026-09-04，root 真实审核与代码验证结果（Provider/服务函数直连与最终 Docker 镜像分开记录）：

- 2026-09-04 从 `backend/dist` 使用 `.env` 默认值直接调用当前 V4 Pro，调用处未显式提供 model override；请求带业务现有 `reasoning:{effort:'none',exclude:true}`，适配器省略该字段，返回 `configuredModel=deepseek/deepseek-v4-pro-0813`、`responseModel=deepseek/deepseek-v4-pro-0813`、`success=true`、`content=V4 Pro 配置验证成功。`、prompt/completion/total tokens 为 97/60/157、cost `$0.00036564`。未输出或记录 key；这证明当前 key、余额、模型 ID 和默认适配路径可用，不代表 Docker HTTP/UI；
- 同日从 `backend/dist` 直接调用模型切换前的 OpenRouter `deepseek/deepseek-chat` 最小“仅回复 OK”请求返回 `success=true`、`content=OK`；该旧模型样本不代表当前默认 V4 Pro，直连验证不依赖 DB，未输出或记录 key；
- 同日从 `backend/dist` 直接调用 Agent `converse`：原文为“我从北京出发，10月1日去日本玩7天，预算一万五，喜欢文化和美食，你帮我选择城市并规划路线”，返回 `source=llm`、`phase=plan`、`origin=PEK`、7 天、预算 15000、`destination_mode=recommend`、推荐 `[KIX,NRT]`、2 条路线、`warnings=[]`；修复前该回归曾得到预算 10000；
- 同日攻略直连验证：第一次组合调用瞬时 `search_failed` 后安全降级 catalog；同一 SerpApi Google Search 直接重试成功并返回 3 条结果；完整 SerpApi + DeepSeek 重试返回 `source=web`、3 天游玩、4 个来源、网页域名 `www.facebook.com` / `mercure.accor.com` / `janicerohrssen.com`、`warnings=[travel_guide_llm_fallback]`。DeepSeek 编辑输出未通过严格 grounding，保留网页摘要驱动的确定性日程；该链路成功但不是无 warning 的理想 LLM 攻略质量；
- Docker CLI/HTTP/UI 验证仍不可用：`docker compose ps` 无法连接 `dockerDesktopLinuxEngine`，`localhost:3000` 拒绝连接，故最终 compose 镜像和微信开发者工具 UI 尚未实测；
- 历史旧容器曾使用 Dots 模型（`dots-studio/dots-3-note-preview:free`）验证 `/v1/trip-plans`、旧 `/v1/agent/chat` 与 `/v1/route-plans/confirm`，记录见上表，不代表当前统一会话链路，也不作为当前模型配置声明；
- 独立复核：后端最终测试为 20 个 test files / 121 tests；根项目 `npm test` 为 140/140（含预算纯函数 12/12、会话缓存 17/17）；`npx tsc --noEmit`、后端 `check`、后端 build、小程序 `weapp` build、`git diff --check` 均通过；本轮未做微信开发者工具截图/交互 QA，需用户下一步验证实际小程序渲染。

模型环境边界：正式默认 `OPENROUTER_MODEL=deepseek/deepseek-v4-pro-0813`，最终部署以运行环境覆盖为准；该付费模型的计费、余额、配额、生命周期和可用性以 OpenRouter 当前目录及账户为准，不在文档中写死价格。此前 DeepSeek V3 与 V4 Flash 的直连结果仅作历史样本，连同旧容器 Dots 样本均不代表当前默认模型。没有 key 或调用失败时，conversation、route-plans 和 trip-plans 均保留规则/确定性降级；业务不会因默认模型切换自动启用高推理。

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

### P0：完成 Agent MVP 的开发者工具联调

1. 在微信开发者工具中完成“自然语言 → 当前理解/目录推荐 → 路线卡 → 用户点击确认报价”联调；
2. 按部署环境的 `OPENROUTER_MODEL` 选择目标模型；recreate API 后确认目标模型的余额、配额和请求参数兼容性；
3. 生产前验证 DeepSeek 账户余额与限额、模型输出稳定性和数据策略；没有 key、余额不足或 Provider 失败时确认规则降级及 warning 对前端可见；
4. 补 `WX_SECRET`，验证微信登录和 Token 轮换（不阻塞游客态 Agent MVP）。

OAG Master Data 开通后，应通过现有 `oag_sync_location` 任务从 OAG 覆盖/更新本地种子数据；本地 `005_seed_mvp_airports` 作为 MVP 离线基线保留，OAG 数据进入后以 OAG 为权威并保留服务端白名单校验。

### P1：继续完善后端化业务

多城 `routePlanner` 迁移已完成：非 Mock 小程序的规划轮次统一调用 `/v1/agent/converse`，不再通过关键词进入旧链路；多轮上下文、请求代次保护、按单卡确认和结果合并均已接入，Mock 仅保留本地确定性降级。旧 `cloud/routePlanner` 仅用于兼容与离线协议测试，不是小程序运行依赖。

1. 让国家、机场选择器从 `/v1/countries`、`/v1/airports` 取数；
2. 将用户中转偏好接入后端并跨设备同步；
3. 把收藏、行程、价格提醒从本地 MobX 存储迁到后端；
4. 将当前仅本地的 Agent 会话历史按需升级为服务端同步，并增加工具调用编排、可观测性和提示词版本管理。

### P2：完善搜索产品能力

1. 当前 SerpApi 搜索能识别直飞和航司联程，`selfTransfer` 暂为空；后续增加自行拼票 Provider/组合器；
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
