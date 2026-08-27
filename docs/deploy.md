# FlightOR 部署清单

上线前收尾项逐项核对。当前状态（2026-08）：本地开发全链路可用，云函数代码已就绪但**未上传部署**。

## 1. 密钥管理（已完成 ✅，上架前有安全项）

- `openrouter.txt` / `serpapi.txt` 放项目根目录（gitignored），构建时经 `config/index.js` 注入为 `OPENROUTER_KEY` / `SERPAPI_KEY` 编译期常量
- 各服务降级链已就位：无 key 时 LLM 解析回退本地规则、价格回退估算价/mock
- ⚠️ **前端注入 key 会明文打进小程序包（已验证 dist 内可 grep 到），可被反编译提取**。上架前必须：删除本地 key 文件重新构建（常量置空走云函数路径），密钥只配在云函数环境变量里

## 2. 云开发环境（待办 ⬜）

1. 微信开发者工具 → 云开发控制台 → 开通并选择环境（appid: `wxdf9ff3c30a1d9549`）
2. `project.config.json` 已配 `cloudfunctionRoot: "cloud/"`，开发者工具左侧应出现云函数目录树

## 3. 云函数上传（待办 ⬜）

按依赖逐个右键「上传并部署：云端安装依赖」：

| 云函数 | 必需环境变量 | 说明 |
|---|---|---|
| routePlanner | `OPENROUTER_API_KEY`、`SERPAPI_KEY` | 多城路线规划（action=plan/confirm），无 key 自动降级 |
| searchProxy | `SERPAPI_KEY`（或 `DUFFEL_TOKEN` + `SEARCH_PROVIDER=duffel`） | 单程搜索代理 |
| chatAgent | `OPENROUTER_API_KEY` | 单程需求对话 |
| tripAgent | `OPENROUTER_API_KEY` | AI 行程生成 |
| login / priceAlert / priceTrend | 无 | 登录建档 / 价格提醒 / 价格趋势 |

环境变量在云开发控制台 → 函数 → 配置中设置。**key 放云端后，前端构建可不注入 key，走云函数路径。**

## 4. 前端调用路径（已完成 ✅）

- `src/utils/cloud.ts`：wx.cloud 惰性初始化 + `callCloud`（失败返回 null）
- `routeService.planRoutes/confirmPicks`：云函数优先 → 失败降级本地直调（引擎同构）
- 云函数未上传时行为与现在一致，无破坏性

## 5. USE_MOCK 处理（说明，不改代码 ✅）

`USE_MOCK=true`（src/utils/request.ts）当前语义 = **无 key 时的演示兜底**：

- 航班搜索：有 SerpApi key → 真实报价（与 USE_MOCK 无关）；无 key → 本地仿真
- LLM 对话：有 OpenRouter key → 直连；无 key → 本地规则解析
- 云函数全部部署 + key 配置到云端后，可将 `USE_MOCK` 改 `false` 并移除本地兜底；当前阶段保留，保证开发者工具离线可演示

## 6. 合法域名（上线前必办 ⬜）

前端直连 OpenRouter / SerpApi 依赖开发工具「不校验合法域名」（urlCheck 已关）。正式上架前二选一：

- **方案 A（推荐）**：前端请求全部改走云函数（routePlanner 已就绪，chatService/flightService 同样改造），无需配置合法域名
- **方案 B**：在小程序后台配置 request 合法域名（要求对方域名备案/HTTPS 证书，OpenRouter 与 SerpApi 通常不满足）

## 7. 真机验证清单（待办 ⬜）

- [ ] 预览模式真机扫码，验证单程搜索（真实报价或 mock）
- [ ] 多城对话：输入「9月去欧洲，尽可能多去几个城市，必须去巴黎」→ 出路线卡
- [ ] 路线卡：展开航段明细、核实实时报价按钮（云端 key 或本地 key 均可）
- [ ] 中英文切换、暗色显示正常
- [ ] 云函数上传后回归：确认 plan/confirm 走云端路径（云开发日志可见调用）

## 8. 回归基线（持续 ✅）

| 脚本 | 断言数 | 覆盖 |
|---|---|---|
| scripts/test-route.js | 38 | 引擎解析/搜索/收敛/边界 |
| scripts/test-route-real.js | 13 + 3 实网 | 真实价格探测 |
| scripts/test-route-llm.js | 16 + 6 实网 | LLM 解析与降级 |
| scripts/test-route-cloud.js | 10 | 云函数 handler 协议 |
