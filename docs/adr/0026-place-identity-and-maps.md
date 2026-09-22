# ADR 0026：发布后的地点身份与地图

2026-09-22，Accepted / 已实现，平台验证边界见[本轮记录](../design/budget-travel-agent/PLACES_MAP_2026-09-22.md)。基线 main@8fd6691。沿用 ADR 0025 的活动身份与内容版本，不改变 Planner、研究、航班或 Goal/Run，不接图片 Provider。

## 独立扩展

显式 POST `/v1/artifacts/:id/places` 接收 `{contentVersion}`（当前 guideContentHash）；GET 同路径只读取。owner、Trip context、已选航班 revision、攻略 hash、活动 ID 和取消在查询前/保存事务内/返回前检查。需要任一语言的 accepted 底稿；locale 不参与地点缓存键，不产生语言版本或 Trip 业务版本变更。跨语言刷新读同一地点实体。`/v1/map-config` 只公开瓦片模板、OSM 署名和解析是否配置，不含服务端密钥。

迁移 013 的 `guide_place_bindings` 按 user/artifact/content/activity 存独立 JSON，不修改受 hash 保护的攻略；`place_query_cache` 保存查询结果；`place_provider_calls` 记录预约、起止和结果状态。网络不在数据库事务内执行。

`enrichment={contentVersion,activities:{[activityId]:{place,coordinates?}},cities?,flightPaths?}`。place 是解析记录：`status=resolved|unresolved|ambiguous|unavailable|conflict`、reason、checkedAt、可选实体和候选摘要。只有 resolved 的实体可以产生标记；conflict 保留旧实体及新候选供修订，不显示成已确认。

实体含 `placeId=osm:{node|way|relation}:{id}`、name、aliases、city、countryCode、address、`kind=venue|park|district|street|city|airport`、`coordinates={latitude,longitude,system:WGS84}`、source（provider/url/attribution/retrievedAt）。`locationHint.id` 仍是城市线索，绝不当 POI ID。城市另用 `city:{originalCityId}` 解析、单独返回；机场连线只从已采用航班的实际机场代码查参考库。多个活动共享地点实体合法，activityId/顺序/日期不变。

## 保守解析与运行

只使用一个配置的 Nominatim 兼容服务；首版使用获授权的 OSM 公共服务。发送原始/已接纳名称、城市、国家；已有来源只在本地进行候选消歧，不发送用户原话、偏好、研究正文、凭证。检验国家、地区、名称和实体粒度；对返回地址的城市辖区及 metropolis 独立字段兼容。名称同名时可用已有精确官网/OSM 实体来源消歧，否则 ambiguous；不选第一条。主题美食、多地点组合保持 unresolved，不以车站/城市/机场代替。主场馆、街区与街道粒度明确。

一次动作最多12条线索、总截止25秒、单请求8秒、单实例串行；同 owner/攻略/hash 合并在途动作，同查询合并在途请求；数据库租约保证整个部署至少1100ms间隔且只有一个外部请求在途。达到动作上限记录 unavailable/action_limit，后续只能显式点击继续。公网服务还有自身限额/可用性限制，不能把此机制当作无限公共批量服务。

缓存 key 含服务 URL/解析版本、原始名称、城市、国家、city/activity 范围及排序去重的来源 URL；不含 locale 或活动序号。来源参与 key，避免不同消歧证据错误复用同名实体。resolved 缓存30天，技术失败5分钟，其他结果1天；当前内容已有非技术结果的绑定直接复用，不自动重评。技术失败仅显式操作在缓存到期后可查询。新内容需新绑定；同查询缓存过期后出现不同实体时记录 conflict，禁止悄悄替换。跨实例网络限流由数据库保证；并发请求/查询合并是进程内的，不宣称跨实例只调用一次。

## 地图与后续图片

H5 使用 Leaflet + HTTPS OSM 实际瓦片，保留署名/正常 Referer/缓存，8秒无成功瓦片后紧凑降级，不预下载。微信使用原生 Map，输入转 GCJ-02；只有 countryCode=CN 且在适用范围内才转换，JP/KR 等境外不偏移。服务端永远保留 WGS84，转换函数声明 inputSystem/displaySystem/converted，不重复转换。未开启实时定位。

微信 `components/place-map` 是最小原生视图桥接：Taro 传递 JSON 字符串，原生组件解析后直接绑定 markers/polyline/include-points，事件回传稳定编号。没有地点查询或第二套业务状态。8秒未收到 updated 或 error 时收起；原生 updated 不是瓦片加载成功证明，平台可能静默显示空白底图，因此另提供显式“底图未加载？收起地图”。本轮东京模拟器底图仍未通过，不能据 SDK 回调/标记成功宣称地图底图可用。H5 已独立验证真实 OSM 瓦片。

日地图保持原行程编号（缺点不重排），marker 打开对应 activityId 的详情，列表点击高亮标记，日期/语言切换更新标记。连线是访问顺序示意，不是导航、距离或耗时；机场连线单独标注航空示意。无数据/地图错误紧凑提示，文字不依赖地图成功。

图片任务复用 `activities[activityId].place.place.placeId` 和来源、粒度、别名、地区，不以翻译标题作 key。media 与地点平行；适配器保留相同 contentVersion 下已有 media，地点补全不改文本 hash、不触发终稿或图片调用。后续图片必须独立核查实体匹配与署名。

## 配置与回滚

`PLACES_NOMINATIM_URL`、`PLACES_USER_AGENT` 默认空，解析默认关闭；公共实例要求能识别应用的 UA，部署者应提供联系信息。`MAP_TILE_URL` 默认官方 OSM 模板，必须 HTTPS、含 z/x/y、无 URL 凭证。此版本署名固定 OSM，只能配置遵守 OSM 署名的兼容瓦片源，不是多供应商框架。微信底图按平台管理，无服务端 Key 打包到客户端；部署还需配置合法 request 域名。

先迁移再启用。关闭解析配置可停止新增外部调用，已有文本不受影响；回滚应用后保留扩展表及调用记录，不需要删除攻略或重生成终稿。迁移 down 会删除地点扩展/缓存/记录，必须先备份，不属于本次实际执行。测试只在隔离 schema 运行，未重启 Docker、未操作未备份 tmpfs 数据。
