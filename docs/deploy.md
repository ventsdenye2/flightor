# FlightOR 部署与运行边界

更新：2026-09-20，依据当前 compose、backend README 和构建配置整理。本轮未执行部署。原先云函数优先、前端注入 Provider key 和失败回退假数据的指南已废弃，原稿仅留 [历史记录](archive/legacy/deploy.md)。

## 当前拓扑

小程序/H5 → 自建 Fastify API → PostgreSQL、Redis、航空/票价/研究 Provider；Worker 执行持久 jobs。对话 turn 的进程内状态不支持可靠跨实例恢复，不能据此宣布可直接多实例生产部署。

运行命令与完整环境变量以 [backend README](../backend/README.md)、[env 示例](../backend/.env.example)、[compose](../compose.yaml) 为准。现有环境文件不要覆盖，密钥只进服务端环境或 Secret 管理，不能注入小程序。

## 本地

2026-09-21 G1 环境补验：当前专用验收库 `127.0.0.1:63432/flightor_g1_publication_acceptance_20260921` 可用，定向 4 项通过；Docker 管理接口仍超时，不要用下面的 Compose 命令重建或停止仍承载原 tmpfs 实验库的容器。微信 SDK 自动化 9432 已能操作本项目；用户已开启 32348 服务端口，官方 CLI 端口发现仍异常。固定结果 UI 测试使用合成登录和请求拦截，不依赖生产 API，不能声称后端服务/真实微信认证已调通。具体复现及边界见 [平台环境报告](design/budget-travel-agent/G1_PUBLICATION_H5_2026-09-21.md)。

在根目录：
```powershell
docker compose up -d --build
```

compose 使用开发配置，暴露的数据库/Redis 端口和示例凭据不能原样作为互联网部署设置。

宿主开发分别执行：
```powershell
docker compose up -d postgres redis
npm --prefix backend install
npm --prefix backend run migrate
npm --prefix backend run dev
```

另开终端运行 `npm --prefix backend run dev:worker`。API 默认 3000，但以实际环境为准。GET `/health/live`、`/health/ready`、`/health/providers` 分别为进程、依赖、配置检查；都不能证明付费模型或票价 Provider 实际可用。

## 小程序与发布检查

- `FLIGHTOR_API_BASE_URL` 指向对应后端；Mock 只在显式演示模式启用，失败不自动改成假报价。
- 构建入口 `npm run build:weapp`；本地专用入口 `build:weapp:local` 不作为生产登录配置。真实微信 auth 与本地测试 auth 分开，生产禁止 local_test。
- 手机访问的地址不能是电脑的 127.0.0.1；生产网络/域名/HTTPS 配置须在目标环境按微信平台要求实测。
- 发布前验证认证、owner 隔离、数据库迁移/备份恢复、Worker 心跳、真实 Provider、取消与过期结果、目标设备地图/键盘/安全区。此处是项目验收项，不表示已经通过。
- 本轮不更新或推导外部平台规则；正式发布时重新核对官方要求。
- 不再上传云函数作为核心路径，不把 `cloud/` 遗留工具测试当作自建后端运行证明。

当前证据：[航班优先验收](FLIGHT_FIRST_ACCEPTANCE.md)。每次配置、命令或部署能力变更同批更新本页及相关 docs。

## Planner B2 兼容开关（2026-09-20）

新增 `PLANNER_LEAN_GOALS_ENABLED`，只接受 `true` / `false`，默认 `false`；示例配置同样关闭。`true` 让业务工具携带 intent/goalRef 并由服务端原子接受 Goal/Run、自动完成校验；同时隐藏 Planner 的 declare/resume/finish 工具。不会改变运行模型、Provider、研究预算或数据库 schema，已有 `.env` 未修改。

在两轮执行之间修改后端配置并重启 API 生效；回退为 `false` 恢复旧工具与提示协议。不要把进程重启宣称为持久 turn 恢复；正在运行的临时 turn 仍受既有进程生命周期限制。

