# FlightOR 项目上下文与开发交接

> 最后更新：2026-08-31
> 用途：为后续迭代快速恢复上下文。每次完成会影响架构、启动方式、接口、外部依赖或 MVP 范围的开发后，应同步更新本文。

## 1. 当前目标与产品原则

FlightOR 是国际航线比价与多城路线规划微信小程序，前端使用 Taro + React + MobX。

当前目标不是执行旧的十几天瀑布式计划，而是敏捷跑通可演示 MVP：

1. 用户能在小程序中提交机场和日期条件；
2. 请求进入 FlightOR 自建后端；
3. 后端安全调用第三方 Provider，返回真实报价；
4. OAG 数据可支撑直飞/中转可达性与安全衔接判断；
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
      -> OpenRouter：后续 AI Gateway

FlightOR Worker
  -> PostgreSQL jobs 队列
  -> OAG 同步
  -> 新拓扑版本构建并原子激活
```

报价搜索已经走自建后端。小程序包不再注入 SerpApi、OpenRouter 或 OAG 密钥。

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

上次检查时 Docker Desktop 没有运行，因此代码、Provider 和构建验证已完成，但 PostgreSQL/Redis 容器端到端验证仍需在 Docker 启动后执行。

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

注意：环境变量是构建时常量。修改 API 地址或 Mock 开关后必须重新构建。2026-08-31 最后一次生成的 `dist/` 是连接 `http://127.0.0.1:3000` 的非 Mock 产物；再次执行无环境变量的构建会恢复为 Mock。

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

以下为 2026-08-31 使用当前本地配置进行的真实小请求结果；状态可能变化，联调前应重新探测：

| Provider/API | 状态 | 结论 |
|---|---|---|
| OAG Schedules `/flights` | HTTP 401 | Production 订阅显示 `submitted`，需 OAG 激活或更换有效 key |
| OAG Master Data `/locations` | HTTP 401 | Production 订阅显示 `submitted`，需 OAG 激活或更换有效 key |
| OAG Connections `/flight-connections` | 成功 | 已返回并成功归一化连接数据 |
| OAG Flight Info `/flight-instances/` | 成功 | 已返回并成功归一化直飞数据，可作为 Schedules 降级 |
| SerpApi Google Flights | 成功 | 已返回真实报价并通过后端映射 |
| OpenRouter `/chat/completions` | HTTP 403 | 当前模型提示 `This model is not available in your region.`，需更换区域可用模型或路由设置 |
| 微信登录 | 未验证 | `WX_SECRET` 为空，补齐后才能完成正式登录联调 |

`/health/providers` 只检查 key 是否存在，不进行付费/配额相关真实调用。不要用该接口判断订阅是否 active。

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

### 工程约束

- 首期保持模块化单体，不拆微服务；
- API 与 Worker 共用领域代码，但以不同进程运行；
- 所有 Provider 通过服务端适配器调用；
- 新接口使用 `/v1`、Zod 输入校验和统一错误格式；
- 日志不得记录密钥、Authorization、微信 code、refresh token、OpenID 或完整敏感响应；
- 数据同步构建新拓扑版本，完成后原子激活；失败时继续使用旧版本；
- 报价缓存只能短期使用，并保留“价格以实际购买为准”的提示；
- 修改已有未提交文件前先查看 `git diff`，不要覆盖用户或其他开发者的改动。

## 10. 当前验证基线

2026-08-31 已通过：

- 根项目全量测试：111 项断言通过；
- 后端 Vitest：14/14 通过；
- 根项目 `npx tsc --noEmit`；
- 后端 `npm run check`；
- 后端 `npm run build`；
- 小程序 `npm run build:weapp`；
- 非 Mock 小程序构建；
- `git diff --check`；
- 构建产物密钥扫描：未发现当前第三方密钥。

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

### P0：完成真实端到端联调

1. 启动 Docker Desktop，执行迁移并验证 API、Worker、PostgreSQL、Redis；
2. 调用 `/v1/flight-searches` 完成小程序真实报价搜索；
3. 补 `WX_SECRET`，验证微信登录和 Token 轮换；
4. 推动 OAG 激活 Schedules、Master Data；在此之前保留 Flight Info + Connections 降级；
5. 为 OpenRouter 选择当前区域可用模型并重新验证。

### P1：继续解除云函数/本地 Mock 依赖

1. 将多城 `routePlanner` 迁到后端 `/v1/route-plans`；
2. 将聊天与需求解析迁到后端 AI Gateway；
3. 让国家、机场选择器从 `/v1/countries`、`/v1/airports` 取数；
4. 将用户中转偏好接入后端并跨设备同步；
5. 把收藏、行程、价格提醒从本地 MobX 存储迁到后端。

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
