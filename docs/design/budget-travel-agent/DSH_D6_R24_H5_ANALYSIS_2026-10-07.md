# D6 r24：12 个固定 H5 场景结果与暂停交接

更新：2026-10-07。状态：**用户要求暂停，D6 未 PASS**。B01–B12 已各执行到成功或失败终点；不表示失败后的依赖动作也已执行。E01–E04 按用户最新要求暂缓，微信页面验收仍暂缓。这不是凭据或额度硬阻塞报告。本批只测试、只读诊断、保存结果，没有穿插产品修复或重跑成功样例。

## 分母、版本与证据入口

原 [D6 v1](DSH_D6_ACCEPTANCE.md)、[自然输入](d6-journeys.json) 与日期 2026-11-03～09 保持。12 个固定场景共 13 次 attempt：9 个场景 runner 明确失败，B05/B07/B08 的脚本动作完成；后两场独立复核又确认公开回复失败，不能把 `observed` 算成 PASS。B05 仅局部编辑、非目标保持、持久恢复等子项获得通过证据，未宣布整场事实完整验证。完整 12+4 合同没有完成，也没有降低门槛。

产品源码 `fee07e5dd4cff9afb402b91be721eb8cf2a5da44`，记录提交前 HEAD `1e653a7`，功能分支 `codex/dsh-reliability-d6`。run `c7c8b0b0-feac-434e-80bc-eb26e818cbf5`、独立 schema `dsh_d6_c7c8b0b0feac434e80bceb26e818cbf5` 全程相同。单主模型 `deepseek-v4-flash`、`deepseek-official` 搜索、thinking disabled、max_tokens 8192。真实 Chrome 154 H5 viewport/screen 390×844、DPR 1、默认 UA、mobile/touch=false；手机尺寸不等于完整移动设备仿真。

- [分析包索引](evidence/d6-r24-analysis/README.md)：逐场文件、原 attempt、截图与诊断入口。
- [完整脱敏 JSON](evidence/d6-r24-analysis/analysis.json)：原自然输入、实际动作、未执行步骤、公开全文/详情、网络路径/状态、observer 受控原因及只读 PG 投影。
- [关闭、指纹和费用摘要](evidence/d6-r24-analysis/audit-summary.json)：最终原始材料 SHA 与统计边界。
- [同版工程证据](evidence/d6-r24-freeze.json)：backend 1609/1609、真实专用 PG 52/52、D5 本地 HTTP/持久票价 fixture 30/30、runtime 14/14、observer 1/1、前端四族/TS/helper 21/21、H5/weapp 构建。它是本批 UI 前工程快照，不替代真实页面验收。
- [原 B01 失败和第一次暂停](evidence/d6-r24-b01-failure.json) 原样保留；后续恢复不追认原关闭正常。

## 逐场结果

下表耗时是原 runner 从开始到终点的完整时间。阻塞步数来自原报告，action index 从 0 开始。时延不是单次模型耗时，也不统一是 180 秒超时。

