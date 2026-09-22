# 地图限定收尾：固定版本、网络出口与实际画面

基线 main@52cb1c315edae5a69e679d9ee36d55bc2cf92991；2026-09-22 实测。代码在 codex/map-closeout 隔离工作树修改，保留主工作区未提交改动。未修改 Planner、终稿、研究、航班或 Goal，未重新生成攻略、未查询图片、未重启 Docker/数据库。

## 五项结论

| 项目 | 本轮结果 |
| --- | --- |
| 最新源码实际运行 | 前端重新构建干净52cb1c3，实际入口与原生桥接核实；后端运行本分支编译产物。正式route产物哈希已记录，但本次固定观察宿主是诊断页，不能冒充完整正式页面验收。 |
| 正式地点读取/解析 | 正式3000真实认证及旧攻略读取200，places GET为409 PLACE_BASE_UNAVAILABLE。生产NominatimProvider的请求级代理探测成功，不能把探测称为正式API解析/持久化成功。 |
| 微信窗口底图 | 同一东京点、缩放13，5/15/30秒均只有标记与腾讯署名、无道路/地物底图，未通过。 |
| SDK截图捕获 | 与OS窗口所见一致：都为空底图且有标记。此次不能归因为单纯SDK漏拍；此前曾成功的用户观察不被本次结果推翻。 |
| 文字不阻塞 | 保留渐进加载实现；本轮36项生产展示回归通过，包括地点慢请求不阻塞已接纳文字、过期hash不可覆盖。正式旧攻略没有接纳底稿，本轮不能提供正式API已接纳文字成功的端到端证据。 |

## 固定运行版本和观察方法

Node22.21.0；微信开发者工具Stable2.02.2608060，AppID wxdf9ff3c30a1d9549，实际基础库3.17.0。构建时间2026-09-22T13:00:22.260Z，dirty=false，sourceFingerprint=8549c18b6d1bafc3d5d536df05cace63adc3df5a87ac8b4201067d6d50dbd4d7，API地址3000。

重新构建后复制完整产物到忽略的诊断项目，增加一个宿主页，原生桥接JS/WXML与正式route文件不变。[manifest](map-closeout-evidence/manifest.json)保存各文件SHA256；[runtime](map-closeout-evidence/runtime.json)来自实际运行环境；[原生观察](map-closeout-evidence/fixed-observation.json)保存运行中fitBounds和mapReady方法，确认2次上限、3秒截止、失败回退与updated仅观察语义，非仅看入口指纹。

只使用已保存明治神宫osm:way:469908925，35.6748417/139.6996266；境外WGS84不偏移，scale13，一个marker，无includePoints（保持固定视野）。开始前reLaunch一次，随后30秒不导航、不编译、不缩放，同一前台窗口。OS/SDK/事件并发采集，实际完成偏移如下：

| 目标秒 | OS秒 | SDK秒 | 画面 |
| --- | --- | --- | --- |
| 5 | 5.218 | 5.886 | 标记可见、底图空白 |
| 15 | 15.228 | 15.868 | 同上 |
| 30 | 30.305 | 30.844 | 同上 |

[OS5秒](map-closeout-evidence/tokyo-os-5.jpg)、[SDK5秒](map-closeout-evidence/tokyo-sdk-5.png)、[OS15秒](map-closeout-evidence/tokyo-os-15.jpg)、[SDK15秒](map-closeout-evidence/tokyo-sdk-15.png)、[OS30秒](map-closeout-evidence/tokyo-os-30.jpg)、[SDK30秒](map-closeout-evidence/tokyo-sdk-30.png)。OS成对捕获时可见SDK截图带来的模拟器浮层，主窗口背景同样为空；SDK结束后的[窗口记录](map-closeout-evidence/network-panel.jpg)无浮层仍为空。

