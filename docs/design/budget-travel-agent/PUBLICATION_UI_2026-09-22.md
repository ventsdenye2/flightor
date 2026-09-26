# 正式概览、每日行程与景点详情

第四阶段当前增量：正式封面不再固定null，按当前版本首个有图活动取实景并标景点名；列表/详情共用活动媒体，独立GET与字段合并不重置日期或展开活动。失败收起图片区，署名/许可放二级低干扰入口；显式补图，中英文共用照片、alt随接纳标题变化。详情见[第四阶段报告](PLACE_MEDIA_2026-09-22.md)。下文“地图/媒体无Provider”仅为第二阶段当时范围。

基线 main@8b51c99（上一项已独立提交）。本轮复用 [ADR 0025](../../adr/0025-bounded-guide-finalization.md) 的已接纳终稿、语言缓存及显式重试，不改变 Planner/研究/航班检索/Goal。正式组件、离线测试与平台 fixture 验证见下；不是全量 G1 或生产部署。

## 展示合同

2026-09-26后端恢复修正：workspace取最新100条Artifact窗口，公开引用按旧→新排序；未公布且无accepted语言的初始终稿草稿不作为结果卡片引用。另一语言已accepted或历史assistant已公布的失败终稿仍保留本地化/重试入口。前端仍选择最后一个攻略引用，源码不变；详细问题和数据库回归见[DSH发布记录](DSH_PUBLICATION_2026-09-24.md)。

正式页面只显示当前 Trip/已选航班版本、目标 locale、accepted publication 的 overview、每日 theme 及稳定 activityId 的 title/description/recommendationReason。不拼原始 summary、研究摘要、取证摘录或旧版公开正文。旧版、过期、准备、技术失败、材料需修订分开显示；领域 satisfied 不授权内容发布。

读取页面/刷新/tab 不生成终稿；缺失语言与技术重试均由明确点击触发，重试须同时 canLocalize、canRetry 和当前 revision。结果按 locale 缓存，切换后旧请求不能更新当前选择。具体失败用现有 issue code 本地化短提示，保留活动身份；原 detail 和研究继续保留后端审计。

概览以主题、日期、路线、每日入口及可信航班摘要为主。预算只写目标；自备机票须有明确当前状态依据，不从无已选航班推断。来源放二级入口，不展示长 URL 或证据摘录。地图/媒体无 Provider 接入，仅贯通可选、版本绑定的服务端 enrichment，缺失时紧凑降级。

## 字段映射

| 权威输入 | 展示/约束 |
| --- | --- |
| publication.locale/status/guideContentHash、artifactId、tripContextVersion；workspace 当前 contextVersion 和 flightSelection.revision/身份 | productionPresentation 校验后才允许正文。旧版、错语言、过期、未接纳隐藏全部活动正文；未完整的接纳投影转需要修订，不回退 summary |
| publication.overview/reply | 概览旅行介绍、会话短回复；不与旧公开投影或研究摘要拼接。用户原始消息未修改 |
| days[].theme/day、items[].id/title/timeOfDay | 每日主题、稳定身份、接纳名称、建议上午/下午/晚上；翻译标题不作主键 |
| items[].description/recommendationReason | 列表行动简介、详情“景点简介”“为什么推荐”；不读取 planningNote 或 supportingEvidence 作为 fallback |
| items[].city | 所在城市/区域线索；保留原地名、locationHint 的 id/name/cityCode/countryCode，不编造景点精确位置 |
| publication.failureKind/revision/canLocalize/canRetry/issues | 六种页面状态；内部 activityId 保留关联，issue code 翻译成短提示。明确关闭/日期冲突保留，不展示原 detail/URL/hash |
| 当前 Trip notes | 新增只读 summary.notes 接点。仅明确肯定“机票自备”等记录才显示自备；无选中航班不等于自备；已选航班优先 |
| 既有已选航班 Artifact | 沿用选中身份和 contextVersion 的可信航段/报价；缺失紧凑降级。旧时间适配器固定缺失/时区提示本地化，原时刻和机场时区不重算 |
| budget.amount/currency/scope | 预算目标；金额及口径不变，不宣称满足预算或核定花费 |
| publication.references | 安全 HTTP(S) 来源留二级入口，正文不展示标题摘录/长链接；不删后端原始研究和审计 |
| 可选 envelope.enrichment | 同 guideContentHash 的 contentVersion、以 activityId 索引；合法 coordinates.latitude/longitude 和 media.src/description/source.label/url 透传。不同版本/身份忽略，无字段时紧凑降级 |

