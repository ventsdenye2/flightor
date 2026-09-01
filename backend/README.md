# FlightOR Backend

FlightOR 的独立自部署后端。当前骨架包含：

- Fastify + TypeScript API；
- PostgreSQL / Kysely 迁移；
- Redis 限流和健康检查；
- 微信登录、Access Token、Refresh Token 轮换；
- 国家、机场、中转国家偏好接口；
- 带数据版本的三态可达性查询；
- OAG 路线同步、响应归一化、拓扑边重建与原子版本切换；
- 国家偏好、安全衔接和长中转软排序；
- OAG、SerpApi、OpenRouter 服务端 Provider；
- 自建 `/v1/agent/chat` 多轮需求解析，OpenRouter 失败时可信规则降级；
- SerpApi 实时报价搜索、标准化和 Redis 短缓存；
- PostgreSQL `FOR UPDATE SKIP LOCKED` 持久 Worker；
- Docker Compose 本地部署。

完整架构见 [`../docs/backend-architecture.md`](../docs/backend-architecture.md)。

## 1. 配置

```bash
cd backend
copy .env.example .env
```

真实密钥只允许写入 `backend/.env` 或生产环境的 Secret Manager。`.env` 已同时被 Git 和 Docker build context 排除。

必须配置：

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`（至少 32 个字符，每个环境使用独立随机值）
- `ADMIN_API_TOKEN`（启用管理同步接口时设置，通过 `X-Admin-Token` 传入）

第三方 Provider：

- `OAG_FLIGHT_INFO_KEY`
- `OAG_CONNECTIONS_KEY`（Flight Info Trial 包含 Connections 时可以复用 Trial key）
- `OAG_SCHEDULES_KEY`
- `OAG_MASTER_DATA_KEY`
- `SERPAPI_KEY`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`（MVP 默认 `openrouter/free`；免费池动态选择模型）
- `WX_APPID` / `WX_SECRET`

路径变量采用当前适配器默认值；如果 OAG 订阅合同中的 endpoint 不同，只改环境变量，不改领域代码。

## 2. 本地运行

完整容器方式：

```bash
docker compose up -d --build
```

仅用 Docker 启动依赖、在宿主机开发：

```bash
docker compose up -d postgres redis
cd backend
npm install
npm run migrate
npm run dev
```

另一个终端启动 Worker：

```bash
cd backend
npm run dev:worker
```

默认地址：

- API：`http://localhost:3000`
- 健康检查：`http://localhost:3000/health/live`
- 就绪检查：`http://localhost:3000/health/ready`
- Provider 配置状态：`http://localhost:3000/health/providers`
- OpenAPI UI：`http://localhost:3000/docs`

## 3. 当前 API

| Method | Path | 说明 |
|---|---|---|
| GET | `/health/live` | API 进程存活 |
| GET | `/health/ready` | PostgreSQL / Redis 就绪 |
| GET | `/health/providers` | 仅返回 Provider 是否配置（明确标记 `verified=false`），不探测也不返回密钥 |
| POST | `/v1/auth/wechat` | 微信 code 登录 |
| POST | `/v1/auth/refresh` | Refresh Token 轮换 |
| POST | `/v1/agent/chat` | 多轮提取行程槽位；OpenRouter 不可用时自动规则降级 |
| POST | `/v1/flight-searches` | SerpApi 实时报价同步搜索（MVP 快速路径） |
| GET | `/v1/countries` | 热门国家与国家搜索 |
| GET | `/v1/airports` | IATA/ICAO/中英文机场城市搜索 |
| GET | `/v1/users/me/transit-country-preferences` | 当前用户中转国家偏好 |
| PUT | `/v1/users/me/transit-country-preferences` | 整体替换 preferred / excluded |
| POST | `/v1/reachability/query` | 最多两次中转、无闭环、日期级三态可达性 |
| POST | `/v1/admin/sync/oag/location` | 将单个 OAG 机场同步任务写入队列 |
| POST | `/v1/admin/sync/oag/route` | 将指定 OD/日期的 OAG 同步任务写入队列 |
| GET | `/v1/admin/jobs/:id` | 轮询管理任务状态 |
| GET | `/v1/admin/sync-runs/:id` | 查询同步执行状态 |

偏好接口需要：

```text
Authorization: Bearer <access-token>
```

