# FlightOR 自部署后端设计

> 状态：设计基线
> 适用阶段：MVP 到首个生产版本
> 原则：先做可扩展的模块化单体，不在业务边界和流量尚未稳定时拆微服务。

## 1. 当前仓库结论

当前项目**没有一个可独立部署的正式后端服务**。

已经存在的服务端能力是 `cloud/` 下的微信云函数：

- `searchProxy`：SerpApi / Duffel 报价代理、OAG 航班与机场数据适配、内存拓扑缓存；
- `routePlanner`：自然语言约束解析、多城路线搜索、最终路线价格确认；
- `chatAgent` / `tripAgent`：OpenRouter 对话与行程编排；
- `login`：微信登录和云数据库用户建档；
- `priceAlert` / `priceTrend`：价格提醒与趋势。

但它们目前仍有这些限制：

- 部署文档标明云函数尚未上传部署；
- 前端 `BASE_URL` 是占位地址，`USE_MOCK=true`；
- 用户、中转偏好等状态主要在小程序本地，缺少统一持久化；
- OAG 拓扑存在函数进程内存中，实例重启即丢失，不同实例也不共享；
- 没有 PostgreSQL、共享缓存、数据库迁移、任务队列、备份、监控和独立部署配置；
- 部分降级路径仍可能让小程序直接调用第三方 API，生产环境不可接受。

因此，现有代码应视为“领域原型 + 云函数适配层”，而不是最终后端。

## 2. 目标和边界

### 2.1 首期目标

后端需要成为以下数据和规则的唯一可信执行端：

1. 国家、城市、机场、航司的分层主数据；
2. 航班时刻、机场之间是否可达、最多两次中转的候选拓扑；
3. 最低安全衔接时间、无闭环等硬约束；
4. 价格、总时长、长中转、国家偏好等软排序；
5. 用户、中转国家偏好、收藏、行程和价格提醒；
6. OAG、SerpApi、OpenRouter 等第三方密钥和调用配额；
7. 可观测、可重试、可回滚的数据同步与搜索任务。

### 2.2 首期不做

- 不自建出票、支付、退改签系统；
- 不承诺 OAG 时刻等于实时可售价格；
- 不用大模型判断航班是否真实存在、签证是否合法或衔接是否安全；
- 不一开始引入图数据库、Kafka 或多套微服务；
- 不把长中转作为硬过滤条件。

## 3. 总体架构

```text
微信小程序
    │ HTTPS + Access Token
    ▼
反向代理 / TLS / 限流
    │
    ▼
FlightOR API（Fastify + TypeScript，模块化单体）
    ├── Auth                    微信登录、会话
    ├── Reference Data          国家/城市/机场/航司
    ├── Aviation Data           OAG 适配与数据版本
    ├── Topology                可达性、候选路径、MCT 校验
    ├── Search                  报价搜索、标准化、去重
    ├── Recommendation          偏好、风险、排序与解释
    ├── Trips & Alerts          收藏、行程、价格提醒
    └── AI Gateway              OpenRouter 结构化解析/文案
          │              │
          ▼              ▼
     PostgreSQL        Redis
     权威数据/任务      热缓存/限流/互斥锁
          ▲
          │
FlightOR Worker（与 API 共用代码和数据库）
    ├── OAG 主数据/时刻/连接同步
    ├── 拓扑边重建
    ├── 异步搜索与报价刷新
    └── 价格提醒与通知

外部供应商：OAG / SerpApi（后续可接 Duffel）/ OpenRouter / 微信 API
```

推荐技术栈：

- Node.js LTS + TypeScript；
- Fastify：HTTP API；
- Zod 或 TypeBox：请求、响应与环境变量校验；
- PostgreSQL：权威业务数据；
- Kysely + `pg`：类型安全 SQL、迁移和复杂查询；
- Redis：短期缓存、限流、幂等互斥，不保存不可丢失数据；
- OpenAPI：接口契约；
- Docker Compose：首期部署，API 和 Worker 使用同一镜像、不同启动命令。

选择模块化单体的原因：当前业务的主要复杂度是数据一致性、供应商配额和搜索规则，不是服务数量。API 与 Worker 分进程即可独立扩容，模块边界稳定后再按真实瓶颈拆分。

## 4. 领域模块和职责