G1 在 2026-09-20 使用独立临时 PostgreSQL 16 实例运行 Goal 集成套件，11 项通过，包含 B2 原子接受、并发重试和回滚；当前证据见 [progress](design/budget-travel-agent/progress.md)。该测试连接只通过子进程的 `TEST_DATABASE_URL` 提供，未覆盖已有环境文件或业务数据库。B2 仍默认关闭，数据库通过不等于真实 Planner/Provider 链路已验收。新上下文元数据记录 `goal_protocol: lean|legacy`，不记录敏感配置。

### 隔离 PostgreSQL 集成验证

`npm --prefix backend run test:db` 与默认离线测试分开；未显式设置 `TEST_DATABASE_URL` 会在加载配置时失败，不能报告 skip 为成功。套件会创建/删除自己的随机 schema，并执行扩展及迁移，连接必须指向专用测试实例。

本批使用本地 `postgres:16-alpine` 镜像、随机 loopback 端口、独立测试账号及 tmpfs 数据目录；容器带 `--rm`，验证后停止删除。没有启动 Compose 迁移任务，也没有对既有业务容器写入测试数据。新数据库不代表生产迁移已完成。两条攻略的确定性模型/证据 fixture 回归与后续真实 Provider 验收分别记载。
# 2026-09-22 终稿运行补充

终稿不增加模型/Provider环境变量：默认使用主Planner实际client、model和reasoning。专用编辑参数为90秒共同上限（服从整轮剩余时间）、8000输出token、180000输入字符、最多2次调用；上下文不足返回明确缺口。API默认开启新Planner攻略草稿/终稿边界，无数据库迁移。回退应保留草稿隐藏，不能删除标记后公开原始自由文本。当前同进程请求合并；多API实例尚无分布式调用租约。

真实终稿烟测：先backend build；在backend目录设置本轮授权`FINALIZATION_AUTHORIZED_USD=2`后执行`node --env-file=.env scripts/verify-guide-finalization.mjs --execute`。默认不传`--execute`只读配置；固定账本自动续用、最多12次、零搜索，不能新建目录重置额度。详见[运行合同](adr/0025-bounded-guide-finalization.md)和[实测报告](design/budget-travel-agent/FINALIZATION_2026-09-22.md)。本批未重启/部署现有API，也未重启Docker或微信SDK。


## 2026-09-22 地点扩展部署

先应用迁移013（独立地点绑定、查询缓存、调用租约/记录），再设置 `PLACES_NOMINATIM_URL` 和可识别应用且含联系信息的 `PLACES_USER_AGENT`；两项默认空，关闭新增解析。`MAP_TILE_URL` 默认 `https://tile.openstreetmap.org/{z}/{x}/{y}.png`，HTTPS、无URL凭证，保留 OSM 署名。公共实例无Key/无SLA，只用于符合官方政策的低量显式请求；不能周期预热或自动批量补全。生产 fetch 的代理配置由部署环境处理，本轮真实测试的现有代理只在隔离 harness 中使用。

H5 使用真实OSM瓦片；微信原生Map不打包服务端Key、不申请实时定位。微信仍需按实际部署配置合法API域名；本次东京模拟器底图未通过，发布前需在目标环境确认该服务覆盖及网络，不能把原生updated事件当瓦片成功。回滚应用/关闭解析保留记录和攻略文字，migration down 有破坏性，应先备份，本轮未运行生产down。详细 [配置和验证](design/budget-travel-agent/PLACES_MAP_2026-09-22.md)。
# 地点请求代理增量（2026-09-22）

可选 `PLACES_PROXY_URL=http://127.0.0.1:7890`（示例，部署需填写实际可达代理）只改变 Nominatim 地点请求，不改变模型/研究请求。代理模式要求 Node22.21+或24.5+；保持TLS校验，不依赖全局 `NODE_USE_ENV_PROXY`，不把服务端代理URL发到前端。留空回滚到原fetch。容器内127.0.0.1指容器自身，不能照抄桌面地址。当前机器一次 `node --use-env-proxy` 子进程探测成功不代表所有部署网络已配置；正式API和窗口证据见[本轮收尾](design/budget-travel-agent/MAP_CLOSEOUT_2026-09-22.md)。
# 第四阶段媒体配置（2026-09-22）

