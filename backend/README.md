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
- 兼容旧 `/v1/agent/chat` 多轮需求解析，OpenRouter 失败时可信规则降级；
- 统一 `/v1/agent/converse` 对话式旅行 Agent：客户端回传完整状态，服务端统一抽取、推荐和路线规划；
- 有明确攻略意图时，`/v1/agent/converse` 可按第一条确定性路线生成带公开网页来源的游玩攻略；
- SerpApi 实时报价搜索、标准化和 Redis 短缓存；
- 可选 `/v1/travel-guides` 路线攻略接口（仅接受已有路线和目录兴趣，不接受任意 URL/query）；
- 自建 `/v1/route-plans` 多城自然语言规划与 `/v1/route-plans/confirm` 逐段报价确认；
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
- `OPENROUTER_MODEL`（默认精确值 `deepseek/deepseek-v4-pro-0813`；可由部署环境或 `backend/.env` 替换）
- `WX_APPID` / `WX_SECRET`

路径变量采用当前适配器默认值；如果 OAG 订阅合同中的 endpoint 不同，只改环境变量，不改领域代码。

`:3000` 服务正式默认使用精确模型 `deepseek/deepseek-v4-pro-0813`，最终以运行环境解析到的 `OPENROUTER_MODEL` 为准。该付费模型需要 OpenRouter 账户余额、有效 `OPENROUTER_API_KEY` 和可用配额；自动化测试不会发起真实付费调用。当前业务请求传 `reasoning: { effort: 'none', exclude: true }` 时，V4 Pro 适配器会省略不兼容的 `reasoning` 字段；未来显式 `high`/`xhigh` 才转发，DeepSeek Chat 仍省略 reasoning，其他模型保持原有转发行为，且不会自动开启高推理。此前 DeepSeek V3 与 V4 Flash 的直连结果仅作历史样本，不代表当前默认模型。需要替换模型时只改部署环境或 `backend/.env` 的 `OPENROUTER_MODEL`，不要把模型 ID 硬编码到业务模块。

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
| POST | `/v1/agent/converse` | 统一多轮旅行对话；返回阶段、推荐、路线、待补字段与下一步操作 |
| POST | `/v1/travel-guides` | 根据已返回的目录路线生成带来源的按天游玩攻略 |
| POST | `/v1/flight-searches` | SerpApi 实时报价同步搜索（MVP 快速路径） |
| POST | `/v1/route-plans` | 解析多城自然语言约束并生成最多 3 条估算路线 |
| POST | `/v1/route-plans/confirm` | 对选中的路线逐段查询 SerpApi，失败段保留估算价 |
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

统一对话接口 `POST /v1/agent/converse` 同样无需登录，也不在服务端保存会话。客户端每轮回传 `messages`（1–24 条且至少一条 `user`）、上轮完整 `state`（可省略）、可选 `today` 和 `newTrip`。服务端严格拒绝未知字段，响应固定包含 `phase`、双语 `reply`、完整 `state`、`recommendations`、`routes`、`missing`、`suggestedActions`、`source` 与 `warnings`，并始终返回 `Cache-Control: no-store`；该路由另有每 IP 10 次/分钟的限流。`destination_mode=recommend` 时，目的地建议只来自服务端 catalog；明确城市才会进入 `required_iatas`，仅说国家不会猜成某个城市，显式多区域也必须为每个区域提供城市或明确授权推荐。推荐模式缺日期时先进入 `discover` 给出建议并只追问一个高价值问题；仅当 `origin`、`window_from`、`travel_days` 与显式目的地约束齐全才调用确定性 `planJourney`，实时航班/价格仍需走 `/v1/route-plans/confirm`。配置 OpenRouter 时，模型只做证据约束的抽取和最终措辞合成；最终双语回复会再次校验目录城市是否来自服务端已验证的推荐/路线，否则回退规则回复并标记 `reply_fallback`。V4 Pro 0813 的 `reasoning=none` 请求字段由共享 `OpenRouterClient` 省略，未来显式 `high`/`xhigh` 才正确转发；DeepSeek Chat 继续省略 reasoning，其他可配置模型仍按既有行为转发可选 reasoning，调用方不会因默认模型切换而自动开启高推理。没有 key、余额不足、Provider 错误或模型输出非法时，业务继续使用确定性规则降级并返回 `llm_fallback`/对应 warning，不把 Provider 错误细节或密钥带入响应。