偏好只有 `preferred` 与 `excluded`，没有记录即“不限”。同一个国家不能同时出现在两个数组。

搜索接口支持最多 3 个出发机场、3 个到达机场和 31 天出发窗口；长窗口均匀采样最多 4 天，以控制第三方配额。响应按前端现有 `direct / selfTransfer / airlineTransfer` 契约返回，其中 SerpApi 暂不识别自行拼票，因此 `selfTransfer` 当前为空数组。

Agent 接口无需登录即可用于 MVP。客户端传最近的对话和已确认槽位，后端从 PostgreSQL 读取有效机场白名单并调用 OpenRouter；模型只能负责理解和提取需求，不能作为航班、价格、签证或衔接安全的事实来源。预算、兴趣、行程天数、中转偏好等可选字段必须能从用户原文中按规则找到明确证据，模型单独返回的虚构默认值会被丢弃。响应中的 `source` 为 `llm` 或 `rules`，`warnings` 包含 `llm_fallback` 时表示本轮已自动使用规则解析，用户仍可继续对话。

```json
{
  "messages": [{ "role": "user", "content": "2026年9月15日从新加坡去伦敦，玩7天，预算8000" }],
  "slots": {}
}
```

## 4. 小程序真实模式

小程序默认保留 Mock 演示。连接本机 API 时，在项目根目录运行：

```powershell
$env:FLIGHTOR_USE_MOCK='false'
$env:FLIGHTOR_API_BASE_URL='http://127.0.0.1:3000'
npm run dev:weapp
```

第三方 Provider key 仅从 `backend/.env` 读取。不要恢复根目录 `openrouter.txt` / `serpapi.txt` 的编译期注入方式。

## 5. 数据库迁移

```bash
npm run migrate
npm run migrate:down
```

首版迁移创建国家—城市—机场、用户会话、国家偏好、OAG 时刻与连接、拓扑版本、报价、推荐、行程、价格提醒、同步记录和 Worker 任务等表。

同步采取“新版本构建完成后激活”的方式；生产搜索不能读取正在构建的半成品拓扑。

## 6. Worker

Worker 从 `jobs` 表原子领取任务：

```sql
for update skip locked
```

多个 Worker 不会互相等待或领取同一任务。失败任务按指数退避重试，超过上限进入 `failed`；超过 15 分钟仍被锁定的任务会在 Worker 启动时恢复。

当前注册任务：

- `noop`：队列链路测试；
- `oag_locations_probe`：显式触发 OAG Master Data 小流量探测。
- `oag_sync_location`：归一化并写入国家—城市—机场层级；
- `oag_sync_route`：读取指定 OD/日期范围，建立新拓扑版本，完整后原子激活。

服务启动不会自动调用第三方 Provider，避免无意消耗试用额度。只有管理接口明确入队后才会同步。

路线同步允许供应商部分成功：例如 Schedules 临时不可用但 Connections 返回了已验证连接时，仍会用连接中的两个航段构建部分拓扑，并在同步结果中记录 Provider 警告。`coverage_complete=false` 时，没有找到路径仍返回 `unknown`，不会误报为不可达。

`POST /v1/reachability/query` 可传：

- `preferredCountries` / `excludedCountries`；登录用户的已保存偏好会自动合并；
- `minConnectionMinutes`，最小为 60 分钟；自行中转仍采用至少 240 分钟的保守下限；
- `preferredConnectionMinutes`，默认 720 分钟。超过该时长只降低排序并标记 `long_connection`，不会过滤；6 小时以上会标记 `stopoverPlayable`。

## 7. 验证

```bash
npm run check
npm test
npm run build
docker compose config --quiet
```

在 Docker 引擎可用后，再执行：

```bash
docker compose up -d postgres redis
npm run migrate
```

然后确认 `/health/ready` 返回 PostgreSQL 与 Redis 均为 `ok`。

## 8. 安全说明

- 不要将 `.env`、Provider 原始响应或微信 OpenID 提交到 Git；
- 不要把 OAG/SerpApi/OpenRouter key 注入小程序；
- API 日志已经对授权头、登录 code、refresh token 和常见 token 字段脱敏；
- `health/providers` 只返回布尔状态；
- 当前开发 JWT Secret 上生产前必须替换；
- 已经通过聊天、截图或其他渠道发送过的 Provider key，上线前应撤销并重新生成。