enrichment 是后续素材服务的独立响应扩展位置，本轮没有 Provider、上传或坐标获取。供应商署名保留；city center 不冒充景点坐标。素材变化不写回 Trip 或终稿散文、不变更活动ID/内容hash、不触发终稿。现有地图组件仅在真实坐标存在时使用，未更换地图实现。

## 调用与失败边界

- `loadProductionTrip`、页面挂载、刷新、tab、语言切换和轮询只读 GET。已接纳结果由原语言缓存/持久恢复复用，不调用模型。
- 缺失语言：已有接纳底稿且 canLocalize 才给“准备当前语言”按钮；不自动首次生成。没有底稿仅显示草稿/准备状态和返回规划入口。
- 技术失败：按钮需 canLocalize **且** canRetry；点击后强制读取最新状态并核对当前 revision，调用既有 localization（retry=0）。材料/计划问题只引导原规划修订，不循环重试、不自动重新规划。
- 同步 ref 防重复点击；原服务按 owner/session/locale/revision 合并请求。结果按语言缓存，组件按完整请求 key/authRevision 接纳，处理中换语言不覆盖当前选择。旧缓存/过期版本不会展示为完成。
- 不新增环境变量、模型配置、依赖、迁移或后台任务。失败保留原后端草稿、费用与历史；前端只展示整理过的短状态。rollback 可回退本次 UI 提交，终稿持久合同未改变；回退旧 UI 并不保证本次清洁展示。

## 验证记录

| 检查 | 本轮执行结果 |
| --- | --- |
| 前后端类型 | 根目录 `npx tsc --noEmit --pretty false`、backend `npm run check` 通过 |
| 后端定向离线 | agent-cloud 3项（含新增 notes 只读测试）；travel-guides/finalization 26项；agent/cloud/finalization 1项，共30项通过 |
| 前端定向离线 | production-presentation 34、artifacts 25、finalization-client 8、planner-publication 9、planner-telemetry 8、plan-flight-publication 12、planner-reply 6、production-library 7、route-page-dispatch 20、route-ui-polish 18，共147项/断言通过 |
| 构建 | H5/weapp 均成功；保留既有 bundle/entry size 与微信 CSS order 警告。非性能基准，不声称提速 |
| H5 正式页面 | 已安装 Chrome，390px与320px；自备/已选两入口。概览→两天共4活动详情→刷新→中英切换，每入口16次简介/推荐理由检查；航班展开、长英文名称、无媒体、旧版、准备、技术失败、需要修订、关闭提示和窄屏布局断言通过 |
| 微信正式页面 | 已登录开发者工具模拟器，既有9432 SDK；同两入口、中英4活动、页面reLaunch文本相等、航班展开、失败显式重试、准备/修订/旧版。finally恢复原语言/页面及request，身份不替换 |
| 请求边界 | 每个平台4个显式 localization POST（每入口一次重试+一次首次准备）；普通刷新/详情/tab/读取0 POST。H5另测英文请求处理中切回中文，迟到结果未覆盖中文 |
| 未执行 | 本轮无真实 API/Provider端到端、真机、全量 G1、数据库测试或素材 Provider 验收。全部页面采用冻结 API 运输；后端语义另由定向离线测试覆盖 |

页面 fixture 复用上一任务真实中英终稿示例和原双入口持久 fixture，按稳定原活动ID映射展示；这不是本轮重新研究或事实认证。故意加入 supportingEvidence 中票价/营业时间/URL 与审计预算文案，断言不泄漏。原研究、历史记录和旧账本不修改。本轮真实模型/研究调用 **0**，费用 **US$0**。

失败与修复没有从记录中抹去：初始 fixture 缺括号/缺 tripId 已修正；捆绑 Chromium 启动 EPERM，改用已安装 Chrome；微信曾运行旧 bundle，CLI端口发现及窗口激活失败均未触发清库/重装，最终新构建被现有 SDK读取并完成验收。截图复查发现 H5 语言按钮挤压标题与动画未结束截屏，已修 CSS并关闭截图动画；航班展开发现英文缺失时刻仍中文，增加固定状态翻译和断言。一次调用错误的 test-ui-polish 文件名未执行测试，随后使用正确 test-route-ui-polish 通过。所有失败 JSON 保留在 output 子目录。未重启 Docker。