| 场景 | runner / 完整秒数 | 失败或子项复核 | 未执行的依赖动作 |
| --- | --- | --- | --- |
| [B01](evidence/d6-r24-analysis/B01.json) | FAIL / 59.613 | 首稿 46.590 秒 satisfied、9 活动详情已读；解释 4.081 秒被 withheld。实际冻结函数只报 `excluded_precise_claim`，另有无价格依据的“单价低”与节省预算说法。首稿 accepted 不等于事实全通过。 | 后 5 步：局改、刷新等 |
| [B02](evidence/d6-r24-analysis/B02.json) | FAIL / 2.748；FAIL / 127.903 | 首次原残留 manager guard，0 模型；恢复后的产品 attempt 首轮 125.256 秒 partial、0 accepted。两份 guide 本地化 finalization blocked：`excluded_precise_claim`、`excluded_admission_or_hours`。5 份 provisional 产物不能算正式成果。 | 两次各后 8 步 |
| [B03](evidence/d6-r24-analysis/B03.json) | FAIL / 25.458 | route_goal failed；SerpAPI 两次方法调用成功，12 报价、verified flight_search，仍无 route_set。`ROUTE_ORIGIN_REQUIRED → DESTINATION_AIRPORT_REQUIRED → NO_ROUTE_PATHS`。 | 后 8 步，包括采用及攻略 |
| [B04](evidence/d6-r24-analysis/B04.json) | FAIL / 25.269 | 11 真实报价但无 route_set；同前置错误，随后两次 `NO_ROUTE_PATHS`。不能写成票价供应商不可用。 | 后 8 步 |
| [B05](evidence/d6-r24-analysis/B05.json) | observed / 272.642 | 首稿 233.851 秒、局改 22.229 秒。五天 13 活动、前后共 26 详情；仅 D3 afternoon 替换，所有非目标项/顺序/正文严格相同，日期与 context 不变，两份 accepted guide 对应 goal satisfied，刷新读到末稿。来源/内容仍为 limited、partial，不能称逐项 verified。 | 0 |
| [B06](evidence/d6-r24-analysis/B06.json) | FAIL / 254.517 | 首轮 252.138 秒 partial，无 accepted guide。实链：`guide_research_type:practical` → prerequisite 候选不足 → `guide_result_limit` → `DSH_REPAIR_LIMIT`。不是已证实“不支持多城”，也不是城市顺序颠倒。公开提示未说明具体缺口。 | 后 5 步 |
| [B07](evidence/d6-r24-analysis/B07.json) | observed / 24.378；语义 FAIL | 查询无写；2000 CNY 正确保存为 trip 总额 v1；重复确认无新增版本/goal。预算设置成功却公开显示通用失败消息；未明确的 San Jose 没有效追问，明确 California 后仍通用改述提示。 | 0 |
| [B08](evidence/d6-r24-analysis/B08.json) | observed / 24.517；语义 FAIL | 无预算查询准确且只读；“每天500”及 San Diego/明确 California 两轮均通用改述，没有解释每日与全程换算或有效消歧。PG budget=null、destination=open，0 goals/artifacts，不得说已保存。 | 0 |
| [B09](evidence/d6-r24-analysis/B09.json) | FAIL / 32.780 | 停止 POST 400 `FST_ERR_CTP_EMPTY_JSON_BODY`，页面仍 busy、未确认停止。原生成继续，最终持久状态单列 post-drain。 | 后 5 步 |
| [B10](evidence/d6-r24-analysis/B10.json) | FAIL / 32.769 | 同取消请求错误；没有成功取消确认，不把后续写入描述为“确认取消后的迟到写”。 | 后 6 步 |
| [B11](evidence/d6-r24-analysis/B11.json) | FAIL / 233.060 | 首稿 84.756 秒、5 详情、重进/刷新、English 生成/详情/切回中文完成。真实冷重启同 artifact/hash，原浏览器认证 GET 200，中文 5 详情恢复。失败在 action16 返回 Planner 等 `.pl-result:visible` 30 秒，页面仍在攻略 overview；后续 My Trips 流程未执行。 | 后 5 步 |
| [B12](evidence/d6-r24-analysis/B12.json) | FAIL / 11.031 | 首轮 8.430 秒 completed/pending flight_search、0 artifacts；search_flights 入参 origin=BJS、destination=LIS，18.48ms 返回 `PROVIDER_NOT_CONFIGURED`，fare audit 无新增方法调用。公开称票价源未配置，准备层诊断详见诊断文件。 | 后 19 步 |

## 确认的问题与未确定部分

**解释与发布校验。** B01 原解释的“整趟 1200 元”预算目标及“并非已经核实的费用结论”被实际冻结纯函数误判；Astra max 的原文离线复现已保存。与此同时，“摊位小吃通常单价低”和拆正餐成小吃来节省预算没有价格证据，不能仅修误拦后整段放行。原解释没有 read_artifact，却扩展新事实；“千驮谷”对应 Sendagi 也有疑似地名错误，未确认的事实逐项标识。原被拦解释全文在诊断文件中标为未发布稿，不能与真实可见页面混称。

B02 原英文输入没有自动决定页面 locale；本批 UI/snapshot 默认 zh，不能仅因中文回复判语言违规。候选/草稿可见购票进入与营业时间等未经充分支持的公开说法，finalization 的受控原因已确认；没有把所有拒绝逐句定位完成的假象。公开“请补齐缺少的行程或资料”未给具体 publication issues。

**路线。** B03/B04 页面已有 PEK 经 DXB、IST 或 HKG/MAD 的真实报价，答复却声称这些枢纽未纳入或没有 priced option，形成并置矛盾。route engine 为什么未组合为合格路径尚未定位到确定分支；`NO_ROUTE_PATHS` 不能推导“没有航班报价”或真实全球最低价。页面没有自动采用。

**局改与证据边界。** B05 的非目标字段与持久一致性已独立逐项比较。3 份 guide 中仅 2 accepted，另 1 中间稿 blocked 原样保留。大多数来源是 JapanSpecialTraveler 中文长文、confidence .35，reference_only/partially_verified；页面提示 limited/partial。局改源支持竹林尽头、庭园与抹茶描述，但没有完成所有条目、旅行日期及实价的完整事实核实。初稿仍超过 180 秒；runner 原本等待上限是 360 秒，本批不宣布提速。

**多城与澄清。** B06 四份被拒的 commit draft 都按 Lisbon 四天后 Porto 三天排序，但没有任何正式 guide 可供用户读取，因此只记录未发布稿的观察。用户要求在昂贵操作前明确范围，实际仍执行搜索/地点/上下文后给泛化失败。B07 正确预算写入与错误回执是独立问题；B08 未写入每日预算是实际状态，失败在没有可操作澄清，不能据未写入指控越权。

