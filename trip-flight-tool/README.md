# 单程与原生往返查询（2026-10-20）

新增 `tripType: one_way | round_trip`（默认单程），往返必须传 `departureDate` 和 `returnDate`。

国内chinaflights页面的JSON FlightListSearch和国际SSE均读取真实业务状态及结果数量，国内轮询须到最终完成；来源链接保留正确页面路径。城市/机场×单程/往返、人数1–9、币种及调用入口扩展测试见 [验收矩阵](../docs/FLIGHT_QUERY_ACCEPTANCE.md)。

```powershell
node dist/cli.js search --from BJS --to LIS --date 2026-10-31 --trip-type round_trip --return-date 2026-11-03 --currency CNY
```

通过 Trip.com 原生 Round-trip 两日期表单查询，选择首个最低起价去程作为分支，再读取对应返程的原生组合总价。每个候选含 outbound/return journeys；不分别查两张单程票再相加。最多提取 maxResults 个返程组合；coverage=selected_outbound_return_options，lowestPriceVerified=false，不代表全组合最便宜。详情变价时保留提醒并采用详情稳定价，真实混合舱位在分段 cabin 显示。未选择候选不代表交通已确认。详见 [FlightOR 合同](../docs/FLIGHT_OPTIONS.md)。下文单程限制为旧版记录，往返能力以本节为准。

# Trip Flight Tool

用无界面 Google Chrome 自动查询 Trip.com 单程航班，为 DSH 和其他 Agent 提供 MCP 工具。查询会执行首页表单、选择最低价排序、展开票价详情，并保存 JSON、页面文字和截图。正常查询不弹出浏览器窗口，也不需要手动点击。

## 环境与安装

- Node.js 22 或以上。
- 本机安装 Google Chrome。程序使用 Playwright 的 `channel: chrome`，无需另下载 Chromium。
- 能正常访问 Trip.com 的网络环境。

```powershell
cd D:\FunnyProject\trip-flight-tool
npm ci
npm run build
```

## 命令行查询

```powershell
node dist/cli.js search --from BJS --to LIS --date 2026-10-28 --currency USD --max-results 3
```

也可以从任意目录执行：

```powershell
D:\FunnyProject\trip-flight-tool\trip-flight.cmd search --from 北京 --to 里斯本 --date 2026-10-28 --currency CNY --output result.json
```

`stdout` 为 JSON；`--output` 可以同时保存到指定文件。默认币种 USD，与本次成功样本一致；默认返回 3 个候选，最多 5 个。日期必须带年份，使用出发地当地日期。可显式指定 CNY 等支持币种，程序不会偷偷换币种。

```powershell
node dist/cli.js locations
node dist/cli.js details --search-id <searchId> --candidate-id <candidateId>
```

退出码：0 为完整查询或页面明确无结果；2 为部分结果；1 为错误、访问限制或取消。无结果应读取 `status: no_results`，不能只看退出码。默认查询返回摘要（`resultLevel=summary`、`detailsState=deferred`）；`details` 对未读取详情的候选重新定位并核对列表/抽屉票价，只读取这一条。已读取详情默认返回快照，超过5分钟标为`stale`；`details --refresh`强制重新核对，`search --with-details`保留原完整提取供对照。票价变化须重新查询，不保证结算价。

当前默认直达结果页，普通失败回退原生首页表单，访问限制或验证码停止；`TRIP_FLIGHT_DIRECT_RESULTS=0`可关闭。国内CN航线使用chinaflights，往返原生ShowFareNext也保留校验。API和MCP常驻进程保留当前查询页，详情和选择核价直接打开对应抽屉，5分钟后或页面失效才恢复查询；不会对查询报价做短时结果缓存。API的工具直接连接本机认证Worker；有`TRIP_FLIGHT_WORKER_URL/TOKEN`的CLI也复用该Worker，无Worker的独立CLI在退出时关闭浏览器，随后details需要恢复查询。令牌仅在进程环境传递，不输出/保存。默认列表/详情/网络稳定窗口为300/300/100ms，分别可用`TRIP_FLIGHT_LIST_QUIET_MS/FARE_QUIET_MS/NETWORK_QUIET_MS`覆盖；请求发出时即计入pending，仍须最终业务成功、DOM不变和票价核对。

## DSH 接入

