# 验收记录

当前状态：**持久化会话的新进程无界面 CLI 已取得里斯本、巴黎及布拉格查询报价；历史目的地残留和历史日期只向后翻月的问题已修复，长期稳定性验收仍未完成。** 以下按阶段保留历史记录；全球目录和日历修复的最新验收见对应章节。暂停重新打包。

测试日期：2026-10-19，北京时间。具体时间、结果和报价以 `artifacts/verification/*.json` 及对应 searchId 目录为准。

## 已核对的事实

- TypeScript 编译通过。
- 离线行为测试覆盖价格币种、三段行程、伦敦换机场、行李、TAP 航司名与机场代码混淆、日期/地点校验、访问限制、预取消、两种候选按钮文案、排序后清空及结果数量文案。
- MCP stdio 工具发现与参数错误返回通过。
- 本机 DSH 真实工具注册表发现两个工具，错误调用通过；未修改 DSH 源码和默认用户配置。
- 无界面独立探测已抓到 2026-10-28 北京到里斯本的 US$319 方案，完整航段 JD5755 / GS7965 / U22459，识别 LHR → LTN 换机场、自行转机和无行李。

## 正式入口实测

- 正式 CLI 无界面查询通过：北京时间 2026-10-19 10:09:30 完成，耗时 44,376 ms，退出码 0，status complete。
- 查询条件：BJS → LIS，2026-10-28，1 名成人经济舱，USD，返回 3 个候选。
- searchId：`9634ebb6-7fd4-40b7-b41b-e12adc1347bd`。最低页面报价 US$319；三个候选均抓到 3 段航班和 2 次中转，lowestPriceVerified 为 true。
- 正式入口不保留可见浏览器模式或自动回退。CLI、MCP 和 DSH 调用同一 FlightTool。

## 最终本地验收

- 最终版本 `npm run build` 通过，`npm test` 14/14 通过。除前述范围外，新增 HTTP 430 分类、美元不能误解析 HK$、重复候选防误归属校验。
- MCP stdio：工具发现与错误返回通过，`artifacts/verification/mcp-smoke.json`。这次协议 smoke 不发起新航班搜索。
- DSH：在本机真实 Cordis / tools / mcp-client 注册两个工具，错误调用和保存的详情快照读取均通过，`artifacts/verification/dsh-snapshot-smoke.json`。快照保留原始查询时间和 stale 标记，不伪装成新报价。
- 中途取消：3,644 ms 返回 cancelled，剩余浏览器上下文为 0，`artifacts/verification/cancel-smoke.json`。

## 外部阻塞与证据分母

在已成功的 CLI 查询之后，CNY 和 USD 的后续实时搜索均遇到航班接口 HTTP 430。页面可能把这种接口拒绝显示为“无航班”。工具已增加响应状态观察：HTTP 401/403/429/430 返回 ACCESS_RESTRICTED / needs_user_action，retryable false，不换模式或继续自动搜索。每次尝试保存脱敏的接口路径、HTTP 状态与时间。

- 当前 **DSH 实时新取价验收未通过**，原因是 Trip.com 返回 HTTP 430；工具注册、错误传递和读取既有真实查询详情已通过。原始失败记录保留在 `artifacts/verification/dsh-smoke.json`；其中 error.message 包含站点拒绝访问的 JSON。早期测试脚本还把 DSH 加上的 Error: 前缀当作普通 JSON 解析，后来已修正诊断脚本，未据此宣称取价成功。
- CLI 的完整成功记录对应北京时间 10:09:30 的运行；其后增加了 HTTP 430 识别、币种前缀与候选去重防护、默认 USD。最终代码通过编译和离线回归；因站点限制，没有把旧的 CLI 成功冒充为最终代码的新一次远程成功。
- 因此不能把当前交付描述为“长期稳定无人值守”或“DSH 实时取价已全部通过”。没有尝试代理轮换、验证码自动处理或修改用户日常 DSH 配置。

## 无界面研究边界

