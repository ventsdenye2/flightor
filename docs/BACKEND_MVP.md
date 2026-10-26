# 从本分支开始开发后端

## 2026-10-26 聊天结构化交付 B＋C（当前协议）

聊天角色通过 submit_conversation_reply 工具交付非空 reply 和显式 intent(chat/plan)，按本次会话、执行窗口和 toolCallId 配对成功结果，保留 session/wait 完成边界。相同提交幂等，不同提交冲突失败。首次交付＋最多一次定向补正：原生字段失败与应用层漏交提醒共享预算；补正最长30秒，受原任务超时与取消约束，tools.guard 只允许提交工具。失败使用既有 errorCode=OUTPUT_PROTOCOL_ERROR，并显示可重试提示，不将原始JSON或缺intent默认为普通聊天。REST请求形状保持不变。规划自然语言草稿和审核现有协议保留。

三个独立角色仍顺序执行，initialize 显式传 reasoningEffort：聊天 low、规划 max、审核 high；deepseek-account/deepseek-flash、插件与默认输出上限保持现状。本节覆盖下方历史记录中聊天JSON回退和未覆盖思考强度的说明，审核JSON回退不在本轮范围。每次执行保留私有初始化参数及提交/补正诊断，不向前端发送工具原文。

离线回归、双端构建和10月25日矩阵的独立真实复测正在进行；结果另记，不以接口completed代替业务成功。地点消歧、图片缺口、旧行程调整和航班观察器只记录，不在本轮修复；不据此宣称微信真机或服务器部署通过。

2026-10-20成人数：手动查询与Agent工具均支持`adults`为1–9整数，省略默认1；前端加减后实际传给CLI，原生网站乘客控件清零儿童/婴儿并设置成人数，网址quantity核对。城市与具体机场分别按城市范围/机场过滤确认，修复HND被误判，见 [FLIGHT_OPTIONS](FLIGHT_OPTIONS.md)。不新增Agent，不变更模型设置。

2026-10-20查询故障：Trip.com同名城市选取改按候选组机场元数据匹配全球目录，避免英国/加拿大London及East london混淆。手动查询公开中文分类错误与`errorCode`，CLI无searchId的失败也保存私有输入/诊断，范围与证据见 [FLIGHT_OPTIONS](FLIGHT_OPTIONS.md)。

2026-10-20地点点选：新增只读 `GET /api/flight-locations?q=`，从已构建CLI目录返回最多12个中英文/代码候选，不调用外部服务；城市聚合与具体机场的 `value` 保持解析范围。共享表单改为地点弹窗和单程/往返日历，实际查询仍走原手动CLI链路。合同与验收见 [FLIGHT_OPTIONS](FLIGHT_OPTIONS.md)。

2026-10-20手动查询：[规划入口机票搜索](FLIGHT_OPTIONS.md)新增 `POST /api/flights/search`，直接复用 Agent CLI 执行器并沿用任务轮询/取消与单并发。成功后将航班和原始证据保存到当前对话；不调用模型、不创建规划结果。H5/微信正式入口使用真实查询，失败不回落样例；航班选择和双向交通规划前提保持一致。

2026-10-20：[往返工具与双向交通前提](FLIGHT_OPTIONS.md)替代下述单抵达提示词。工具新增 `tripType/returnDate`，往返同时校验两个日期；候选可含去返程 journeys，原生组合总价只计一次。`action=plan` 不再绕过对话 Agent，由其先判断双向交通是否确认；缺失时继续 chat。已选旧方向从消息时间线传入 confirmedFlights，保留当前 selectedFlight 兼容字段。没有新增 Agent 或模型配置覆盖。

2026-10-19提示词调整：[航班组合与抵达依据](FLIGHT_OPTIONS.md)。规划前需已有用户采用的航班组合/已购航班时刻，或用户明确给出抵达时间；否则使用已注册的 `search_flights` / `get_flight_details` 先取得候选并请用户选择完整组合。未扩展航班CLI，未新增Agent、接口拦截或额外模型会话；显式按钮仍直接进入规划者，由提示词处理查询/待选组合，实际模型遵循度需单独观察。