| 模块 | 负责 | 不负责 |
|---|---|---|
| Auth | 微信 `code2Session`、用户、短期访问令牌、刷新会话 | 保存微信 AppSecret 到客户端 |
| Reference Data | 国家 → 城市 → 机场层级、航司、时区、搜索别名 | 航班价格 |
| Aviation Data | OAG 请求、分页、增量同步、数据版本、供应商原始 ID | 用户排序 |
| Topology | 直飞边、最多两次中转、无闭环、日期有效性、MCT | 实时报价真实性 |
| Search | 调用报价供应商、结果标准化、去重、过期时间 | 用模型补全不存在的航班 |
| Recommendation | 硬约束过滤、软偏好评分、推荐理由 | 改写原始价格和时刻 |
| AI Gateway | 自然语言转结构化条件、对结构化结果生成解释 | 作为事实来源 |
| Trips & Alerts | 收藏、行程、价格条件、通知记录 | 全量扫描所有全球航线 |
| Operations | 同步任务、配额、健康检查、审计、告警 | 面向普通用户开放管理能力 |

供应商必须通过统一接口接入，例如 `ScheduleProvider`、`FareProvider`、`LlmProvider`。领域层只消费标准化模型，不能直接依赖 OAG 或 SerpApi 的响应字段。

## 5. 核心数据模型

数据库内部高频表使用 `bigint generated always as identity` 主键；需要暴露给客户端、跨系统传递的搜索 ID 和行程 ID由应用生成 UUIDv7。时间点统一为 `timestamptz`，金额使用 `numeric(12,2)` 加三位货币代码，不能用浮点数。

### 5.1 国家、城市、机场

| 表 | 关键字段 | 说明 |
|---|---|---|
| `countries` | `code char(2) PK`, `name_zh`, `name_en`, `region`, `active` | ISO 国家代码是稳定自然键 |
| `cities` | `id`, `country_code FK`, `iata_code`, 中英文名、经纬度、时区 | 一个城市可对应多个机场 |
| `airports` | `id`, `iata_code unique`, `icao_code`, `city_id FK`, `country_code FK`, 名称、经纬度、时区、状态 | `country_code` 冗余保留，提升国家筛选性能，写入时校验与城市一致 |
| `airport_aliases` | `airport_id FK`, `locale`, `alias_normalized` | 支持中文、英文、城市名、IATA 检索 |
| `airlines` | `id`, IATA/ICAO、名称、联盟、状态 | 航司主数据 |

机场搜索使用 IATA 精确 B-tree 索引，以及 `pg_trgm` 的别名模糊索引。国家列表不依赖前端写死的热门清单；热门国家由配置表或搜索统计生成。

### 5.2 时刻和拓扑

| 表 | 关键字段 | 说明 |
|---|---|---|
| `schedule_services` | 航司、航班号、起降机场、有效期、运营星期掩码、本地起降时间、跨日偏移、数据版本 | OAG Schedules 的计划航班，不代表当天可售 |
| `route_edges` | 起点、终点、有效期、运营星期、班次数、数据版本、最后确认时间 | 从时刻表聚合出的有向边，供拓扑搜索使用 |
| `connection_options` | 航段引用、经停机场、连接分钟、MCT 状态、自行中转标记、有效期 | OAG Connections 提供的已验证连接候选 |
| `mct_rules` | 机场、国内/国际、航站楼/航司条件、最少分钟、有效期、来源 | 有数据时使用精细 MCT；无数据时走保守默认策略并明确标记 |
| `topology_versions` | 版本、覆盖范围、来源快照、激活状态、生成时间 | 搜索结果必须能说明使用了哪个拓扑版本 |

关键索引：

- `schedule_services(origin_airport_id, destination_airport_id, valid_from, valid_to)`；
- `route_edges(origin_airport_id, valid_from, valid_to, destination_airport_id)`；
- `connection_options(origin_airport_id, destination_airport_id, valid_from)`；
- `connection_options(hub_airport_id, valid_from)`；
- 每个外键列都建立索引。

首期不分区。只有搜索、报价或日志类时间序列表增长到约亿级，或维护窗口明显受影响时，再按月分区；不要为未来假设提前增加分区复杂度。

### 5.3 用户和偏好