预算解析支持明确的纯数字、`八千`、`一万五`、`一万五千`、`两万三`、`1万5`、`1万5千` 和 `1.5万` 等常见口语金额；`一万零五百`按 10500 解析，不完整或有歧义的表达不覆盖。若同一轮有确定性金额，规则值优先于模型的粗粒度金额；后续用户明确改预算时会覆盖客户端回传的旧值。

当最新用户轮明确包含“攻略 / 怎么玩 / 景点 / 每日安排 / 游玩规划 / travel guide / itinerary”等意图，且路线条件齐全并已生成至少一条确定性路线时，Agent 才会触发网页研究；普通路线请求只返回“生成游玩攻略”建议，不消耗 SerpApi 配额。攻略默认使用第一条路线，最多研究其中 3 个目录城市，每城最多 3 条 Google 摘要，单请求最多 2 个并发；搜索结果按规范化城市、兴趣和天数写入 Redis 12 小时缓存。SerpApi 只使用 `engine=google`，查询由服务端目录城市/IATA、受控兴趣枚举和天数组成，客户端不能传 URL、query 或 provider 参数。结果只保留 `http/https` 链接、标题、摘要和解析出的 domain，不抓取整页。

攻略响应新增可选 `travelGuide` 字段，包含双语 `summary`、`days`（每天的城市、活动标题/说明）、`sources`（`title`、`url`、`domain`、`source`）以及 `warnings`。`source` 只会是 `web`、`catalog` 或 `rules`；部分搜索失败仍返回目录级通用安排并标记 warning，无 key 或网络失败不会令对话 500。配置 OpenRouter 时，攻略编辑模型只能看到服务端路线、目录事实和网页摘要；每个模型活动必须引用摘要索引和原文证据，模型输出若包含未验证城市、具体营业时间、价格、签证、安全或预约结论，则丢弃并使用确定性安排。独立 `POST /v1/travel-guides` 仅接受既有 `route`、受控 `travel_days` 和兴趣枚举，另有每 IP 3 次/分钟限流，同样不缓存。

机场匹配优先级为：

1. 用户明确输入 IATA（如 `HND`、`NRT`）时以 IATA 为准；
2. 用户说具体机场/别名（如 `羽田`、`成田`、`大兴`、`首都机场`、`虹桥`、`浦东`、`盖特威克`、`希思罗`）时以该机场为准；
3. 用户只说城市时使用稳定 MVP 默认机场：东京→`NRT`、北京→`PEK`、上海→`PVG`、伦敦→`LHR`；
4. 同一城市的多个机场不会同时填入 origin 和 destination；
5. 只给国家（如“日本”）不会自动猜城市，仍会继续询问具体城市或 IATA。

“玩 7 天”“一周”等表达只生成 `stay_min`/`stay_max`；只有用户明确说单程或往返时才生成 `trip_type`。小程序检索界面的 roundtrip 是 UI 默认值，不代表 Agent 识别到了用户意图。

当前 MVP 机场数据来自 `src/mocks/airports.ts`，通过 `005_seed_mvp_airports` 迁移写入国家、城市、机场和 `airport_aliases`。机场种子包含成都双流 `CTU` 与成都天府 `TFU`，不得把两个代码混用。

行程规划接口无需登录。客户端只提交路线、已选航班航段、枢纽信息和可选的中转攻略素材，服务端通过 `OPENROUTER_MODEL` 调用 OpenRouter 编排双语时间轴。请求体严格校验 IATA、ISO 日期、航段数组、字符串和数值边界，并拒绝未知字段及相同的出发/目的地：