默认 HeadlessChrome 标识的早期调用返回 whaleguard block。规范化 User-Agent 的首次探测使用 LIS 机场过滤，页面显示零航班；第二次使用里斯本城市“所有机场”搜索，完整返回候选和详情。两次探测不构成单变量因果证明，不能据此断言某一参数是唯一根因；它们证明存在能完成此案例的无界面路径。

未验证：全球任意机场的真实网页查询、往返、儿童/婴儿、多人、长期无人值守成功率、结算价格、真实下单、模型自然语言决策质量。全球 IATA 目录解析的单独验证见下文；DSH 集成 smoke 为真实工具链调用，不等于已经运行用户日常会话或模型决策验收。

### 全球目录（2026-10-19）

日历修复回归新增：恢复未来月份后向前翻、跨年前后翻月、第二个可见月直接选日、禁用翻页边界、父 gridcell 禁用日期以及取消。测试使用本地受控页面，最终39/39通过，typecheck、build、MCP协议smoke通过。
日历 fixture 以独立原生 JavaScript 加载，避免测试转译器的函数命名辅助变量进入浏览器上下文。

修复后正式CLI实测：searchId `019231e6-f02d-4dfc-b8f6-65841f645697`，BJS→PRG / 2026-10-28 / CNY / maxResults1，attempts1 / complete / exit0，接口返回25条，2026-10-19 15:06:44（UTC+8）观察。最低候选2150元，PKX→CKG→LHR，换LTN→PRG，39h35m；完整3航段和详情取得，显示需自行转机、换机场且无手提/托运行李，不作为自动推荐。结果保存于仓库根忽略目录 `output/airport-prague-cli-calendar-fixed.json` 与对应artifacts目录；搜索报价未结算核价，未调用模型API。

新离线目录覆盖 7,884 个 IATA 机场、233 个国家/地区和上游 41 个多机场城市组；保留原城市聚合。33/33 测试通过，包含全部 IATA 与时区、显式别名、PRG 机场选择及名称歧义。typecheck、build 和 MCP protocol smoke 通过。一次 BJS→PRG / 2026-10-28 的真实 CLI 已通过地点选择，随后在日历禁用的下一月按钮返回 PAGE_CHANGED / attempts1；没有真实报价。详情和来源见仓库根 `docs/AIRPORT_LOCATIONS.md`。

## 用户五候选 CLI 失败后的程序修复

用户失败 searchId：`3cc9742c-13bb-4a7f-affb-9ea9e10b8b87`，参数为 BJS → LIS / 2026-10-28 / USD / maxResults 5。这次搜索和详情接口均记录为 HTTP 200，页面后来显示 0 flights；没有证据把这次失败归因于 HTTP 430。

已完成并重新编译的修复：

1. 搜索就绪条件改为等待本次完整流式响应结束，校验业务 retCode 为 SUCCESS、结果数量有效，并等待相关响应收尾。不再在首批 DOM 出现时立即排序。
2. 只定位 role=tab、名称 Cheapest 的排序标签，校验 aria-selected，已选中时不重复点击。整页同名的 Cheapest 航班徽标不会成为操作目标。
3. 排序后暂时显示空列表会继续等待到渲染截止时间，不再立即抛 RESULTS_CHANGED。
4. 成功接口返回正数航班但页面显示无结果时，不发布 no_results；持续不一致返回 PAGE_RENDER_INCONSISTENT。

验证：最新编译通过，本地回归 **19/19** 通过。新增真实本地浏览器用例覆盖临时空渲染恢复、同文案徽标、已选中标签不重复点击、完整响应就绪和接口/页面结果冲突。网络用例被 Playwright route 完全拦截在本地，不属于真实站点成功记录。

真实五候选复测在前一轮等待修复后遇到 HTTP 430（searchId `da60375e-fce5-4ca5-ad0e-9b7892efd611`），未取得五候选成功结果。当前完整修复版等待用户再次测试，不宣称已稳定通过。

## 同一页面再次点击 Search 的有限恢复测试

2026-10-19 按用户观察加入最小恢复策略：仅首次 FlightListSearchSSE HTTP 430、无明确拦截提示且有剩余预算时，在原页面等待 2 秒后再点击 Search。保留页面和浏览器上下文，不调用 reload。该次提交计入最多两次的总尝试预算；第二次失败停止，401/403/429 和人机验证提示不执行恢复。

