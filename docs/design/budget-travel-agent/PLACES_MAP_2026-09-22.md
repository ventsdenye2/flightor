# 地点身份与地图

基线 main@8fd6691。后端真实地点链路与 H5 已验证；微信原生标记及联动单独验证，东京底图仍未通过，不宣称第三阶段全平台完成。先将第二项 UI fixture 改为按 activityId 对应：自备机票使用原本同身份的终稿，已选航班采用明确标注的合成中英样本，保持原活动身份、顺序和时段。没有改历史报告/截图，没有付费重写攻略。

提交边界：用户要求先提交当前实现。最后新增的原生 MapContext 视野适配及“底图未加载？收起地图”已通过离线测试和构建，但尚未完成新编译产物的模拟器验收；所附微信截图对应此前已通过的标记/联动版本，不作为这两项新增行为的视觉证据。后续继续这两项定向验收及东京底图诊断，不重开 Planner、图片或全量 G1。

选型核对：现有数据库 resolver 只提供 city/airport；原东京 fixture 的 city 坐标为成田机场附近，不作为城市中心或景点。复用原生微信地图；H5 采用实际 OSM 瓦片。地点解析选择一个 Nominatim 兼容接口，用户已知情同意公共服务政策，并授权本轮最多24次免费真实查询。政策要求全应用最多1请求/秒、缓存、应用标识、署名、无周期批量/自动补全。默认关闭外部解析，部署者配置服务URL与联系信息并承担政策责任。

