# FlightOR 航班优先流程验收记录

验收日期：2026-09-14（Asia/Shanghai）  
正式分支：`main`  
任务依据：`docs/FLIGHT_FIRST_TASK.md`

## 结论

正式产品已跑通“输入需求 → 真实航班查询 → 多方案比较 → 查看详情 → 用户明确采用 → 服务端持久化 → 刷新恢复”的航班闭环。游玩攻略阶段没有跑通：两次完整研究过程均留下 `research` Artifact，但没有生成 `travel_guide`；最后一次提交在联网研究限流后直接失败，没有新增研究 Artifact。此结果不能记为完整端到端成功，也没有用 fixture 或旧攻略替代。

视频制作继续暂停。没有录制样片、添加音效、生成 BGM 或导出 MP4。

## 实际案例

- 查询：北京首都 `PEK` → 里斯本 `LIS`
- 日期：2026-10-02，单程，1 人，经济舱，`CNY`
- 供应商：SerpApi，真实航班查询 1 次
- 采集时间：2026-09-14 05:41:35 UTC
- 返回：11 个标准化报价；页面按同一结果本地切换综合、价格和时长排序
- 用户采用：阿联酋航空，`PEK → DXB → LIS`，`CNY 6,250`
- 总耗时：19 小时 15 分；DXB 中转 160 分钟
- 选择：服务端保存，选择修订 `1`；采用仅用于规划，不代表购票、锁价或转机保障
- 时间边界：供应商只提供当地钟面时间，机场时区投影不可用；正式卡片明确显示“当地时间 · 时区待确认”
- 中转安排：用户偏好允许在条件合适时考虑进城；160 分钟不足以形成可靠城市游玩窗口，本案例只保留机场内休息
- 目的地窗口：10 月 2 日 19:40 抵达后只入住，10 月 3 日至 5 日计划游玩；Trip `travelDays=4`

## 实际操作路径

1. 在正式“规划”入口输入航线、日期、人数、舱位、币种和比较偏好。
2. Planner 调用真实票价适配器，正式规划页直接显示航班候选入口。
3. 在“比较航班”查看 11 个报价，切换综合、价格、时长排序并展开航段。
4. 打开阿联酋航空报价详情；查看详情没有自动采用。
5. 点击“采用此航线，继续规划”，服务端校验 Artifact、offer 和 Trip 后保存选择修订 1。
6. 返回规划页查看固定“已选航班”摘要和免责声明。
7. 提交按已选全部航段规划游玩的请求；Planner 读取了选择引用、航段、抵达时间和中转窗口。
8. 联网研究阶段失败，页面显示“本次规划未完成”；没有生成或冒充成功攻略。
9. 刷新正式 H5 后，已选航班、选择修订和失败状态均从 workspace 恢复。

## 数据与回放

本地脱敏包：`backend/.demo/flight-first-acceptance/`

- `snapshot.json`：Trip、workspace、全部 Artifact、memory、11 个标准化报价、比较结果、采用引用、转机窗口和失败 delivery
- `manifest.json`：采集代码 SHA、dirty 状态、覆盖范围、内容字节数和 SHA-256
- UUID 使用一致的确定性伪名，引用关系已验证；认证字段、Cookie、密钥和 `bookingUrl` 已移除
- 供应商原始 HTTP body 在查询时没有持久化，manifest 明确记录 `rawProviderResponse=false`
- 快照哈希：`f799a77be19b355e2e350e37fa2baafda56185c0cff12cabb5a93f1c08e969ca`
- 捕获代码：`0eb86d09b32b3a76f4e85f415ce5ddf5567ed726`，捕获时工作区干净

严格回放服务：

```powershell
node backend/scripts/replay-flight-first-snapshot.mjs --snapshot=backend/.demo/flight-first-acceptance --port=3012
```

正式 UI 回放构建与查看：

```powershell
npm run build:h5:replay
$env:H5_PORT='10087'
$env:FLIGHTOR_H5_ROOT='dist-h5-replay'
npm run serve:h5
```

打开 `http://127.0.0.1:10087/#/pages/trips/index`，点击“登录与同步 → 本地测试登录 → 继续安排”。回放 UI 显示“真实查询快照”及采集时间。已验证 workspace 和 flight Artifact 请求返回 200；未知业务请求返回 `409 REPLAY_MISS`；health 显示 `liveProviders=disabled`，没有 live fallback。