事件只有created与updated，errMsg/errCode均null；没有原生失败回调。SDK不能读取腾讯内部底图网络请求；尝试点击Network后界面仍在Wxml，未获取底图请求错误。该截图是窗口记录，不是成功取得的Network日志。不能宣布网络、鉴权或腾讯海外能力为根因，也不能保证加Key解决。不继续改Taro模板。真机未测；未重跑八项北京/东京组合。H5沿用前次报告中的成功/失败证据，本轮未重新验证H5或宣称新的H5通过。

## 正式Provider的出口

启动时HTTP_PROXY/HTTPS_PROXY为现有loopback7890，NODE_USE_ENV_PROXY/NODE_OPTIONS未设置。旧默认fetch不主动使用该代理。先在独占账本锁下用Node显式--use-env-proxy探测一次，1507ms成功（历史第17次）；随后正式接入可选服务端PLACES_PROXY_URL，只为Nominatim请求创建HTTPS Agent的proxyEnv，不改变全局Agent/fetch或Planner网络出口。

不用全局flag的请求级传输探测1288ms成功，返回同一明治神宫身份。[显式环境探测](map-closeout-evidence/env-proxy.json)、[请求级正式Provider探测](map-closeout-evidence/request-proxy.json)。两者都是生产Provider类的直接调用，不是正式API POST。没有进一步查询或用静态坐标冒充解析。

代理要求Node22.21+或24.5+、HTTP(S)代理、HTTPS目标、GET-only、无自动重定向，响应上限200000字节。沿用Provider8秒截止和数据库限流；取消可在CONNECT未完成时及时结束调用。TLS照常校验，代理URL不进前端。留空即可回滚到原fetch。容器须配置实际可达代理，不能照抄桌面127.0.0.1。未改系统全局代理。

## 正式API与验收服务分开

3000为本分支backend0.1.0构建后的真实server/buildApp，使用既有.env与public数据库，局部开发进程REDIS_ENABLED=false，地点代理显式配置。未启用全局Node代理。3013旧places-live-server已停止，不拿其合成身份、文本、隔离schema数据替代正式链路。

[正式API回执](map-closeout-evidence/production-api.json)：实际wx.login、真实微信认证200，health/live与map-config200，既有travel_guide读取200，places GET409 PLACE_BASE_UNAVAILABLE。读取的是旧版未接纳攻略；只读核对public仅一份该攻略，无finalization/accepted底稿，public.guide_place_bindings亦未迁移（42P01）。409首先来自底稿门禁，不能说由缺表直接导致。未复制fixture进public，未追认旧稿、未运行终稿或规划。

后续要验证正式地点端到端，需现有合法接纳攻略和地点迁移就绪；本轮按禁止重新生成的边界保留缺口。前次places_map_20260922隔离缓存仍保留。

## 账本、测试和剩余边界

用户要求新USD2批次：旧17次账本原样归档到ledger-before-reset-2026-09-22T13-13-18-545Z.json，新账本保留prior文件名、SHA256、历史次数/费用。新批次1次免费地点调用，已知费用0/USD2。用户随后明确“地点查询不限次数”，仅取消地点数量限制，limit=null且unlimitedPlaceCalls=true；保留缓存、限流、独占锁与单次有界执行，不自动无限重试。见[无凭证账本副本](map-closeout-evidence/budget.json)。模型/研究/图片调用均0。

本轮backend build通过；transport3项与places12项离线测试通过。新增测试覆盖指定CONNECT代理、全局fetch不变、不重试、未响应代理可取消、非法协议拒绝。生产展示36项、地图原生失败回归与地图身份/联动回归均通过；三个维护脚本语法通过。微信构建通过，只有已有CSS顺序/体积警告。未做全量G1。

此次交付修复了生产Provider可配置出口并补齐可复核证据，没有达到“微信东京真实底图可用”。最小后续是同一已保存地点在真实设备上对照，或取得开发者工具原生底图请求错误后再定位；现有证据不支持立即替换地图供应商或继续修改地图组件。