官方依据：[使用政策](https://operations.osmfoundation.org/policies/nominatim/)、[Search API](https://nominatim.org/release-docs/latest/api/Search/)、[瓦片政策](https://operations.osmfoundation.org/policies/tiles/)。公共服务无Key、无SLA；仅适合本轮小规模明确操作，不是无界公共地理编码网关。

当前实现：独立 GET/POST `/v1/artifacts/:id/places`、013 迁移保存查询缓存与 owner/artifact/hash/activity 绑定。POST 显式操作，25秒总截止、每次最多12条线索，超额记录 action_limit；GET、刷新、语言切换不发外部查询。单查询8秒，跨进程数据库租约与1100ms间隔限流；已有 resolved 不重查，技术失败缓存5分钟。名称、国家、地区、实体类型均需匹配，多候选仅在已有精确官网/OSM实体来源能够消歧时接纳。缓存身份变化记录 conflict，禁止静默换地点。主题美食/多地点组合保持未解析。地图失败不阻塞终稿文字，不改 Planner/研究/航班/Goal，不接图片 Provider。

## 字段与运行边界

完整合同见 [ADR 0026](../../adr/0026-place-identity-and-maps.md)。迁移 013 的独立表不写攻略正文；适配只接受当前 hash、accepted 终稿与稳定 activityId 对应的 resolved 实体。地点名称不是主键，语言切换不解析、不改 Trip/航班版本。

| 服务字段 | 正式 UI / 下一阶段用途 |
| --- | --- |
| enrichment.contentVersion | 必须等于 guideContentHash，否则整份扩展不采用 |
| activities[activityId].place.status / reason | resolved 标记；其余为明确未解析/冲突/不可用状态 |
| activities[activityId].place.place.placeId | 稳定 OSM 实体标识，下一阶段图片匹配入口 |
| place.name / aliases / city / countryCode / kind | 原名、消歧和粒度；标记展示使用当前语言接纳名称 |
| place.coordinates / source | WGS84 原始坐标及 OSM 来源/署名；绝不从翻译名称构造身份 |
| cities / flightPaths | 独立城市标记及已采用航班的可信机场，非活动坐标补位 |
| activities[activityId].media | 与 place 平行，同 hash 读取合并保留；本轮不生产图片 |

H5 显示 WGS84；微信只对 CN 且位于转换范围的 WGS84 转 GCJ-02，境外不偏移。转换结果标明输入/显示坐标系，不重复转换。航空及活动连线只是示意，不返回地面距离/时间，不申请实时定位。

## 验证和费用

- 后端定向 Vitest：3 文件、30 项通过，含同名/来源消歧、地区/粒度拒绝、重复地点、并发、取消、版本变化、技术失败缓存和发布保护。
- 生产适配器：35 项通过；地点坐标、原生视图桥接、fixture 身份/时段测试通过。前后端类型检查与构建通过；构建保留既有 bundle 体积/CSS 顺序警告。
- 独立 PostgreSQL 测试通过：真实认证、严格 POST、GET 零查询、并发合并、持久恢复、owner、取消、身份冲突、正文不变、Trip/航班版本保护。测试 schema 用后清理，保留 `places_map_20260922` 验收 schema；没有重启 Docker 或清理 tmpfs。
- 真实 Nominatim 累计 **15/24**，免费：前5次直连超时，后10次返回200。复用本机已有代理仅在验收 harness 生效；生产 fetch 不自动继承该 harness 代理。未调用模型、研究或图片服务。
- 原账本 `backend/.demo/places-map-20260922/ledger.json` 与 response 文件保留。最初失败记录未删除；离线 reparse 仅修正独立调试样本，最终验收使用新的 `20260922-*` 攻略副本，由 H5 明确点击触发真实查询11–15，不拿离线修正冒充真实链路。
- 两入口旅程、登录、终稿文本均为明确 synthetic fixture。H5 的地点 API/数据库/Nominatim/OSM 瓦片是真实服务；微信使用刚从真实认证 API 读取的持久 POI 做 fixture transport，不冒充微信真实 HTTP 或真机验收。

| 地点 | 真实实体 | 粒度 |
| --- | --- | --- |
| 明治神宫 | osm:way:469908925 | venue |
| 藏前 | osm:relation:18158230 | district |
| 上野文化区 | osm:relation:18158889 | district |
| 竹下通 | osm:way:26604007 | street |
| Tokyo | osm:relation:1543125 | city（独立查询） |

主题美食、浅草寺与仲见世组合未强行绑定唯一地点。机场从现有 airports 参考库读取，仅用于采用航班的航空示意。没有地点被补到成田机场或 0,0。

## 平台证据与限制

H5 正式组件验证两个入口、zh/en、双日期、标记打开详情/列表高亮、390px 窄屏换行及刷新恢复，OSM 瓦片返回200。每日标记数量分别为自备机票 `[0,1]`、已选航班 `[1,2]`；保留原活动编号。最终重复显式操作、语言切换和刷新，账本均保持15。交付截图是最新缓存复验，`before-explicit-resolution` 表示本次点击前，已有上次解析缓存，不冒充首次冷启动截图。首次显式查询10→12→15以保留账本为据；不改第二阶段历史报告。

微信开发者工具原生地图数组经过 Taro 模板时未正确绘制；增加最小 native bridge 后截图确认标记出现。SDK 原生事件/列表操作与底图绘制分别评估，不能以 page.data 有字段、手工注入坐标或事件回调代替视觉验收。东京原生底图仍为带腾讯署名的空白背景；不是可用底图，没有用 fixture 图补位。错误/未就绪超时自动降级，静默空白可通过“底图未加载？收起地图”变为紧凑日程提示；原生 updated 不能用于认证瓦片成功。这是本轮剩余的平台验证缺口，未验证微信真机，也未改变地图供应商/申请新 Key。

验收脚本曾出现过期测试 token 401；现在强制断言认证 GET 200、内容版本存在和预期标记数量，禁止把全未解析当通过。SDK 地图属性序列化与重编译延迟的失败样本保留在 output。测试结束撤销 mock、退出合成身份并恢复原 guest 存储/语言，不改真实登录资料。

可提交证据：[文字断言/HTTP瓦片/脱敏调用清单](places-map-evidence/verification.json)、[H5 缓存动作前](places-map-evidence/h5-before-cached-action.png)、[自备机票中文概览](places-map-evidence/h5-self-zh-overview.png)、[采用航班概览](places-map-evidence/h5-flight-zh-overview.png)、[英文每日地图](places-map-evidence/h5-flight-en-day2.png)、[英文景点详情](places-map-evidence/h5-flight-en-detail.png)、[微信中文原生标记](places-map-evidence/weapp-self-zh-day2.png)、[微信英文标记及空白底图](places-map-evidence/weapp-flight-en-day2.png)、[微信英文详情](places-map-evidence/weapp-flight-en-detail.png)。这些证据不包含 transport token 或原 guest 存储备份。

## 重现与配置

生产启用 `PLACES_NOMINATIM_URL=https://nominatim.openstreetmap.org/` 与包含可联系信息的 `PLACES_USER_AGENT`；默认空值关闭。`MAP_TILE_URL` 默认 OSM HTTPS 模板；无前端 secret。公共服务仅适合有界低量、用户明确触发，遵守官方政策；不得自动批量预热。关闭解析不影响已接纳文字或已持久地点。

离线入口：`node scripts/test-publication-ui-fixture.cjs`、`node scripts/test-place-coordinates.cjs`、`node scripts/test-place-maps.cjs`、`node scripts/test-production-presentation.cjs`、backend Vitest `src/places/places.test.ts`。

数据库：先构建 backend，再在仓库根运行 `node --env-file=backend/.env backend/scripts/test-places-postgres.mjs`。真实验证服务 `node --env-file=backend/.env backend/scripts/places-live-server.mjs --execute --acceptance` 使用原锁/账本，最多24次；不带 execute 拒绝网络。`--refresh-token` 只更新隔离身份的验收 transport 文件，不查询 POI。H5/微信脚本分别为 `scripts/qa-places-h5.cjs`、`scripts/qa-places-weapp.cjs`；微信复用现有 automator SDK 和已打开端口。真实再查询仍受本批累计授权约束，不以重启服务重置次数。