当前景点获取与发布以[审核 Session 批量补全](PLACE_LOOKUP_BATCH.md)为准：本地索引/缓存 → Enterprise → 公共 API；审核者的现有 Session 调用 `lookup_places_batch`，仅对明确缺失字段作一轮关键词修正，成功字段锁定。默认共享预算为首次景点数×2秒+5秒，后续修正不重置；网络/429不触发语义修正。后端按活动 ID 合并图片和坐标，保存 `placesResolved: true`，前端新行程加载不再自动调用地点接口。保留三个 Agent 及旧接口。下述严格 QID 规则和前端独立补查是历史迭代说明，不覆盖当前行为。

2026-10-19景点定位/图片统一为 [PlaceResolver](PLACE_RESOLVER.md)，先查本地 Wikimedia Geo SQLite，再按 Wikidata/Enterprise/Commons 补充。保留现有 HTTP 与展示合同，不增加 LLM 匹配，不修改聊天/规划/审核 Agent。该文档的来源、消歧、缓存和验证边界替代下述旧版独立名称搜索细节。

2026-10-19新增每日地图地点补全：`POST /api/place-locations`仅按景点名与城市读取Wikidata唯一匹配实体的P625坐标，独立缓存，不创建run、不调用DSH、不改写行程；接口、失败边界和前端地图交互见[每日地图](TRIP_CONTENT.md)。

2026-10-19新增[行程内容与图片](TRIP_CONTENT.md)：`POST /api/place-media`直接使用Commons免费接口，按景点/城市缓存许可元数据，失败留空。审核JSON新增`highlights`及景点`introduction/recommendationReason/visitNotes/imageQuery/city`，`issues`独立映射`travelNotes`，不再混入概览。图片不由模型提供URL，不引入审核拒绝或自动返工。

2026-10-19工作区提交复验：`npm run backend:test` 18/18通过，`npm test`、`npm run check`、`npm run build`及文档检查通过。后端测试和文档检查首次因沙箱禁止子进程启动报`EPERM`，在沙箱外重跑成功。微信构建仍有图片体积和代码分包建议。本次仅复跑本地检查，未重复浏览器或微信真机验收，未调用付费模型或供应商；此前交互验证保留其原有范围。

2026-10-19对话时间线修复：航班选项、已选项及锁定状态附着在首次返回该搜索的助手消息上；行程展示结果也附着在对应规划消息上，刷新恢复并传回行程页面。完成状态发布前先保存对话结果。旧对话按同一conversationId的已保存run恢复原卡片与行程，不调用模型。选择后发送下一条消息/点击规划即保存锁定，旧组选项不能再切换或取消；新查询可产生新组选项，选择本身仍不触发规划。

本批复验：18项后端回归、前端回归、H5/微信类型检查与两端构建通过；独立Playwright使用模拟API验证选项留在原消息、选后聊天锁定且刷新保留、行程在刷新和后续聊天后保留且可打开，320/390/1440宽度无横向溢出。行程入口已改为浅蓝结果卡和蓝色“查看行程”按钮，整卡可点击并提供键盘焦点样式。空闲API重启后健康状态ready、H5返回200；只读恢复原有18条消息的布拉格·维也纳对话，航班选项位于第14条、行程入口位于第18条，重复GET保持一致。验证未调用真实付费模型或供应商，未做微信真机测试，未改自动滚动逻辑。

2026-10-19对话状态修复：GET任务状态新增单个`progress {text, role, updatedAt}`，由DSH真实会话/步骤/工具/重试事件更新，仅公开活动摘要，不转发内部推理或工具原文。进度在内存任务上即时替换，沿用1.5秒轮询读取；不对每个事件写盘，阶段及结果照常保存。聊天答案保存后立即发布，不再等DSH退出才让前端取得回复。发送按钮运行时切为停止图标，取消即解除前端等待并忽略迟到结果；提交尚未返回ID时也可取消，ID迟到后补发取消请求。H5每次HTTP请求20秒超时（与微信一致），整个模型任务仍可持续12分钟。最近两次保存的聊天分别在8秒、15秒完成，不能据此认定模型未回复；用户原标签页当时为何未显示回复尚未复现。

本批验证：H5/微信类型检查和构建通过；客户端回归覆盖GET未返回时立即取消、POST未返回ID时取消并补发DELETE、迟到结果不入storage、最新活动摘要轮询；假Agent回归覆盖事件映射和答案在退出清理前发布。独立Playwright浏览器使用模拟API验证仅一条状态、发送按钮切为停止、取消后第二条消息正常展示、旧回复不覆盖以及截图说明区移除，320/390/1440宽度无横向溢出。未调用真实付费模型、未做微信真机测试；原用户标签页的现场状态未直接读取。

