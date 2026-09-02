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

长期架构以自建 API、Worker、PostgreSQL、Redis 为核心。微信云函数仅是迁移期代码或可选回退，不应成为核心业务的强依赖。

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

cloud/               旧微信云函数和可迁移的领域原型
config/              Taro 构建配置
scripts/             离线测试与生成脚本
docs/                架构、部署、OAG 与多城设计文档
dist/                小程序构建产物
compose.yaml         PostgreSQL、Redis、API、Worker 编排
```

`cloud/` 中仍有多城规划、聊天、价格趋势等能力，但新功能应优先进入 `backend/`。若复用旧云函数中的纯算法，应迁移纯逻辑，不要把 `wx-server-sdk` 或云数据库依赖带入自建后端。

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

Agent 对话和报价搜索已经走自建后端。小程序包不再注入 SerpApi、OpenRouter 或 OAG 密钥。

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
- `/v1/agent/chat` 多轮需求槽位提取，服务端机场白名单与 OpenRouter 调用；
- `/v1/trip-plans` 接收选中航班与路线事实，服务端生成行程时间轴，支持 `source=llm|rules` 及非阻塞 `warnings`；
- OpenRouter 不可用、超时或返回非结构化内容时自动规则降级，核心演示不因免费模型波动中断；
- 小程序 Agent 页参数齐全后可调用真实航班搜索并生成最省钱/最舒适/长中转备选卡；
- Agent 对预算、兴趣、天数、行程类型和中转偏好采用文本证据校验，防止免费模型填入用户未表达的默认值；
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
| POST | `/v1/agent/chat` | 多轮理解行程需求，返回槽位与待补信息 |
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

2026-09-02 root 真实审核：Docker Compose 重建成功；API、Worker 正常运行，PostgreSQL、Redis 均为 healthy；数据库 migrate exit 0；`/health/ready` 返回 `ready`，其中 `postgres=ok`、`redis=ok`；`/health/providers` 显示 OpenRouter、SerpApi 已配置，微信登录未配置（`false`）。`GET /v1/airports?query=东京` 返回 HND/NRT。非法 trip-plan 航段拓扑请求返回 HTTP 400 `INVALID_REQUEST`。

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

## 8. 外部 API 实测状态

以下为 2026-09-02 root 真实审核的本地配置与容器实测；状态可能变化，联调前应重新探测：

| Provider/API | 状态 | 结论 |
|---|---|---|
| OAG Schedules `/flights` | HTTP 401 | Production 订阅显示 `submitted`，需 OAG 激活或更换有效 key |
| OAG Master Data `/locations` | HTTP 401 | Production 订阅显示 `submitted`，需 OAG 激活或更换有效 key |
| OAG Connections `/flight-connections` | 成功 | 已返回并成功归一化连接数据 |
| OAG Flight Info `/flight-instances/` | 成功 | 已返回并成功归一化直飞数据，可作为 Schedules 降级 |
| SerpApi Google Flights | 成功 | 已返回真实报价并通过后端映射 |
| OpenRouter `/chat/completions` | 配置已验证 | 正式 `:3000` 仍使用 `backend/.env` 当前的 `openrouter/free`；`:3001` 另以临时环境变量验证了具体免费模型 |
| OpenRouter Dots 免费模型 | `:3001` 调用成功 | 临时 override 为 `OPENROUTER_MODEL=dots-studio/dots-3-note-preview:free`；官方 `expiration_date=2026-09-30`，仅作当前 MVP 候选，不可长期依赖，后续应查官方免费列表并切换 |
| 自建行程 `/v1/trip-plans` | `:3001` `source=llm`，`warnings` 为空，约 6.1 秒 | 临时 override 未修改任何 `.env`；预算项为 `2300 + 800 + 450 = 3550` |
| Agent `/v1/agent/chat` | `:3001` 三例真实请求均 `source=llm`，约 2–3 秒 | 东京默认解析为 NRT；东京羽田解析为 HND；只说日本时不猜目的地 |
| 微信登录 | 配置状态 `false` | `WX_SECRET` 为空，补齐后才能完成正式登录联调 |

`/health/providers` 只检查 key 是否存在，不进行付费/配额相关真实调用。不要用该接口判断订阅是否 active。

2026-08-31 查询 OpenRouter 实时模型列表时，没有可用的 `deepseek/...:free` 型号；历史 DeepSeek 免费 ID 均返回 404，并明确提示只能使用付费版本。OpenRouter 网站设置无法重新开启已经下线的免费型号。若必须固定使用 DeepSeek，需要选择付费 DeepSeek 模型并确保账号余额可用；若优先零费用，继续使用 `openrouter/free`。

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

截至 2026-09-02，root 真实审核与代码验证结果：

- Docker Compose 重建成功；API、Worker 正常运行，PostgreSQL、Redis 均为 healthy；
- 数据库 migrate exit 0；`/health/ready` 返回 `ready`，`postgres=ok`、`redis=ok`；`/health/providers` 显示 OpenRouter=true、SerpApi=true、微信登录=false；
- `GET /v1/airports?query=东京` 返回 HND/NRT；非法 trip-plan 航段拓扑请求返回 HTTP 400 `INVALID_REQUEST`；
- 使用未修改 `.env` 的临时环境变量 override（`OPENROUTER_MODEL=dots-studio/dots-3-note-preview:free`）在 `:3001` 验证 `/v1/trip-plans`：`source=llm`、`warnings` 为空、约 6.1 秒，预算为 `2300 + 800 + 450 = 3550`；
- `:3001` Agent 三例真实请求均为 `source=llm`、约 2–3 秒：东京默认 NRT、东京羽田 HND、只说日本不猜目的地；
- 后端测试 46/46、根项目测试 111/111；前后端 TypeScript 检查与构建、小程序 `weapp` 构建、`git diff --check`、`docker compose config --quiet` 均通过。

模型环境边界：正式 `:3000` 仍使用 `backend/.env` 当前的 `OPENROUTER_MODEL=openrouter/free`。如需采用具体模型，用户需修改 `OPENROUTER_MODEL` 后 recreate API；本次 `:3001` 的 Dots override 未修改 `.env`。Dots 官方 `expiration_date=2026-09-30`，只是当前 MVP 候选，不可长期依赖；后续应查询官方免费模型列表并切换。

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

1. 在微信开发者工具中完成“自然语言 → 参数卡 → 生成方案 → 真实报价卡”联调；
2. 若正式采用具体模型，修改 `backend/.env` 的 `OPENROUTER_MODEL` 后 recreate API；`:3000` 当前仍是 `openrouter/free`；
3. 生产前评估 `openrouter/free` 的免费配额、动态模型输出稳定性和数据策略，并在 Dots 于 2026-09-30 到期前查询官方免费列表完成切换评估；
4. 补 `WX_SECRET`，验证微信登录和 Token 轮换（不阻塞游客态 Agent MVP）。

OAG Master Data 开通后，应通过现有 `oag_sync_location` 任务从 OAG 覆盖/更新本地种子数据；本地 `005_seed_mvp_airports` 作为 MVP 离线基线保留，OAG 数据进入后以 OAG 为权威并保留服务端白名单校验。

### P1：继续解除云函数/本地 Mock 依赖

1. 将多城 `routePlanner` 迁到后端 `/v1/route-plans`；当前带“多城/几个城市/串起来”等关键词的对话仍进入旧规划链路；
2. 让国家、机场选择器从 `/v1/countries`、`/v1/airports` 取数；
3. 将用户中转偏好接入后端并跨设备同步；
4. 把收藏、行程、价格提醒从本地 MobX 存储迁到后端；
5. 增加 Agent 会话持久化、工具调用编排、可观测性和提示词版本管理。

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