多城路线接口无需登录。`POST /v1/route-plans` 接收 `{ text, today? }`，其中 `text` 为 1–1000 个字符，`today` 必须是有效的 `YYYY-MM-DD`；省略时使用服务端 UTC 日期。规划阶段只做规则/LLM 约束抽取和确定性估算，不把模型输出当作航班或价格事实；LLM 异常、空响应或非法 JSON 会自动切换规则解析并在 `warnings` 返回 `llm_fallback`。返回的路线最多 3 条，`real`/`hasReal` 用于区分估算段。

`POST /v1/route-plans/confirm` 接收 1–3 条严格校验的 `RoutePick`；每条最多 8 段，整个请求的航段总数也不得超过 8，避免匿名请求一次触发过多 Provider 调用。所有 `cities`、`citySeq` 和航段端点必须属于路线引擎支持的 31 个 IATA allowlist：`CDG AMS FRA MUC ZRH VIE PRG FCO MXP BCN MAD LIS ATH BUD CPH HEL BKK KUL SIN HAN SGN DPS BEG IST CJU SZX CAN PVG PEK CTU HKG`。服务端对每段使用 SerpApi 单程查询，Provider 并发上限为 2，取该段最低的真实报价；Provider 返回的首段出发日期必须与请求航段日期一致才会标记 `real: true`。单段失败不会使整次请求失败，原估算段标记 `real: false`，并由 `probed`、`failed`、`note` 说明降级情况。该路由另有每 IP 3 次/分钟的 route-level 限流，并与全局 Provider 并发上限 2 配合。未配置 `SERPAPI_KEY` 时不发起 Provider 请求，直接返回估算路线并给出说明。Provider 的原始响应、错误文本和密钥不会出现在接口响应中。两条路线接口均返回 `Cache-Control: no-store`。

模型默认由 `OPENROUTER_MODEL=deepseek/deepseek-v4-pro-0813` 指定，最终以运行环境配置为准。可将其替换为当前可用的 OpenRouter 模型；模型可用性、计费和配额由账户及模型目录决定，部署前应自行确认余额和限额。此前 DeepSeek V3 与 V4 Flash 的直连结果仅作历史样本，不代表当前默认模型。

`OpenRouterClient` 统一处理模型兼容性：V4 Pro 0813 请求中的 `reasoning: { "effort": "none", "exclude": true }` 会安全省略，显式 `high`/`xhigh` 才转发；DeepSeek Chat 请求仍不会发送 reasoning，其他模型继续按既有行为转发可选 reasoning。业务调用保持 `none`，不会因“最佳模型”切换而自动启用高推理；`max_tokens` 与 `temperature` 仍按 OpenAI-compatible Chat Completions 方式发送；无 key 或 Provider 失败时不发起网络请求或自动降级到规则结果。

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

2026-09-02 旧 Docker 镜像历史联调样本（一次实测，不代表当前最终镜像、Provider 可用性、延迟或价格的稳定保证）：当时 Docker Compose 重建成功，API/Worker 正常运行，PostgreSQL/Redis healthy；数据库迁移 exit 0；`/health/ready` 返回 `ready` 且 PostgreSQL/Redis 均为 `ok`；`/v1/airports?query=东京` 返回 `HND`/`NRT`；非法行程航段拓扑请求返回 `400 INVALID_REQUEST`。该历史样本中的旧容器实际使用过 `OPENROUTER_MODEL=dots-studio/dots-3-note-preview:free`；未读取或披露任何 Provider key，配置来源不作当前断言：`POST /v1/route-plans` 返回 `source=llm`，耗时约 6.093 秒并生成 3 条路线；仅确认第一条 3 段路线时，耗时约 9.426 秒，3/3 段为 `real`，总价为 12051；提交非法 `AAA` IATA 返回 `400 INVALID_REQUEST`。同一次历史联调中，`/v1/trip-plans` 返回 `source=llm`、`warnings=[]`，约 6.1 秒生成 3 天方案，预算为航班 2300、住宿 800、活动 450、总计 3550；三例旧 `/v1/agent/chat` 也均为 `source=llm`，北京→东京识别为 `NRT`、北京→东京羽田识别为 `HND`、北京→日本保持 destination 缺失并继续追问，耗时约 2–3 秒。具体免费模型的 ID、配额和生命周期会变化或下线；以上仅为旧镜像历史记录。