## 截图、报告与复现

完整截图/文字请求断言留在仓库忽略目录 `output/playwright/publication-ui`、`output/weapp/publication-ui`（各 report.json，失败另存）。精选12张前后/中英/状态截图及成功报告归档如下；不把 fixture 运输称作真实 API。

| 平台 | 修改前 | 修改后 |
| --- | --- | --- |
| H5概览 | [原概览](publication-ui-evidence/playwright-selfTicket-before-overview.png) | [中文概览](publication-ui-evidence/playwright-selfTicket-zh-overview.png) |
| H5详情 | [原详情](publication-ui-evidence/playwright-selfTicket-before-detail.png) | [320px英文详情](publication-ui-evidence/playwright-selfTicket-en-narrow-restored-day1-detail.png) |
| 微信概览 | [原概览](publication-ui-evidence/weapp-selfTicket-before-overview.png) | [中文概览](publication-ui-evidence/weapp-selfTicket-zh-overview.png) |
| 微信详情 | [原详情](publication-ui-evidence/weapp-selfTicket-before-detail.png) | [英文详情](publication-ui-evidence/weapp-selfTicket-en-day1-detail.png) |
| 状态与航班 | [H5关闭问题](publication-ui-evidence/playwright-selfTicket-revision-required.png)、[微信显式重试](publication-ui-evidence/weapp-selfTicket-retryable.png) | [H5英文航班](publication-ui-evidence/playwright-selectedFlight-en-narrow-restored-flights.png)、[微信英文航班](publication-ui-evidence/weapp-selectedFlight-en-flights.png) |

[H5请求断言](publication-ui-evidence/playwright-report.json)、[微信文字/恢复/请求断言](publication-ui-evidence/weapp-report.json)、[147项前端离线检查输出](publication-ui-evidence/offline-report.json)。最终页面批次为 2026-09-22 13:37–13:41（Asia/Shanghai）；微信构建指纹 `ef2c5a7b8fbc64df13f3558fc847b6a618fde6306bf3ff941945eb208695d7cb`。构建来自保留其他任务未提交修改的工作区；本提交只纳入本轮文件/文档增量。截图人工复核通过，微信为模拟器截图，不是真机。

命令：先 `npm run build:h5`、`npm run build:weapp`；H5使用已启动的 `node scripts/serve-h5.cjs`，然后分别运行 `node scripts/qa-publication-ui-h5.cjs` 与 `node scripts/qa-publication-ui-weapp.cjs`。微信须已有登录/9432自动化连接，脚本不重装 SDK 或修改身份。不要与其他微信 mock/真实规划同时执行。


2026-09-26用户明确批准DSH验收中唯一前端例外：Plan页存在旧攻略时，纯解释（stopReason=responded、delivery=not_requested）显示当前会话的同locale回复，不再被旧publication.reply覆盖。攻略提交仍显示accepted publication.reply；异语言旧回复仍不展示。不改页面布局、交互或API字段。真实暴露案例的API已回答谷根千原因且无搜索/写入，旧页面却重复保存文字；对应组件回归覆盖解释、locale保护和提交尾句隔离，真实重测另记DSH D4。
本批实际Plan组件离线hook集成13/13通过；正式H5构建成功（Webpack62.721s，既有体积警告）。该构建尚不等于解释页面已验收，以真实D4回合为准。

2026-09-26用户进一步明确批准同一字段选择扩展：`trip_context_update/satisfied`且`stopReason=completed`的预算保存回合也展示当前同locale会话回复，避免旧局部修改的publication.reply覆盖预算确认。仅扩展该条件；解释规则、攻略提交取接纳publication.reply、异语言保护均保持。新增实际Plan组件用例覆盖成功预算确认、locale不匹配、partial/blocked/model_failure及travel_guide提交；运行结果与真实H5恢复证据另记DSH报告，不将代码修改认定为页面通过。

本次条件扩展实际Plan组件14/14通过，正式H5构建31.335秒（既有体积警告）。A真实只读恢复报告A-restore-2026-09-26T09-28-43-814Z在后端历史投影配套修复后显示本轮“两天合计1200元”预算正文，刷新恢复攻略一致，0POST且原账本SHA不变；已人工查看restored-planner-reply截图。仅该字段行为通过，不代替B全流程或G1内容验收。
