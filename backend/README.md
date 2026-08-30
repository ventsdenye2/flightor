# FlightOR Backend

FlightOR 的独立自部署后端。当前骨架包含：

- Fastify + TypeScript API；
- PostgreSQL / Kysely 迁移；
- Redis 限流和健康检查；
- 微信登录、Access Token、Refresh Token 轮换；
- 国家、机场、中转国家偏好接口；
- 带数据版本的三态可达性查询；
- OAG、SerpApi、OpenRouter 服务端 Provider；
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

第三方 Provider：

- `OAG_FLIGHT_INFO_KEY`
- `OAG_CONNECTIONS_KEY`（Flight Info Trial 包含 Connections 时可以复用 Trial key）
- `OAG_SCHEDULES_KEY`
- `OAG_MASTER_DATA_KEY`
- `SERPAPI_KEY`
- `OPENROUTER_API_KEY`
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
| GET | `/health/providers` | 仅返回 Provider 是否配置，不返回密钥 |
| POST | `/v1/auth/wechat` | 微信 code 登录 |
| POST | `/v1/auth/refresh` | Refresh Token 轮换 |
| GET | `/v1/countries` | 热门国家与国家搜索 |
| GET | `/v1/airports` | IATA/ICAO/中英文机场城市搜索 |
| GET | `/v1/users/me/transit-country-preferences` | 当前用户中转国家偏好 |
| PUT | `/v1/users/me/transit-country-preferences` | 整体替换 preferred / excluded |
| POST | `/v1/reachability/query` | 最多两次中转、无闭环、日期级三态可达性 |

偏好接口需要：

```text
Authorization: Bearer <access-token>
```

偏好只有 `preferred` 与 `excluded`，没有记录即“不限”。同一个国家不能同时出现在两个数组。

## 4. 数据库迁移

```bash
npm run migrate
npm run migrate:down
```

首版迁移创建国家—城市—机场、用户会话、国家偏好、OAG 时刻与连接、拓扑版本、报价、推荐、行程、价格提醒、同步记录和 Worker 任务等表。

同步采取“新版本构建完成后激活”的方式；生产搜索不能读取正在构建的半成品拓扑。

## 5. Worker

Worker 从 `jobs` 表原子领取任务：

```sql
for update skip locked
```

多个 Worker 不会互相等待或领取同一任务。失败任务按指数退避重试，超过上限进入 `failed`；超过 15 分钟仍被锁定的任务会在 Worker 启动时恢复。

当前注册任务：

- `noop`：队列链路测试；
- `oag_locations_probe`：显式触发 OAG Master Data 小流量探测。

不会自动调用第三方 Provider，避免启动服务就消耗试用额度。正式 Master Data / Schedules / Connections 同步处理器将在下一阶段接入。

## 6. 验证

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

## 7. 安全说明

- 不要将 `.env`、Provider 原始响应或微信 OpenID 提交到 Git；
- 不要把 OAG/SerpApi/OpenRouter key 注入小程序；
- API 日志已经对授权头、登录 code、refresh token 和常见 token 字段脱敏；
- `health/providers` 只返回布尔状态；
- 当前开发 JWT Secret 上生产前必须替换；
- 已经通过聊天、截图或其他渠道发送过的 Provider key，上线前应撤销并重新生成。