| 表 | 关键字段 | 说明 |
|---|---|---|
| `users` | `id`, `wechat_openid unique`, 昵称、头像、状态、登录时间 | OpenID 只在服务端使用和访问控制 |
| `user_sessions` | 用户、令牌摘要、过期时间、撤销时间 | 不落明文 refresh token |
| `transit_country_preferences` | `user_id FK`, `country_code FK`, `preference` | `preference` 只有 `preferred` / `excluded`；没有记录即“不限” |
| `saved_trips` | 公共 UUID、用户、结构化行程、版本 | 收藏/行程回放 |
| `price_alerts` | 用户、OD、日期条件、目标价、货币、状态、下次检查时间 | Worker 定时执行 |

`transit_country_preferences(user_id, country_code)` 建唯一约束，使用原子 `INSERT ... ON CONFLICT DO UPDATE`。搜索请求允许携带一次性偏好覆盖，但不会静默改写用户长期偏好。

### 5.4 搜索和报价

| 表 | 关键字段 | 说明 |
|---|---|---|
| `flight_searches` | 公共 UUID、用户、标准化请求、请求哈希、状态、拓扑版本、过期时间 | 支持异步搜索和复现问题 |
| `flight_offers` | 搜索、供应商 Offer ID、总价、货币、总时长、中转类型、过期时间、风险级别 | 供应商报价快照 |
| `flight_segments` | Offer、顺序、航班号、起降机场、UTC 时间、航司、行李/保护信息 | 所有排序都基于结构化航段 |
| `recommendations` | 搜索、Offer、总分、分项得分、规则版本、解释 JSON | 排序可解释、可回放 |
| `provider_calls` | 供应商、动作、请求摘要、状态、耗时、配额成本、请求 ID | 不记录密钥和不必要的个人信息 |

原始供应商响应只做短期、加密或严格权限的故障审计留存，并设自动清理时间；业务查询使用标准化表，避免长期绑定供应商 JSON 格式。

### 5.5 同步任务

| 表 | 关键字段 | 说明 |
|---|---|---|
| `sync_runs` | 数据集、版本、状态、游标、成功/失败数量、起止时间、错误摘要 | 一次同步的审计记录 |
| `jobs` | 类型、payload、状态、`run_at`、重试次数、锁持有者和时间 | OAG 同步、拓扑重建、提醒检查等持久任务 |

Worker 使用 `FOR UPDATE SKIP LOCKED` 原子领取任务，多实例不会重复执行同一条任务。外部写入操作仍需业务幂等键，不能只依赖队列锁。

## 6. 航线可达性和中转规则

### 6.1 可达性不是布尔值

接口返回三态：

- `reachable`：所选日期和当前数据版本存在有效航班/连接证据；
- `unreachable`：在明确覆盖完整的时刻数据中确认不存在；
- `unknown`：数据缺失、订阅范围不完整、数据过期或供应商失败。

不能把 `unknown` 当成 `unreachable`。响应同时返回 `source`、`topologyVersion`、`freshness` 和覆盖范围。

### 6.2 路径生成

- 最多两次中转，即最多三段航班；
- 每条边必须在出发日期有效且当天运营；
- 维护 `visitedAirportIds`，禁止重复机场和闭环；
- 起点、终点不能作为中途经停点；
- 先从 `route_edges` 做深度不超过 3 的有界搜索，再用具体时刻、MCT 和报价校验；
- 优先使用 OAG Connections 已提供的连接，缺失的两次中转路径再由边组合生成；
- 结果设数量上限，先按地理绕行、班次密度和国家偏好做轻量预排序，避免报价 API 调用爆炸。

由于深度固定且很小，PostgreSQL 邻接边 + 应用内有界搜索足够。首期使用图数据库只会增加同步、一致性和运维成本。

### 6.3 硬约束和软约束

硬约束：

- 最多两次中转；
- 无重复机场、无闭环、航段首尾连续；
- 航段在目标日期存在；
- 衔接时间不低于适用的 OAG MCT 或后端保守安全下限；
- 用户明确 `excluded` 的中转国家；
- 用户选择仅直飞时不得产生中转方案。

软约束：

- 总价、总时长和绕行程度；
- 长中转时长；
- 用户 `preferred` 的中转国家；
- 自行中转、行李重挂、换机场、过夜和签证风险；
- 中转时段是否适合短暂停留游玩。