项目提供 `integrations/dsh/cordis.patch.yml`。本机 DSH 源码位于 `D:\FunnyProject\deepseek-harness`，使用 DSH 的 `--patch` 参数加载该文件；配置没有修改 DSH 源码或用户默认设置。

```powershell
cd D:\FunnyProject\deepseek-harness
pnpm dsh --profile headless --patch D:/FunnyProject/trip-flight-tool/integrations/dsh/cordis.patch.yml
```

这里的 DSH `headless` 指 DSH 的交互入口；本工具的 Chrome 也独立运行在无界面模式。

工具注册名称：

- `mcp__trip_flights__search_flights`
- `mcp__trip_flights__get_flight_details`

给 Agent 的示例任务：

> 用 trip_flights 查询 2026 年 10 月 28 日北京所有机场到里斯本，1 名成人经济舱单程，以美元返回最便宜的 3 个方案。说明最低价的航段、总时长、自行转机、换机场和行李条件。只使用工具返回的价格，不自行补全未知字段；如果站点返回访问限制，直接说明，不继续重复搜索。

DSH MCP 超时为 210 秒，工具内部查询预算为 180 秒。本机 DSH 的 timeout-policy 从每个工具的声明获取预算，没有统一 60 秒外层上限。若使用其他客户端，请把其工具调用超时设到 210 秒或更长。

其他 MCP 客户端可参考 `integrations/mcp.json`，或直接启动：

```powershell
node dist/mcp/server.js
```

MCP 服务通过 stdio 通信，日志不会写入协议 stdout。它只提供 tools，不依赖客户端读取 MCP resources。

## TypeScript / JavaScript API

```js
import { FlightTool } from './dist/index.js';
const flights = new FlightTool();
try {
  const result = await flights.searchFlights({
    origin: 'BJS', destination: 'LIS', departureDate: '2026-10-28',
    adults: 1, cabin: 'economy', currency: 'USD', maxResults: 3,
  }, { signal: new AbortController().signal });
  console.log(result);
} finally {
  await flights.close();
}
```

FlightOR 的 DSH 后端可以调用这个 API，再按自身工具注册接口包装。此项目不负责写入 FlightOR 的 Trip、Artifact、Goal 或完成状态。

## 结果与边界

- 支持指定日期、单程或原生往返、1–9名成人、经济舱；城市名查全部所属机场，机场名仅查具体机场。`--adults 2`按2名成人实际查询，报价为每成人，不能用单人查询乘人数替代。儿童/婴儿、多日期批量暂不支持。
- 地点目录包含 7,884 个 IATA 机场、233 个国家和地区，上游 41 个多机场城市组并保留成都等原有聚合。支持 IATA、ICAO、机场名称、唯一英文城市名、常见中文和繁体别名。布拉格可传 PRG、Prague、Praha、布拉格或 LKPR。同名地点返回候选代码；只指定国家/地区时仍需确定城市或机场。完整目录由 `locations` 命令显示，机场数据存在不代表有航线或报价。
- `lowestPriceVerified` 的范围是当次 Trip.com 返回的、按最低价排序的搜索结果。只提取所需的前几个候选，不声称覆盖其他渠道的全网最低价。
- `quoteType: search_quote`，价格为页面显示的单人报价，`checkoutVerified: false`。页面可能将小数价格四舍五入为整数；本工具保留页面显示口径。
- 每段起降时间保留当地日期时间和 IANA 时区。未知机场时区为 null。自行转机、行李和重新托运等字段只依据详情文本，未知值为 null。
- 所有候选都会尝试展开详情。详情缺失或发生候选变化会使结果变为 `partial`，并返回原因。
- 同一个实例同时仅运行一个查询，重叠调用返回 `BUSY`。不同安装 / 服务实例使用各自 artifact 目录。
- `get_flight_details` 按需读取单条详情；已取得详情默认读取保存的快照，需新报价时重新查询。

早期默认 HeadlessChrome 设置的测试返回了 Trip.com 拦截。本实现采用已成功样本的配置：从当前安装的 Chrome 读取 User-Agent，仅将其中的 HeadlessChrome 改为 Chrome，并使用正常首页搜索流程。没有代理轮换、验证码自动处理、第三方 stealth 插件或导入浏览器登录数据。实测可用不代表任何网络或未来页面版本都可用。

## 失败、取消与诊断

### 手动登录与持久化会话

