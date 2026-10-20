# 设计与合同

版本：0.1。只有一条产品路径：无界面 Google Chrome 从 Trip.com 首页执行搜索。CLI、MCP 和 TypeScript API 共用 `FlightTool`；Agent 理解自然语言，工具只接收明确参数。

## 2026-10-20 原生往返

tripType 默认 one_way；round_trip 必须同时带 departureDate/returnDate。校验真实日期、返程不早于去程，正常填入Round-trip双日期表单。初始SSE验证SUCCESS/recordCount后，选择首个最低起价去程作为查询分支，等待返程Middle响应SUCCESS/journeyList（仅元数据的增量不算完成），核对同一URL的两个日期和两个方向的机场/时刻。返程每行价格就是该分支的原生组合总价。最多取maxResults个返程并展开包含去返程的详情；按各自出发日期分别解析，跨日标记只用于对应方向。只浏览候选与详情，不点击出票/预订。

coverage=selected_outbound_return_options、lowestPriceVerified=false，不声称遍历所有去程。详情稳定后若价格发生变化，更新组合总价并记录变价提醒；不把初始起价与返程总价相加。分段cabin保留实际舱位；组合最小行李摘要不伪装成每一方向的确定额度。保存的sourceUrl只含地点/日期/人数/舱位/币种等公开查询参数，去除临时criteriaToken/shoppingid等内部参数。完整FlightOR合同与验收见[往返查询](../../docs/FLIGHT_OPTIONS.md)。

## 执行流程

1. 严格解析参数、解析受支持的位置、按出发地时区校验日期。
2. 获取工作锁，设置总预算与取消信号。
3. 启动或复用无界面 Chrome，使用独立浏览器上下文；有本地 Trip.com 会话时自动加载，没有时使用未登录会话。
4. 设置币种、单程、地点和日期，提交正常搜索表单。地点输入先打开控件并在各自 wrapper 内删除历史城市标签，再选择唯一目标；仅 fill 输入文字会追加目的地，可能跳到 explore 地图。选完核对仅有一个城市/机场标签，避免将旧目的地带入查询。
   日期选择读取可见月份的年/月，目标在更早月份时向前翻，晚于可见范围时向后翻；目标已在两个可见月之一则直接选日。等待月份切换并检查按钮/日期是否禁用，最后核对 data-date。页面可能恢复历史查询日期，不能假设总从当前月开始。
5. 核对结果 URL 的地点、日期、人数、舱位和币种；等待本次流式响应完整结束，验证业务 SUCCESS 与有效结果数量，再逐个核对返回候选的机场和出发日期。
6. 精确定位 Cheapest 排序 tab；已选中则不重复点击。等待列表经过暂时空渲染后稳定，并验证价格升序。接口有结果而页面为空时不得返回“无航班”；结果数量未知时不得声称验证了最低价。
7. 逐个展开最多 5 个候选的详情，重新核对候选身份、价格、航段首尾时间、机场和中转数量。
8. 保存原始文字、截图和结构化 JSON，关闭本次上下文，释放工作锁。

Chrome 的 User-Agent 由当前浏览器读取得到，仅规范化 HeadlessChrome 名称，不写死 Chrome 版本。程序不做自动验证码处理，也没有可见浏览器回退选项。

`login` 是显式的人工登录准备命令，会打开专用可见窗口；查询失败不会自动进入登录模式。用户完成登录后，仅保存 Trip.com 域 cookies、localStorage 和 IndexedDB 到 `.auth/trip.json`，排除 Google 等其他域，文件不进入 Git 和打包文件。后续 CLI/MCP 共用该本地状态；登录可能过期。诊断脚本可在人工登录后直接用同一上下文执行一次查询，正式 search 命令仍为无界面路径。

## 状态

| 状态 | 含义 |
| --- | --- |
| complete | 请求范围内的排序结果与详情均已提取、核对 |
| partial | 有候选，但稳定性、数量或详情不完整；检查 warnings |
| no_results | 当前页面明确显示无结果；不等于证明所有渠道无航班 |
| needs_user_action | 验证码、401/403/429 或有限同页重试后仍受限；停止自动重试 |
| cancelled | 调用方取消；等待本次页面清理后返回 |
| error | 参数、网络、页面变化或校验失败；有明确 code 与 retryable |

