# 地图收尾具体情况说明（2026-09-22）

基线 main@1e097c4。本次按用户要求保存阶段性修复并提交，**不是第三阶段全平台验收完成**。主 Planner、终稿、研究 Provider、航班和 Goal/Run 未在本提交中修改；无攻略重生成、无图片接入。其他任务的未提交改动保留，未纳入本提交。旧报告不改写。

## 当前结论

| 层次 | 已确认事实 | 尚不能声称 |
| --- | --- | --- |
| H5 | 当前构建真实 OSM 瓦片有 HTTP 200；东京地点、双入口、中英/日期切换、marker/列表联动及刷新通过 | 不代表微信或正式 API 全链路成功 |
| 微信正式页面 | 用户手动编译后，两入口标记数量、稳定编号、中英切换、详情/列表联动与恢复通过；查询累计16→16 | 截图中东京底图空白，不能以 updated/标记/视野 success 认证底图可见 |
| 原生对照 | 同 AppID/基础库，北京 PEK 机场、东京明治神宫，纯 map→桥接→标记→includePoints 八项已采集；两地视野返回 includeMapPoints:ok，errCode=null | SDK截图两地均有空白；不能因此断言腾讯不支持海外，也不能保证加 Key 解决 |
| 生产地点 Provider | 未注入代理的 NominatimProvider 默认 Node fetch 第16次实测8005ms后 TimeoutError，causeCode/errCode均null | 验收 harness 的代理成功不能证明生产出网可用 |

## “刚刚成功，后来又空白”的具体情况

现场曾在微信窗口看到北京机场道路/建筑底图；用户也报告看到地图加载成功。后续自动截图中的北京/东京却为空白，这两类证据都保留，不能把成功观察抹掉。当前没有获得原生底图网络响应或明确鉴权错误码；尚不能区分异步加载时间、窗口/模拟器状态、SDK截图捕获差异或底图网络问题，**根因未定位**。SDK裸图在进入页面约6秒后截图；正式页面截图等待不同，更不能当作稳定性对照。

用户20:23提供的截图是独立 native-map-probe 诊断项目，非正式行程页面。tokyo / undefined / venue 来自普通编译未传 stage 时标签使用 q.stage：实际默认 bare（纯 map），地点及坐标并未 undefined。本次修正生成脚本的默认标签与页面标题字段；此标签修正未重新运行模拟器，旧截图保留。[用户截图](map-followup-evidence/user-native-probe.png)。

此前还出现过旧页面/组件：运行 app build-info 已更新，但诊断方法缺失、地点 GET 未出现；仅凭入口指纹不足以证明所有组件已重编译。用户再次手动编译后正式脚本成功，独立原生项目也能正常采集。独立项目首次启动失败及 SDK 元信息失败不是地图 Provider 错误，不作为底图结论。

最后一次 Computer Use 被用户 Esc 停止，之后未继续界面操控；在途正式 SDK 验收最终完成，报告明确记录恢复原 guest/storage/语言/页面并撤销请求 mock。无真机验证。

## 环境与版本（严格区分）

- 初始磁盘包是8fd6691+dirty，后来构建并从H5/微信运行时读到1e097c47712e1f224c297d199737b57bca3c05a2+dirty。
- 两端当时源指纹34756fb7ba9a04e3d2c8e867a208394f5e8347aba27d2cb911bb09d9f0cea7c4；微信builtAt=2026-09-22T11:57:23.529Z，H5=11:57:39.302Z；API配置均为http://127.0.0.1:3000。
- 实际微信AppID=wxdf9ff3c30a1d9549，SDKVersion=3.17.0，platform=devtools，version=8.0.5；窗口显示工具Stable 2.02.2608060。独立原生项目使用相同AppID和基础库，继承指纹仅表示父构建来源，不冒充正式Taro页面。
- 正式API3000未运行，因此没有取得正式后端运行SHA。backend包版本0.1.0、当前源码tsc构建通过，不等同于正式服务上线。
- 3013是places-live-server：合成行程/终稿运输，真实认证地点路由、PostgreSQL与保存坐标；本轮启动未传execute，外部POI调用被禁止。H5请求被运输到3013；微信以fixture transport提供认证GET所得缓存，均非正式3000 API验收。
- Docker开启后无运行容器；核实flightor-postgres-1使用持久named volume且无tmpfs后，仅启动原停止容器读取原缓存，没有重建/清空/重启承载tmpfs的容器。

## 本次代码合同