运行 `node dist/cli.js login` 会打开专用 Chrome 窗口。手动完成 Trip.com 登录并回到 Trip.com 后，在终端按 Enter 保存。后续正常 `search` 命令保持无界面，并自动加载登录状态。没有登录状态文件时使用未登录会话。

2026-10-19 用户手动邮箱登录后，同窗口查询和关闭窗口后的新进程无界面 CLI 查询各成功一次，均首次返回 25 条航班并提取前 5 条完整详情，最低 USD 319。该记录仅证明此次会话复用路径成功，不证明长期成功率或登录是此前 430 的唯一原因。

默认保存到项目 `.auth/trip.json`，可通过 `TRIP_FLIGHT_SESSION_PATH` 指定。仅保存 Trip.com 域的 cookies、localStorage 和 IndexedDB，不保存 Google 域状态。目录已排除 Git，也不在 npm 打包白名单中。登录过期时重新运行 login。文件保存成功不等于服务端保证登录永久有效，也不证明能解决 430。

工具会检查航班接口的 HTTP 401/403/429/430；Trip.com 可能在接口拒绝后仍显示“无航班”。首次 `FlightListSearchSSE` 返回 430 且没有验证码或明确拦截提示时，若还有尝试预算，会保留原页面和会话，等待 2 秒后再点击一次 Search；不刷新、不创建新会话。第二次失败即停止。401/403/429 和明确的人机验证提示不执行这次重试。最终 `ACCESS_RESTRICTED` 返回 `needs_user_action`、`retryable: false`。检查截图、`attempt-*-network.json` 和 `same-page-retry.json` 可区分前后请求；这项恢复策略仍需真实查询验证。

网络短暂中断和结果加载超时最多尝试两次，且共享总预算。页面结构变化、错误参数、价格/航段不一致不会盲目重试。取消会关闭本次浏览器上下文，清理完成后才返回。

证据在 `artifacts/<searchId>/`：`result.json`、`search.txt`、`search.png`、各候选详情文字和截图；失败尝试有独立错误文件。它们是本地文件，远程 Agent 不能直接访问 Windows 路径，需要由宿主另行提供文件访问。完整页面 HTML、请求 headers 和 cookies 不作为常规证据保存。

环境变量：

| 名称 | 默认 | 含义 |
| --- | --- | --- |
| `TRIP_FLIGHT_ARTIFACT_DIR` | 项目内 artifacts | 结果目录；MCP 和 CLI 应使用相同目录以共享查询 ID |
| `TRIP_FLIGHT_TIMEOUT_MS` | 180000 | 一次查询总预算 |
| `TRIP_FLIGHT_STEP_TIMEOUT_MS` | 30000 | 页面单步等待预算 |
| `TRIP_FLIGHT_MAX_ATTEMPTS` | 2 | 最多 1 或 2 次尝试 |

## 机场目录维护

全球数据来自 MIT 许可的 mborsetti/airportsdata，按固定提交离线打包，查询不联网下载目录。来源、SHA256、条目数和修正在 `src/core/data/airports.json` 的 metadata；许可证在同目录。中文别名维护于 `src/core/location-aliases.ts`。全大写四位输入优先按 ICAO；例如 Kobe 是神户，KOBE 是美国 OBE 机场的 ICAO。

```powershell
npm run data:update
npm run typecheck
npm test
npm run build
```

默认更新仍使用固定上游提交；切换数据版本时传 `-- --ref <commit>`。离线输入可传 `--csv <airports.csv> --macs <iata_macs.csv> --license <LICENSE>`。生成后必须重新构建，后端下次启动 CLI 即读取新目录。已运行的长驻 MCP 进程需重启。

## 验证

```powershell
npm run build
npm test
npm run smoke:mcp
node scripts/cli-smoke.mjs
node scripts/mcp-smoke.mjs --live
node scripts/dsh-smoke.mjs --live
node scripts/dsh-smoke.mjs --snapshot
node scripts/cancel-smoke.mjs
```

带 `--live` 以及 CLI/cancel smoke 会启动浏览器并访问 Trip.com。`--snapshot` 通过 DSH 读取已有 CLI 查询详情，并保留 snapshot、ageSeconds、stale 字段，不刷新报价。`dsh-smoke` 使用本机 DSH 的真实 Cordis / tools / mcp-client 包，不调用模型 API；其他 DSH 安装可通过 `DSH_SOURCE_ROOT` 指定源码根目录。测试报告见 `artifacts/verification/`。验收说明见 `docs/ACCEPTANCE.md`。