**取消。** 已定位 `src/services/conversationService.ts:306` 发不含 data 的 POST，`src/utils/request.ts:56` 无条件 JSON content-type，Fastify 在 `backend/src/routes/agent-cloud.ts:263` 的 cancelAndWait handler 之前拒绝。既有 route 单测 `backend/src/routes/agent-cloud.test.ts:45` 只传 auth header，未覆盖 H5 的空 JSON 请求体。没有在暂停批次补测或修复；建议下一轮以真实 transport 的 header/body 回归这一缺口。B09/B10 的 observer 只按本场 Trip 关联，浏览器结束后直到 execution_closed 的原生成活动单列，避免跨场时间重叠污染。

post-drain 独立读取显示 B09 从 0 到 6 artifacts（2 research、2 route、2 guide，其中中文 1 blocked、1 accepted），新增 satisfied travel_guide goal 及 assistant；B10 从 0 到 2 research artifacts，新增 pending travel_guide goal、failed run 及失败 assistant，仍无 guide。两场各 2 个 context 版本保持，原行没有删除或更改。以上是拒绝停止后原工作继续的持久事实；没有跑后续 UI 恢复或把 B09 的 accepted 稿当取消场景成功。

**恢复。** B11 重启本身已经有读取证据，失败是之后导航未回到 Planner。导航栈、重复 history 或点击目标的深层原因未确认，不归咎冷重启服务。身份密钥只做重启后 hash 审计，没有 pre-key snapshot，不宣称前后 secret hash 已独立对等；实际旧 token 认证 GET 200 是恢复证据。

**航班入口准备。** B12 的 `search_flexible_flights` 和 `search_flights` 均返回 `PROVIDER_NOT_CONFIGURED`，工具先执行 `resolveFareAirportPair`，再进入 fare 方法；实际 fare audit 没有本场调用。BJS 是查城市后选出的城市码，同一 resolve 回执同时给出 PEK/PKX；当前三字母 selector 仍走 airport lookup。航空 AeroDataBox 和 SerpAPI 都可能抛同一个错误码，码本身不区分供应商。结合调用边界，航空准备失败是当前诊断方向；AeroDataBox 缺 key 的具体配置因果仍缺本批有效启动 env 路径的独立证明，不写成确定根因。SerpAPI 已有本批 B03/B04 成功及账号可读证据，不把公开“票价源未配置”当作已确认 SerpAPI 故障或整轮硬阻塞。

## 关闭、费用和材料限制

最后 PID57100 于 `2026-10-07T00:24:59.607Z` 正常 guards_closed，forbiddenCalls=0。恢复 PID62608、58616 也正常关闭；原 PID128072 缺正常关闭事件的事实保留。启动遗漏 `--places-url` 的一次恢复被 `D6_RESUME_CONFIG_CHANGED` 在业务调用前拒绝；原 B02 残留 guard 失败没有调用模型。核验原 PID 已退出、端口无监听后保存 server/manager/guard 原字节，再沿既有恢复机制处理，不改用户数据库/会话/账本。最终 server/manager/guard 锁不存在，测试服务停止。

最终六项 source/backend/H5/worker/783 文件归档/历史 ledger 实际 SHA 均与冻结一致。历史 ledger SHA 为 `3fdfdb12c1c3297c25548d54a53a2e4473f9f0d19c974f0f45a23afbd3d84126`；其原 pending 不改。本批 r24 为 199 model admissions、77 search admissions、276 settled、pending0、7,018,614 tokens；未知预留 USD17.20，实际费用回执为 0 条，**未知预留不是实付**。恢复后增量 189/73/262、USD16.32 未知预留。24 个保留运行累计 593/257/850、pending0、20,434,126 tokens、USD54.56 未知预留。

SerpAPI fare 方法共 4 调用；账号只读额度从 usage0/left250 到 usage2/left248。方法次数不等于计费网络次数，不推定金额或将账号缓存计数当费用。旧 PG review 的费用 fallback 实为全 run，不能作为单场费用；公开包保留 meter 关联 IDs，但未给未经逐条对账的单场金额。本次权限只覆盖现有 SerpAPI 剩余额度，未购买。

公开包采用白名单投影与凭据值/模式扫描；53 张原截图均检查后保留，所有原报告及投影有 SHA。PG 原件、认证 transport/header、完整会话、密钥、源缓存、数据库与原账本留在忽略的私有目录；公开读取材料不能替代它们。完整 JSON 较大，索引提供每场独立文件。工程日志的本地路径记录用于续作，不表示所有私有日志已上传。

## 续作边界

当前停止在用户指定的 12 个固定场景结果交接。未运行 E01–E04，不继续外呼、重跑、修产品或部署。所有可确认失败原因和待定位点进入 [诊断文件](evidence/d6-r24-analysis/diagnostics.json)。后续修复应保留这些原失败，针对具体原因补回归；产品代码变化后建立新的冻结批次做完整工程与真实 UI 验收，不将 r24 的成功子项拼接成同版完整 PASS。该说明是续作记录，不构成新的执行授权。