先执行已有013及新014迁移，新增媒体绑定/缓存表；本轮仅隔离schema已迁移，正式库未执行。`MEDIA_USER_AGENT`为空时禁补全、GET仍读既存媒体；启用时设置可识别应用/联系信息。无需图片Key、无需对象存储。`MEDIA_PROXY_URL`仅供媒体HTTPS Agent，Node22.21+/24.5+，不改全局或Planner出口。API允许调用Wikimedia固定域名，客户端直读真实返回的thumb.wikimedia.org/upload.wikimedia.org HTTPS照片。许可、尺寸、缓存TTL和回滚见[ADR0027](adr/0027-place-media.md)。

生产后端须配置微信request HTTPS域名，照片源须在目标网络可达并满足平台证书要求；若改为downloadFile需另配下载域名。既有开发urlCheck=false未修改，不能据开发模拟器推断生产通过。微信照片页面、真机和正式public库当前未验收；地图暂停排查、仍未解决。详见[验证与费用](design/budget-travel-agent/PLACE_MEDIA_2026-09-22.md)。
# DSH 实验引擎（2026-09-24，未部署）

默认 `FLIGHTOR_AGENT_ENGINE=legacy`。设 `dsh` 后启动时选用独立 DSH worker；配置失败直接报错，不回落旧 Planner。先在 `backend/dsh-runtime` 执行 `npm ci --ignore-scripts`，Node 固定验证版 22.21.0；根前端无需变更。

`DSH_MODEL_PROVIDER=openrouter|deepseek`，主模型由 `DSH_MODEL` 指定；OpenRouter 默认沿用 `PLANNER_MODEL`，官方默认 deepseek-v4-flash。对应凭证分别 `OPENROUTER_API_KEY` / `DEEPSEEK_API_KEY`。官方主模型不要求 OpenRouter Key。显式本地化仍通过同一路由的有界编辑客户端，读取与轮询不启动 Agent。

`DSH_SEARCH_PROVIDER=serpapi-raw|deepseek-official` 明确区分原始 SerpApi 和官方 Messages 搜索；后者必须单独设置 `DEEPSEEK_SEARCH_API_KEY`、`DEEPSEEK_SEARCH_BASE_URL`、`DEEPSEEK_SEARCH_MODEL`，不能把 OpenRouter Key 发给官方。官方搜索 base URL 默认 `https://api.deepseek.com/anthropic/v1`，模型默认 `deepseek-v4-flash`；官方适配器调用对应 Messages 路径。主模型的官方兼容 API base URL 默认 `https://api.deepseek.com/v1`。未配置搜索 provider 时不公开联网工具；凭证、路由或预算缺失时直接失败，不静默替换。

DSH 还要求正数 `DSH_AUTHORIZED_USD` 与 `DSH_AUTHORIZED_MODEL_CALLS`，以及 `DSH_BUDGET_PATH` 指向的本批持久账本；搜索次数由 `DSH_AUTHORIZED_SEARCH_CALLS` 限定。模型/搜索请求先进行预算 admission，再发出请求并记录有限回执。达到金额或次数上限后停止；不能换账本路径清零历史。

`DSH_DATA_DIRECTORY` 默认 `.dsh-data`，必须是私有持久磁盘并与业务数据库一起备份；单主机单 API 实例独占目录，最大活跃数默认4、空闲回收默认120秒（DSH_MAX_ACTIVE/DSH_IDLE_MS），不是性能保证。回滚将引擎设回 legacy 后重启，保留新会话数据，不删旧 Runtime。

本轮可填写的本地忽略配置为 `backend/.env.dsh.local`，只用于本地验证进程显式加载，不会自动更改已有服务；真实测试需新授权预算，不沿用历史额度。阶段证据见 [DSH记录](design/budget-travel-agent/DSH_IMPLEMENTATION_REPORT_2026-09-24.md)。