2026-10-19新增[航班选项](FLIGHT_OPTIONS.md)：CLI候选映射到对话公开展示，单独保存选择的接口不启动任何Agent；聊天和明确规划均读取所选真实快照。字段、详情与推荐比较规则见该文档。

2026-10-19新增对话执行器：普通消息交DSH旅行助手结合完整记录自然交流；只有明确制作行程的意图或用户点击生成行程才调用原规划与审核链路。完整带角色的对话作为规划输入，按用户最新修正理解需求；不要求补齐资料才输出。对话保存到本地忽略目录backend/data/conversations，接口、双端交互和验证正在同批接入。

回归覆盖普通对话不调用规划、第二轮保留首轮和修正、明确意图后将全部上下文交规划、刷新恢复、显式按钮、不规范意图回退聊天、取消后不发布迟到结果。意图语义由DSH判断，尚需真实模型样本验证；不是前端关键词开关。

聊天查询的原始工具结果独立存conversation-evidence，不放入公开消息；后续聊天及规划/审核均接收这些证据，沿用真实机票快照而不凭助手摘要重造。规划收到先机票后安排的顺序提示；工具失败不阻止输出但必须说明未知。H5基础View支持ref以滚动最新消息，不改对话框焦点逻辑。

`POST /api/conversations/turns`接受message、可选conversationId和action(chat/plan)，返回202及任务id，沿用GET/DELETE /api/runs/:id轮询与取消。普通发送的chat由DSH理解是否用户明确要求现在规划；显式plan仅用于用户点击“生成行程”。GET /api/conversations/:id恢复可见消息，不返回内部推理；每次DSH对话均重放服务器保存的完整上下文，不依赖前端拼接历史。仍为本地单并发。

更新：2026-10-19。状态：最小双 DSH Agent 后端已实现，实际验收见 [DSH_MVP](DSH_MVP.md)。使用 Node 内置 HTTP 和本地 JSON 文件，不引入数据库/队列/微服务。模型和工具运行由完整 DSH 负责。

| 位置 | 后续接入点 |
| --- | --- |
| `src/features/ui-experience/presentation.ts` | 行程、报价、活动的展示模型，不是已定的服务端协议 |
| `src/features/ui-experience/AppExperience.tsx` | 共享页面编排和本次真实行程；收藏/提醒仍为内存状态 |
| `src/features/ui-experience/PlannerPage.tsx` | `start` 默认连接真实生成器，显示阶段、失败与取消，迟到结果忽略 |
| `src/features/ui-experience/backendClient.ts` | 双端共享的提交、轮询、取消与成功结果恢复；取消信号不依赖微信缺失的浏览器全局 |
| `src/features/ui-experience/flightSamples.ts` | 当前对注入样例做本地筛选，不查询供应商 |
| `src/features/ui-experience/experienceSamples.ts` | 双端固定展示数据注入点 |
| `apps/ui-preview/src/main.tsx` | H5 入口和样例面板 |
| `apps/ui-preview/taro-entry/pages/index/index.tsx` | 微信入口与平台能力 |

服务端 `backend/src/contract.mjs` 只做JSON读取与展示适配，不设业务验收门槛；字段缺失用空值，非JSON原文保留为可读概述。H5 fetch和Taro.request分别提供运输适配。POST /api/runs接收prompt和可选补充constraints，GET /api/runs/:id读取状态/结果，DELETE取消并等待本次清理；POST单并发，忙时409。API仅绑定本机，不提供业务身份认证。

已接真实规划 → 独立审核整理 → 展示映射 → JSON保存。按用户最新要求，删除业务校验、审核否决、自动返工以及任意天数/人数/活动数量上限。资料不足、来源缺口、旧报价或审核疑问都不阻止输出；来源保持unverified。航班候选的价格和时刻直接从CLI快照映射；找不到快照时仍显示行程，只不生成不存在的航班卡片。不保证结构适配等于需求符合或事实验证。

分别验收H5、小程序模拟器和真机。旧后端/设计只作历史参考，不复制旧运行配置、密钥、合同或授权。新一轮真实调用由本次用户要求的接入验证授权，不沿用旧G1/D6账本。本轮失败和成功均保留在本地数据目录。