最新编译通过，**24/24 本地测试通过**。新增用例覆盖同页 430→200、430→430 最多两次、禁止重试的状态码、人机验证提示以及耗尽预算。模拟响应通过不代表真实站点恢复成功。

仅进行一次真实 CLI 查询：BJS → LIS / 2026-10-28 / USD / maxResults 5，无界面 Chrome，searchId `3bc61eba-f26e-4f31-95b2-09e0deefdcb3`。北京时间 10:43:50.985 首次返回 430；保留页面再点击 Search 后，10:44:02.352 第二次仍返回 430。最终 needs_user_action / ACCESS_RESTRICTED / attempts 2，CLI exit 1，没有继续请求。

证据：该 searchId 目录内 attempt-1-network.json、attempt-2-network.json、same-page-retry.json、两次错误文字及截图。本轮未取得真实航班结果，仍未通过稳定性验收，也未重新打包。

## 邮箱登录与持久化会话复测

用户在工具专用窗口手动使用邮箱登录 Trip.com，并明确告知已完成。程序保存仅限 Trip.com 域的会话状态，没有读取或记录密码。

- 同一登录窗口查询：searchId `166243a2-8e76-4b8b-a8e4-7b48f482c92c`；北京时间 10:58:48 航班搜索接口 HTTP 200 / SUCCESS / recordCount 25；status complete / attempts 1；提取 5 条候选及全部详情。
- 关闭登录浏览器后，新进程正式 CLI 自动加载 `.auth/trip.json`：searchId `6cccb631-5e2c-497a-bf3f-aee2f1836c24`；北京时间 10:59:57 接口 HTTP 200 / SUCCESS / recordCount 25；status complete / attempts 1，退出码 0；5 条候选详情全部取得。此次通过环境变量限制为一次提交，没有重试。
- 两次查询均为 BJS → LIS / 2026-10-28 / USD / maxResults 5；候选价格均为 319、320、378、380、380 美元。
- 最新编译通过，25/25 本地测试通过。新增测试以拦截响应验证会话跨上下文保存、恢复及 Google 域数据排除，不是额外真实站点查询。

证据：`artifacts/verification/login-query-smoke.json`、`artifacts/persisted-session-cli.json` 和两个 searchId 下的请求记录、结构化结果及详情证据。登录状态文件不纳入报告或打包。两次成功尚不足以证明长期稳定，也不能据此证明登录是此前 430 的唯一原因。

## 巴黎目的地残留修复与正式 CLI 复测

2026-10-19 发现保存的浏览器状态恢复 Lisbon 标签，旧 fill PAR 操作只会追加 Paris。提交跳入 `flights/explore`，`acity=lis|par`，随后等待 showfarefirst 超时；不是无报价或已证实的登录失效。修复在每个地点控件内删除历史标签、选择唯一地点，并处理主表单/弹层重复 testId；不删除登录信息或绕过站点访问限制。

修复后 searchId `7058854c-4bef-485c-b17b-ce0a25cc8b9a`，北京时间13:13:27取得 BJS→PAR / 2026-11-14 / CNY / 5候选：2442、2452、2484、2490、2530元；HTTP200 / SUCCESS / 99条，attempts1，complete，exit0，详情全部取得。最低候选总32h50，两次中转并在伦敦换机场；5项均两次中转，不能当作满足最多一次中转的推荐。完整快照/截图/接口状态在对应 artifacts 目录，均为搜索报价，未结算核价。

回程 searchId `9b4cf412-d1c0-4582-8e76-8747ecc9626d`，北京时间13:14:38取得 PAR→BJS / 2026-11-19 / CNY；92条中取5项及全部详情，attempts1 / complete / exit0。价格2613、2633、2789、2789、2789元；前两项11月21日到京。第三项海航HU7908+HU7138，巴黎19日12:30起飞，经西安4h30、北京20日12:30抵达，总17h，无换机场，7kg手提/23kg托运且显示需重托。使用同一保存会话，无需重新登录；两次新路线成功仍不代表长期稳定。