本轮代码验证（代码级稳定检查）：后端 Vitest 共 20 个 test files、121/121 passed；后端 `check`、`build` 和 `git diff --check` 均通过。上述测试覆盖统一对话 schema/客户端状态 allowlist、显式目的地阻塞、多区域补全、规则与 LLM fallback/回复 grounding、无 key、动态日期、软性少中转偏好、确认映射/部分失败/日期不匹配、预算口语金额解析（含歧义表达不覆盖）与规则优先于 LLM 粗解析、跨并发调用的全局 Provider semaphore 及限流配置，以及 OpenRouter 请求参数兼容性；一次 Docker 样本中的 Provider 延迟和票价不构成稳定性承诺。

此前模型切换前的 Provider/服务函数直连验证（2026-09-04，均从 `backend/dist` 调用、不依赖 DB，未输出或记录 key）：OpenRouter `deepseek/deepseek-chat` 的最小“仅回复 OK”请求返回 `success=true`、`content=OK`，只证明当时旧模型与验证环境可用；核心 Agent 原文“我从北京出发，10月1日去日本玩7天，预算一万五，喜欢文化和美食，你帮我选择城市并规划路线”返回 `source=llm`、`phase=plan`、`origin=PEK`、`travel_days=7`、`budget_max=15000`、`destination_mode=recommend`、推荐 `[KIX,NRT]`、2 条路线、`warnings=[]`，修复了此前预算 10000 的问题；攻略第一次组合调用瞬时 `search_failed` 后安全降级 catalog，同一 SerpApi Google Search 直接重试得到 3 条结果，完整旧 DeepSeek 重试返回 `source=web`、3 天游玩、4 个来源、网页域名 `www.facebook.com` / `mercure.accor.com` / `janicerohrssen.com`，并带 `travel_guide_llm_fallback`。该 warning 表示编辑输出未通过严格 grounding，服务保留网页摘要驱动的确定性日程；攻略链路成功但不是当前 V4 Pro、也不是无 warning 的理想 LLM 编辑质量。此前 DeepSeek V3 与 V4 Flash 的直连结果同样仅作历史样本，不代表当前默认模型。

当前默认 V4 Pro 付费 Provider 直连验证（2026-09-04，从 `backend/dist` 调用、不依赖 DB，未输出或记录 key）：使用 `.env` 默认值且调用处未显式提供 model override；请求带业务现有 `reasoning: { effort: 'none', exclude: true }`，共享适配器省略该字段。`configuredModel=deepseek/deepseek-v4-pro-0813`、`responseModel=deepseek/deepseek-v4-pro-0813`、`success=true`、`content=V4 Pro 配置验证成功。`、`promptTokens=97`、`completionTokens=60`、`totalTokens=157`、`cost=$0.00036564`。这证明当前 key、余额、模型 ID 和默认适配路径可用，但不代表 Docker HTTP/UI 已验证。

Docker/HTTP 验证（2026-09-04）：`docker compose ps` 无法连接 `dockerDesktopLinuxEngine`，`localhost:3000` 拒绝连接，故最终 compose 镜像与微信开发者工具 UI 尚未实测。自动验证仍为根项目 `npm test` 140/140、后端 20 个 test files / 121 tests；root/backend typecheck、backend build、weapp build、`git diff --check` 均通过。

## 8. 安全说明

- 不要将 `.env`、Provider 原始响应或微信 OpenID 提交到 Git；
- 不要把 OAG/SerpApi/OpenRouter key 注入小程序；
- API 日志已经对授权头、登录 code、refresh token 和常见 token 字段脱敏；
- `health/providers` 只返回布尔状态；
- 当前开发 JWT Secret 上生产前必须替换；
- 已经通过聊天、截图或其他渠道发送过的 Provider key，上线前应撤销并重新生成。