长中转不会被硬过滤。它会得到时长惩罚，同时标记为 `stopoverPlayable`；如果用户偏好对应国家或明确想中转游玩，惩罚可以降低。极短衔接始终属于安全约束，用户只能增加自己的舒适缓冲，不能把安全下限调低。

### 6.4 推荐评分

首期不让大模型直接打分。推荐层使用版本化、可回放的确定性分数：

```text
score = priceScore
      + durationScore
      + connectionReliabilityScore
      + preferredCountryBonus
      + stopoverPlayBonus
      - selfTransferRisk
      - airportChangePenalty
      - detourPenalty
```

先通过硬约束，再对每项归一化。响应必须带分项原因，例如“价格低 18%”“经偏好国家新加坡中转”“自行中转且需重挂行李”。模型只负责把这些结构化事实组织成自然语言。

## 7. OAG 和其他供应商的数据策略

### 7.1 OAG 使用方式

| 产品 | 后端用途 | 建议频率 |
|---|---|---|
| Master Data | 国家/城市/机场/时区/航司基线 | 首次全量，之后按合同能力日更或周更 |
| Schedules | 日期级直飞边和计划班次 | 按订阅范围增量同步；热点范围更频繁 |
| Flight Info Connections | 已验证连接和 MCT 依据 | 依产品更新周期同步或按热点请求缓存 |
| Flight Info | 临近出发的航班实例/状态校验 | 按需调用，不用于全球拓扑全量扫描 |

试用额度只用于验证字段和少量端到端 Case，不应设计成全球机场全量爬取。正式同步范围、分页方式、历史保存和再分发权必须以 OAG 商务合同为准。

### 7.2 同步流水线

1. Scheduler 写入同步任务；
2. Worker 按分页读取供应商数据，并记录游标和配额；
3. 数据先做 schema 校验和标准化；
4. 批量写入 staging 或指定的新数据版本；
5. 使用批量 INSERT/COPY 和原子 upsert，避免逐行网络往返；
6. 重建受影响的 `route_edges`；
7. 完整性检查通过后，事务性切换激活版本；
8. 失败时保留旧版本继续服务，不发布半成品拓扑。

同步必须可恢复：同一供应商主键 + 数据版本重复执行不会生成重复数据。删除采用“新版本激活后淘汰旧版本”，不能在新批次完成前清空生产数据。

### 7.3 报价和 AI

- SerpApi 当前作为报价搜索源，服务端按需调用并缓存；
- Duffel 作为后续可插拔的可售 Offer 源，不混用两者的字段语义；
- OpenRouter 只用于需求解析和解释，不参与可达性、MCT、价格、签证等事实判定；
- 所有供应商调用都有超时、配额预算、指数退避和熔断；只有幂等请求才自动重试；
- 供应商失败时可返回明确标记的旧缓存或部分结果，不能伪造实时数据。

## 8. 搜索请求流程

复杂的多机场、日期窗口搜索采用异步模型，避免小程序请求超时：

1. `POST /v1/flight-searches` 校验参数，生成标准化请求哈希；
2. 命中新鲜缓存则立即返回完成结果；
3. 未命中则创建 `searchId` 和任务，返回 `202 processing`；
4. Worker 从拓扑中选出有限候选；
5. 报价适配器并发查询，设置每供应商并发与配额上限；
6. 标准化、去重、硬约束校验、风险计算和软排序；
7. 写入报价和推荐结果；
8. 小程序轮询 `GET /v1/flight-searches/{searchId}`，获得 `processing / partial / completed / failed` 状态。

精确 OD + 精确日期的小搜索允许同步快速路径，但必须复用同一搜索服务和结果模型，不能维护两套规则。

## 9. API 草案

所有接口使用 `/v1` 前缀、JSON、OpenAPI 契约和统一错误格式。写接口支持 `Idempotency-Key`，所有响应返回 `requestId`。

### 9.1 用户和偏好

- `POST /v1/auth/wechat`：用一次性微信 code 换取 FlightOR 会话；
- `POST /v1/auth/refresh`：刷新会话；
- `GET /v1/users/me`：用户资料；
- `GET /v1/users/me/transit-country-preferences`；
- `PUT /v1/users/me/transit-country-preferences`：整体替换 preferred/excluded，后端校验互斥。

### 9.2 主数据和拓扑