`lowestPriceVerified` 与详情完整性是两个维度：排序已核对但某个详情缺失时，仍可以返回已验证的当次搜索最低价，同时 overall status 为 partial。

## 身份、报价与时间

searchId 为 UUID；candidateId 为起降时间、机场、航空公司和中转摘要的指纹。候选 ID 只用于这次搜索，不承诺跨搜索稳定。读取详情时必须同时提供 searchId 与 candidateId。

价格变化不会修改候选身份，但展开详情的价格若与列表不一致，就不发布该详情并要求重新查询。报价记录 observation time，并与 checkoutVerified 分开。

详情日期从页面显式日期标记和搜索日期恢复；在首尾与候选完整时间完全一致、段数与中转数一致之后才发布。中间时区未知时不进行 UTC 推算，也不补造字段。

## DSH 适配

优先使用 DSH 现有 MCP bridge，通过 stdio 暴露两个工具。标准 MCP `structuredContent` 为程序结果，text content 为相同 JSON，DSH 原生模型投影与程序调用都能读取。

内部预算 180 秒，MCP 预算 210 秒。DSH 外层 timeout-policy 使用工具自身声明，不另设统一默认上限。浏览器取消通过 MCP signal 传入，并等待 context.close 完成。

只读查询不会写入 FlightOR 业务数据库；后端接入方拥有其业务状态和证据持久化策略。
# 2026-10-20 全球城市消歧

原生地点选择不按城市名子串点击。London实际返回英国、加拿大和East london候选；城市组的机场`data-value.airportCode`与已解析的机场集合匹配，允许Trip.com展示名和本地英文名不同。只有唯一元数据匹配才点击；没有元数据时只兼容唯一精确城市标题，同名不取首项，返回LOCATION_SELECTION_FAILED。URL和最终候选机场/日期继续校验。目录检索范围与本轮真实修复结果见仓库 [全球地点目录](../../docs/AIRPORT_LOCATIONS.md) 和 [查询合同](../../docs/FLIGHT_OPTIONS.md)。

具体机场网址由城市与机场过滤共同表示（如TYO+HND），按精确机场过滤核对，不要求城市字段等于机场代码；城市查询禁止被缩到单个机场。来源URL保留dairport/aairport。adults扩为1–9整数，原生乘客弹层先清零旧儿童/婴儿数量，再调整成人并确认经济舱，最后核对quantity。公开价格仍为每成人，不自行构造多人库存或总价；完整验证见仓库查询合同。

原生选址点击后可能异步生成选中chip，等待可见后才检查唯一性。多人卡片的无障碍价格标签可能是多人合计，按可见卡片的每成人金额和明确Total分开提取，`price.totalAmount`保存网页合计；详情稳定后同步对应总价。不得直接把标签总价当每人价，也不据单人价推造多人报价。

恢复旧地点时，新版候选弹层会遮挡原删除图标，编辑器也会迁移。用空输入框的正常Backspace移除旧chip，按原生防抖节奏逐次核对，清空后才填写新地点；不force click、不清除会话。原生页面操作TimeoutError分类为TIMEOUT，保留日志，不统称页面结构变化。


2026-10-20稳定性修复：结果导航等待DOMContentLoaded，整页load不作为航班响应就绪条件；响应仍须SUCCESS及真实数量、DOM和票价/航段一致。每次尝试记录私有阶段/耗时/脱敏查询网址。往返多人去程仅为起价，允许使用明确Round-trip price无障碍总价；最终返程组合及单程仍要求可见Total。技术经停从航班详情块读取segment.stops（city/durationMinutes），与connections分离，中停数=换乘+明确经停；不编造额外航班或时间。证据与连续实测见主仓docs/FLIGHT_OPTIONS.md。

2026-10-20扩展矩阵发现国内页面为 /chinaflights/showfarefirst，搜索使用JSON FlightListSearch（国际仍为FlightListSearchSSE）。观察器按SUCCESS、有效recordCount/itineraryList及pollInterval=-1确认最终完成，正轮询未完成时不发布结果；缺业务状态、缺数量、计数与空列表冲突均拒绝。公开来源保留国内路径，错误/私有令牌不公开。主仓docs/FLIGHT_OPTIONS.md记录首次9人同日往返失败及修复复验。