1. loadProductionTrip先返回接纳文字；loadProductionPlaces独立GET，写回检查owner/session、locale、请求代次、artifactId和contentVersion。地图失败不替换文字；页面挂载/刷新不自动POST解析。显式地点动作仍有独立结果等待。
2. 原生includePoints单次回调截止3秒，同一bounds最多两次；失败维持有效中心/scale13，只有实际success设置成功签名。已失败请求的迟到success、新范围旧回调及卸载回调不接管状态。
3. updated只记组件更新，basemap仍unknown；8秒无updated只记录unknown，不再据此隐藏可能已显示的底图。组件错误紧凑降级，用户收起只是收起，不当修复通过。
4. 地点GET/POST、map-config、H5 tileload/tileerror、原生created/auth/ability/error/updated/marker、includePoints分别诊断。客户端环最多150条，原生最多50条，detail有界脱敏；缺失errMsg/errCode明确null。H5图片error事件本身通常不给HTTP状态，网络状态独立见H5报告，不伪造错误码。
5. 地点技术失败在原有JSON保存白名单name/errMsg/errCode/causeCode，无新表。前端全局__FLIGHTOR_BUILD__提供非敏感版本核对；__FLIGHTOR_MAP_DIAGNOSTICS__仅内存观测。

## 实际验证及边界

- 提交前地图原生回归与视野失败回归通过：保留中心、有界重试、迟到结果忽略、脱敏、updated不认证底图；生产展示36项通过；前端tsc通过。
- 后端地点/诊断定向13项通过，后端tsc此前通过；本轮没有重跑全量G1或以旧PostgreSQL测试数替代新验证。
- [H5报告](map-followup-evidence/h5-report.json)：两个入口zh/en、两日期、详情/列表/marker及刷新通过，POST=0，调用计数16→16。[东京底图](map-followup-evidence/h5-tokyo.png)、[地点GET未完成时文字](map-followup-evidence/h5-text-first.png)。
- [H5故障注入](map-followup-evidence/h5-faults.json)：地点503、map-config503、瓦片网络失败均保留accepted文字，各一次地点GET、零POST；[瓦片失败降级](map-followup-evidence/h5-tiles-failed.png)。这些是刻意注入故障，不冒充真实Provider故障。
- [微信正式组件报告](map-followup-evidence/weapp-production.json)：自备入口每天0/1个标记，已选航班入口1/2个标记；0表示未解析活动，没有城市中心补位。[正式东京截图](map-followup-evidence/weapp-tokyo.png)。
- [原生逐层报告](map-followup-evidence/native-probe.json)：8例、未报告原生error/auth failure；没有回调不等于鉴权或底图通过。[北京fit](map-followup-evidence/native-beijing-fit.png)、[东京fit](map-followup-evidence/native-tokyo-fit.png)。
- **最后两项前端收尾（无updated不自动隐藏、初始文字迟到代次保护）以及诊断标签修正晚于上述构建**，已离线检查，但未重新构建/平台复验。本次提交不以旧平台证据追认这些最新行的实际显示效果。

## 费用与出网

原账本backend/.demo/places-map-20260922/ledger.json保留，本轮新增仅1次免费POI诊断，累计16/24；模型/研究/图片调用0，新增已知费用0。[生产默认fetch记录](map-followup-evidence/production-egress.json)。未关TLS校验、未改全局代理。原死进程29932的lock核对不存在后才删除，仅删除lock，不重置账本。当前验收服务仍持有自己的锁，不能并行启动另一个真实探测。

## 复现与下一步

- node scripts/build-map-h5.cjs：正式H5附构建元数据；node scripts/qa-places-h5.cjs --followup：只读缓存运输、真实瓦片和文字先行；node scripts/qa-map-failures-h5.cjs：三层故障注入。
- node scripts/qa-places-weapp.cjs --followup：现有9432、正式页面、缓存fixture运输；测试后恢复mock和身份。不要与真实用户请求并发。
- node scripts/prepare-native-map-probe.cjs --isolated：从3013保存坐标创建忽略目录诊断项目，另将诊断页加入忽略dist；不改src/app.config，普通正式重构建会移除该生成页。node scripts/qa-native-map-probe.cjs --isolated使用9433；仅诊断，非正式界面。
- backend/scripts/probe-place-egress.mjs无参数不会联网；--execute需要既有明确授权和原账本独占锁，最多发一个生产默认fetch请求。本轮不要继续重试耗用额度来解释底图。
- 下一步先重构建本提交，固定同一个微信窗口/东京地点/缩放，记录加载后与延时后的实际画面、原生网络/控制台；保留窗口目视与SDK截图对照。真机可用时做同条件对照。在证据不足前不换模板/Provider、不承诺加Key可解。若原生最终确认不可用，最小候选是保持微信紧凑地点列表、复用现有H5真实地图；是否采用需后续决定。