- `GET /v1/countries?query=&popular=true`；
- `GET /v1/airports?query=&countryCode=&limit=`；
- `GET /v1/airports/{iata}`；
- `POST /v1/reachability/query`：返回三态可达性、路径、数据版本和新鲜度。

### 9.3 搜索和推荐

- `POST /v1/flight-searches`；
- `GET /v1/flight-searches/{searchId}`；
- `POST /v1/flight-searches/{searchId}/refresh`；
- `GET /v1/flights/{flightId}/status`；
- `POST /v1/route-plans`：多城自然语言或结构化路线规划；
- `POST /v1/route-plans/{planId}/confirm`：仅确认最终候选的实时价格。

### 9.4 行程和提醒

- `POST /v1/trips`、`GET /v1/trips`、`GET /v1/trips/{id}`；
- `POST /v1/price-alerts`、`PATCH /v1/price-alerts/{id}`、`DELETE /v1/price-alerts/{id}`。

### 9.5 运维

- `GET /health/live`：进程存活；
- `GET /health/ready`：数据库、迁移版本等就绪状态；
- `GET /metrics`：仅内网或鉴权访问；
- `/v1/admin/*`：同步、配额和数据版本管理，独立 RBAC。

## 10. 缓存、并发和配额

Redis 键必须带数据版本，避免拓扑更新后命中旧结论：

| 数据 | 建议 TTL | 备注 |
|---|---:|---|
| 国家/机场检索 | 24 小时 | 主数据版本改变即失效 |
| 可达性 | 6–24 小时 | `unknown` 只短暂缓存；负缓存必须注明覆盖范围 |
| 报价 | 5–15 分钟或供应商给出的过期时间 | 不得展示为长期有效价格 |
| 推荐结果 | 10–30 分钟 | 绑定报价和规则版本 |

同一请求哈希使用短期分布式锁合并并发请求，避免缓存击穿。每个供应商分别配置：每分钟调用数、每日预算、最大并发、超时和熔断状态。达到预算时返回可解释的降级状态，不继续盲目重试。

## 11. 安全设计

1. OAG、SerpApi、OpenRouter、微信 AppSecret 只在服务端 Secret Manager 或部署环境中出现；
2. 小程序包不注入任何第三方密钥，也不直连第三方供应商；
3. 用户此前粘贴到对话里的所有 key 应视为已暴露，接入前先在各平台撤销并重新生成；
4. 启动时校验必需环境变量，但错误日志只显示变量名，不显示值；
5. 日志自动脱敏 `Authorization`、subscription key、OpenID、手机号、证件和完整供应商响应；
6. 全站 HTTPS，小程序后台只配置自有备案 API 域名；
7. Access Token 短期有效，Refresh Token 轮换并仅保存摘要；
8. Zod/TypeBox 做白名单输入校验，数据库查询参数化；
9. 用户接口按用户和 IP 限流，管理接口 RBAC + 审计；
10. OpenRouter 请求只发送完成任务所需的最少信息，不传密钥、OpenID 或证件信息。

## 12. 可靠性和可观测性

- 日志字段：`requestId`、`userIdHash`、`searchId`、模块、供应商、耗时、缓存命中、配额消耗、错误码；
- 指标：API P50/P95/P99、搜索成功率、供应商成功率、缓存命中率、队列积压、同步新鲜度、数据库连接数；
- 链路追踪覆盖 API → Worker → 第三方供应商；
- 告警：连续供应商失败、同步超过新鲜度阈值、错误率/延迟升高、队列积压、配额即将耗尽；
- 错误响应区分 `INVALID_REQUEST`、`NO_ROUTE`、`DATA_UNKNOWN`、`PROVIDER_UNAVAILABLE`、`RATE_LIMITED`；
- PostgreSQL 使用连接池；规模增大后在数据库前加入 PgBouncer transaction pooling；
- 每日备份 + 时间点恢复能力，定期进行恢复演练；
- 数据库迁移先向后兼容，再部署代码，最后清理旧字段。

## 13. 部署拓扑

首期一套 Docker Compose 即可：

```text
reverse-proxy  80/443，对外唯一入口
api            2 个实例起步（无状态）
worker         1 个实例起步，可独立扩容
postgres       托管版优先；自建必须单独磁盘、备份和监控
redis          缓存/限流；不可作为唯一持久化来源
```

环境至少分为 `development`、`staging`、`production`，数据库和供应商凭据完全隔离。生产数据库优先选云厂商托管 PostgreSQL；“自己部署后端”不等于必须自己维护数据库内核。