当前快照是在采用之后导出，没有保存确认前 workspace 和采用动作的原始 PATCH 响应。因此严格回放只验收“已采用结果及刷新恢复”，不能宣称可离线重演确认前后的完整状态变化。后续拍片前若需要完整采用动作回放，应重新捕获这两个缺失响应，不能自行拼造。

重新导出时，先从本地隔离配置加载 `LOCAL_LOGIN_KEY`，再执行：

```powershell
node backend/scripts/export-flight-first-snapshot.mjs --trip=<真实 Trip UUID> --api=http://127.0.0.1:3011 --out=backend/.demo/flight-first-acceptance
```

## 页面证据

- 正式入口，390×844：`output/playwright/flight-first/planner-mobile-390x844.png`
- 正式入口，1440×900：`output/playwright/flight-first/planner-desktop-1440x900.png`
- 真实 11 候选移动端：`output/playwright/flight-first/live-candidates-11-mobile.png`
- 刷新恢复已选航班：`output/playwright/flight-first/live-selected-flight-refresh-mobile.png`
- 严格回放恢复页：`output/playwright/flight-first/replay-selected-flight-mobile.png`

`output/` 和 `backend/.demo/` 都是本地验收目录，不进入 Git。

## 构建与测试

| 范围 | 结果 | 说明 |
| --- | --- | --- |
| 后端 TypeScript | 通过 | 正式后端检查通过 |
| 后端单元测试 | 通过 | 89 个文件，644 个测试 |
| PostgreSQL Artifact 原子写入 | 通过 | 4/4 |
| PostgreSQL Goal 持久化 | 通过 | 8/8 |
| PostgreSQL discovery suite | 未通过 | Vitest 模块收集阶段超时，没有执行 SQL 断言 |
| 航班时间展示测试 | 通过 | 8/8，包括未知时区移动端显示 |
| 正式 H5 构建 | 通过 | `dist-h5`，API `127.0.0.1:3011` |
| H5 Playwright | 通过 | 390×844 与 1440×900；无横向溢出、黑底或控制台错误 |
| 严格回放 H5 | 通过 | `dist-h5-replay`；登录、列表、恢复选择，控制台 0 错误 |
| 微信小程序构建 | 通过 | `dist`，API `127.0.0.1:3011` |
| 微信开发者工具模拟器 | 未验收 | 工具已安装，但其服务端口关闭，自动化 CLI 被拒绝 |
| 微信真机 | 未验收 | 本轮没有真机执行 |

微信自动 QA 第一次还发现 `miniprogram-automator` 未安装；已用 `--no-save --package-lock=false` 临时安装，不修改依赖清单。随后开发者工具仍因服务端口关闭而阻止模拟器自动化，所以不能把微信 build 成功写成模拟器成功。

## 真实调用与失败边界

- 航班供应商请求：1 次；没有为排序、刷新、截图或回放重复查询。
- 游玩规划 UI 提交记录：3 条。
- 完整研究 Artifact：2 条，每条 `queryCount=4`；分别保存 15 和 12 条 finding。
- 最新提交在联网研究限流后失败，没有新增研究 Artifact。
- `travel_guide` Artifact：0。
- 没有第三次完整研究重试，没有模型横评、订阅、购票、下单或支付。
- 供应商与模型的实际费用未由当前 API 返回，金额未知，不能估算为 0。

历史 workspace 保留真实返回，包含早期 Planner 的英文分析前缀和个别未经充分来源支持的描述。当前代码已在固定结构回复中移除英文分析前缀，并收紧转机、行李、票价和保障表述；历史记录与快照保持不改写，作为真实验收证据。

## main 提交

- `4f90bce` 蓝色主题与正式文案
- `4eea780` 保留正式 UI 并暂停视频工作
- `614dff7` 持久化用户确认的航班选择
- `292645f` 将航班候选和采用动作接入正式 Planner
- `ecb3948` 正式 H5 构建与 Playwright QA
- `0e70755` 解码详情参数并明确中转文案
- `98fe055` 允许兼容的已选报价跨偏好版本复用，并阻止旧任务覆盖
- `eb4bcdd` 脱敏快照与严格回放工具
- `0eb86d0` UUID v7 脱敏修复
- `a084365` 未知时区航班时间的移动端可读性修复
- `f8e0b98` 严格快照的独立 H5 回放与采集时间标识

录制相关 Demo Stage、视频工程和素材均保留，未合并进正式北京到里斯本数据链路。
