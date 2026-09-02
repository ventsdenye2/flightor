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
- `OPENROUTER_MODEL`（默认 `openrouter/free`；也可在部署环境设置为 OpenRouter 当前可用的具体免费模型 ID，免费模型的 ID、配额和生命周期会变化或下线）
- `WX_APPID` / `WX_SECRET`

路径变量采用当前适配器默认值；如果 OAG 订阅合同中的 endpoint 不同，只改环境变量，不改领域代码。

正式 `:3000` 服务当前仍读取 `backend/.env` 中的 `OPENROUTER_MODEL=openrouter/free`。若要复现具体免费模型的延迟，需由用户在运行环境中自行设置 `OPENROUTER_MODEL`；不要依赖 OpenRouter 网站设置，且具体免费模型随时可能变化或下线。

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
| POST | `/v1/trip-plans` | 根据已选航班事实生成单目的地双语行程；OpenRouter 异常时自动规则降级 |
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

机场匹配优先级为：

1. 用户明确输入 IATA（如 `HND`、`NRT`）时以 IATA 为准；
2. 用户说具体机场/别名（如 `羽田`、`成田`、`大兴`、`首都机场`、`虹桥`、`浦东`、`盖特威克`、`希思罗`）时以该机场为准；
3. 用户只说城市时使用稳定 MVP 默认机场：东京→`NRT`、北京→`PEK`、上海→`PVG`、伦敦→`LHR`；
4. 同一城市的多个机场不会同时填入 origin 和 destination；
5. 只给国家（如“日本”）不会自动猜城市，仍会继续询问具体城市或 IATA。

“玩 7 天”“一周”等表达只生成 `stay_min`/`stay_max`；只有用户明确说单程或往返时才生成 `trip_type`。小程序检索界面的 roundtrip 是 UI 默认值，不代表 Agent 识别到了用户意图。

当前 MVP 机场数据来自 `src/mocks/airports.ts`，通过 `005_seed_mvp_airports` 迁移写入国家、城市、机场和 `airport_aliases`。机场种子包含成都双流 `CTU` 与成都天府 `TFU`，不得把两个代码混用。

行程规划接口无需登录。客户端只提交路线、已选航班航段、枢纽信息和可选的中转攻略素材，服务端通过 `OPENROUTER_MODEL` 调用 OpenRouter 编排双语时间轴。请求体严格校验 IATA、ISO 日期、航段数组、字符串和数值边界，并拒绝未知字段及相同的出发/目的地：

如需固定具体免费模型，可将 `OPENROUTER_MODEL` 设置为 OpenRouter 当前免费模型列表中的模型 ID；不要在代码或文档中硬编码有下线日期的模型，免费模型的 ID、配额和可用性会变化。

选择 Dots 等支持 reasoning 参数的免费模型时，行程规划和 Agent 请求会显式使用 `reasoning: { "effort": "none", "exclude": true }`，把 `max_tokens` 留给结构化 JSON 正文，避免推理 token 用尽后返回空内容；该行为不依赖或硬编码具体模型 ID。

```json
{
  "route": {
    "origin": "PEK",
    "destination": "LHR",
    "depart_date": "2026-09-15",
    "stay_days": 5,
    "budget_max": 8000,
    "interests": ["culture", "food"]
  },
  "flight": {
    "price": 2300,
    "segments": [{
      "flightNo": "CA937",
      "airline": "Air China",
      "origin": "PEK",
      "destination": "LHR",
      "departTime": "2026-09-15T13:00:00+08:00",
      "arriveTime": "2026-09-15T18:00:00+01:00",
      "duration": 660
    }],
    "hub": null
  },
  "hub_guide": null
}
```

响应保持小程序 `TripPlan` 契约，并附加 `source`（`llm` 或 `rules`）和 `warnings`。模型只负责编排，服务端会丢弃非法 JSON/字段，强制用请求中的航班价格覆盖 `budgetCny.flights`，并重新计算 `budgetCny.total`；模型不可改写航段事实。OpenRouter 超时、未配置、响应无法解析或未通过白名单清洗时返回确定性的双语规则方案，并在 `warnings` 中加入 `llm_fallback`。规则方案覆盖 1–7 天、跨日航段、8 小时以上长中转、枢纽攻略/签证素材和自行中转风险提醒，响应禁止缓存（`Cache-Control: no-store`）。

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

`005_seed_mvp_airports` 是当前 MVP 机场种子迁移：以 `src/mocks/airports.ts` 为基线，补齐国家（ISO 3166-1 alpha-2）、城市、机场经纬度、中英文名称和常用别名。国家和城市冲突采用 `DO NOTHING`，机场通过 `cities.iata_code` JOIN 获取 bigint `city_id`，冲突时只补空的本地字段，不覆盖已有权威名称、坐标、`active` 或 `source_updated_at`；别名冲突采用 `DO NOTHING`。由于表中没有迁移来源标记，`down` 是保守 no-op，不删除任何别名、机场、城市或国家。

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

2026-09-02 真实容器审核：Docker Compose 重建成功，API/Worker 正常运行，PostgreSQL/Redis healthy；数据库迁移 exit 0；`/health/ready` 返回 `ready` 且 PostgreSQL/Redis 均为 `ok`；`/v1/airports?query=东京` 返回 `HND`/`NRT`；非法行程航段拓扑请求返回 `400 INVALID_REQUEST`。临时通过容器环境变量指定 `OPENROUTER_MODEL=dots-studio/dots-3-note-preview:free`（未修改 `backend/.env`）验证：`/v1/trip-plans` 返回 `source=llm`、`warnings=[]`，约 6.1 秒生成 3 天方案，预算为航班 2300、住宿 800、活动 450、总计 3550；三例 `/v1/agent/chat` 也均为 `source=llm`，北京→东京识别为 `NRT`、北京→东京羽田识别为 `HND`、北京→日本保持 destination 缺失并继续追问，耗时约 2–3 秒。具体免费模型的 ID、配额和生命周期会变化或下线。

本轮代码验证：后端 `check`、`build`、Vitest（46/46，含 21 个 Agent 用例、10 个行程规划用例和 1 个 OpenRouter 客户端用例）、根项目全量 `npm test`（111/111）、根项目 `npx tsc --noEmit`、`npm run build:weapp` 和 `git diff --check` 均通过。

## 8. 安全说明

- 不要将 `.env`、Provider 原始响应或微信 OpenID 提交到 Git；
- 不要把 OAG/SerpApi/OpenRouter key 注入小程序；
- API 日志已经对授权头、登录 code、refresh token 和常见 token 字段脱敏；
- `health/providers` 只返回布尔状态；
- 当前开发 JWT Secret 上生产前必须替换；
- 已经通过聊天、截图或其他渠道发送过的 Provider key，上线前应撤销并重新生成。