CI/CD 基线：

1. lint、类型检查、单元测试和现有 111 项回归；
2. 数据库迁移校验；
3. 构建不可变镜像并做依赖/镜像扫描；
4. staging 冒烟测试；
5. 生产滚动部署；
6. 自动检查 `/health/ready`，失败回滚应用版本。

## 14. 推荐代码结构

```text
apps/
  api/                    # Fastify 启动、路由、鉴权
  worker/                 # Job worker 和 scheduler
packages/
  domain/                 # 航班、拓扑、推荐的纯领域模型
  db/                     # Kysely schema、迁移、repositories
  providers/
    oag/
    serpapi/
    duffel/
    openrouter/
    wechat/
  contracts/              # OpenAPI schema、共享 DTO、错误码
  observability/          # 日志、指标、trace
infra/
  docker/
  compose/
docs/
```

当前 `cloud/searchProxy/oag.js`、`connectivity.js` 和 `cloud/routePlanner` 中的纯逻辑可迁入 `packages/providers` 与 `packages/domain`；所有 `wx-server-sdk` 调用留在旧云函数适配层，迁移完成后删除。

## 15. 迁移计划

### Phase 0：安全和契约（立即）

- 撤销并重新生成已公开的全部第三方 key；
- 冻结一版 `/v1` OpenAPI 契约和统一错误模型；
- 给现有算法补“长中转保留、MCT 硬约束、偏好国家排序、未知可达性”的回归用例。

### Phase 1：后端骨架

- 建 `apps/api`、`apps/worker`、PostgreSQL、Redis、迁移和 Docker Compose；
- 完成健康检查、结构化日志、配置校验、request ID；
- 实现微信登录与会话；
- 前端 `BASE_URL` 改为构建环境配置，不再是硬编码常量。

### Phase 2：主数据和偏好

- 接 OAG Master Data，同步国家/城市/机场/航司；
- 完成机场/国家搜索 API；
- 把中转国家长期偏好从 MobX 本地状态同步到 PostgreSQL；
- UI 继续保留“热门国家 + 搜索全部国家”，数据改由 API 提供。

### Phase 3：拓扑

- 接 OAG Schedules / Connections 的分页同步；
- 建 `route_edges`、数据版本和三态可达性；
- 迁移最多两次中转、无闭环、MCT、长中转软排序规则；
- 保留本地 seed 拓扑只用于测试，不参与生产结论。

### Phase 4：搜索和推荐

- 把 SerpApi 直连迁到服务端 Provider；
- 实现异步搜索、报价标准化、缓存、配额和推荐分项；
- 把 OpenRouter 调用全部迁到 AI Gateway；
- 小程序移除编译期第三方 key 和生产 mock 分支。

### Phase 5：行程、提醒和切流

- 迁移收藏、行程、价格提醒和微信订阅消息；
- staging 用同一 Case 集回归，生产按比例切流；
- 短期保留云函数只作回退网关，稳定后删除云数据库和云函数依赖。

## 16. 首个生产版本验收标准

- 小程序产物中检索不到任何第三方 key；
- 国家、城市、机场层级来自后端，国家偏好可跨设备同步；
- 可达性返回三态、来源、版本和新鲜度，不用 mock 宣称全球可达；
- 每条候选最多两次中转且无闭环；
- 低于 MCT 的路线被拒绝，长中转路线保留并降低排序；
- OAG 同步失败时继续使用上一完整版本；
- 重复同步、重复搜索任务和重复写请求不会生成脏数据；
- 供应商超时、限流、额度耗尽都有明确降级和监控；
- PostgreSQL 可从备份恢复，迁移可回滚应用；
- API、Worker、数据同步和现有路线算法均有自动化回归。

## 17. 实现前仍需确认的外部条件

以下不是架构不确定，而是采购/运营输入：

1. OAG 正式订阅允许的地域、日期范围、速率、分页、缓存和再分发条款；
2. 报价只做跳转比价，还是未来需要可售、下单和售后；
3. 生产部署的云厂商、区域、备案域名和预计并发；
4. 微信订阅消息模板、隐私政策和数据保留期限；
5. 签证/入境规则准备采用哪个权威数据源。签证信息变化快，不能长期依赖前端静态文案或模型记忆。
