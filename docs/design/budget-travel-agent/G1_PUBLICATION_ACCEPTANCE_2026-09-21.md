# G1 发布合同 v1 验收收尾（2026-09-21）

基线：已 fetch 核对远端与本地 main 均为 `99f2ed77d8f8542fcfd0e5adfc5275a572fcfc10`。标准仍为 [冻结 P1–P6](G1_PUBLICATION_RUBRIC_V1.md)，不增加隐含门槛、不改变单 Planner 或现有 harness。本轮无付费请求；M1 尚未启动。

## 样本及两种读取语义

双入口来自 `g1-live-2026-09-20T15-21-51-390Z` 的原始攻略及 SQL 中匹配的 research/flight/route。去敏输入纳入 `backend/test/fixtures/g1-publication-v1-original-samples.json`；它是历史失败样本，不是新模型运行。原始账本、SQL、攻略文件未改写。

必须区分：

- **原记录直接恢复**：没有 publication，当前公开投影返回 legacy 有限提示。两例均保留两天及原时段，但去处退化为“已保存的活动（资料待核实）”，实用参考也退化。P5 失败，不能把这种输出计为新攻略成功；P6 允许这种显式旧版降级。
- **原材料经当前写入的独立副本**：在独立数据库使用既有 `saveWorkspaceArtifact` 写入新 Artifact，生成 publication，然后独立连接重读。它验证当前写入合同，不能宣称旧记录自动升级。
- **H5 固定结果回放**：使用正式构建/页面及相同公开投影，拦截只读 API，不运行模型；与 PostgreSQL 持久验证分别计层。

## 最小修正

来源名称支持无空格中文的逐字前缀；正文名称匹配先校验快照 hash。没有 claim 的条目保留首个安全来源最多 800 字的搜索摘要引文，注明 URL、记录时间、非正文及适用性未审查，并为该引用保存 SHA-256。已有无效或冲突 claim 不走摘要兜底。原始模型 summary/title 未匹配部分、theme、notes、planningNote 仍不公开。预算仍为 `undetermined / null / incomplete`。

这仅补来源绑定的名称/实用表达，不核实未来票价，不增加事实判定系统。细则见 [ADR 0024](../../adr/0024-guide-publication-contract.md)。

## 验证分层与耗时

| 层 | 最终证据 | 耗时与范围 |
| --- | --- | --- |
| 后端全量离线 | 100 文件、804 项通过 | 90.75s；随后增加正文名称 hash 防护及样本断言，最终代码覆盖见下行，不能写成最终 809 项全量重跑 |
| 最终后端定向 | 6 文件、105 项通过；更强的样本具体去处/饮食/交通断言再 4/4 | 7.59s / 1.29s；含 authored、runtime、history、公开 API/presentation、双样本 |
| TypeScript | backend build / check 通过 | 编译墙钟未单独保留；不是运行时证据 |
| 专用 PostgreSQL | 2 文件、4 项通过；双样本领域 validation=satisfied、预算守恒、独立连接公开结果相等，另有双入口 CloudPlanner/workspace 与外 owner 拒绝 | 7.58s；定向，未运行全部 DB suite |
| 前端离线定向 | production 28、reply 6、library 7、history 20、Artifact 25；dispatch 20、UI polish 18 | 前五组联合命令墙钟 8.67s；非前端 npm test 全量，后两组未单独记时 |
| H5 构建 | Webpack 成功 | 23.91s；与浏览器层分开 |
| H5 浏览器 | Chromium 390×844，当前副本两例；每例概览、D1/D2、4 详情、刷新后全文一致，0 控制台错误 | self 5.757s / 3.091s；selected 3.580s / 3.361s（首次显示并检查 / 刷新并检查） |
| H5 旧记录 | 两例有限显示及刷新一致 | self 3.634s / 2.984s；selected 3.596s / 2.781s；这是 P6 降级路径，不是 P5 通过 |
| 微信构建 | 成功，存在既有 CSS 顺序和体积警告 | 墙钟 23.947s；最终日志 `backend/.demo/g1-publication-weapp-final.log` |
| 微信离线组件 | 上述共享 Taro 组件/adapter 检查 | 不是微信渲染引擎证据 |
| 微信开发者工具 | 已补测两例当前副本详情及页面 reLaunch 恢复 | SDK 9432 已就绪；正式 Taro 页面、合成登录与只读 fixture 请求，非冷启动/真实 API。当前 self 18.107/13.898s，selected 17.206/18.618s；详见 H5/微信报告 |
| 微信/H5 真机 | 未测 | 未连接设备，不以桌面 Chromium 代替 |
| 新双例真实 Provider | 未测，仅 dry-run | 新增授权未获，原搜索额度已满 |

数据库阶段（毫秒，最终运行；迁移/建 schema 不在单例 setup 内）：

| 入口 | fixture setup | save | 领域 validation | 独立连接重读与投影 | workspace 恢复 |
| --- | ---: | ---: | ---: | ---: | ---: |
| self-ticket | 75.38 | 46.28 | 6.81 | 27.48 | 22.00 |
| selected-flight | 85.96 | 30.60 | 1.48 | 5.92 | 40.93 |

浏览器时间包含脚本操作/截图和显式等待，不是首屏 paint 或 M1 模型性能。API 只读拦截记录为 14 次 GET，包含刷新后的重新读取；没有真实登录/服务端网络端到端声明。完整文字及截图在 `output/playwright/g1-publication/report.json`，旧版在 `output/playwright/g1-publication-legacy/report.json`，运行方式见 [H5 报告](G1_PUBLICATION_H5_2026-09-21.md)。

## 用户可见结果与 P1–P6

下表为实际 H5 当前副本，来源原文保留为引文，不改写成已核实场所/运营事实：

| 入口 | 第一天 | 第二天 | 实用参考及预算 |
| --- | --- | --- | --- |
| self-ticket | 上午：列表标题仍为“资料标题：English”，打开详情可读到 `Senso-ji Temple`；下午食物来源引文明确列出 ramen / takoyaki | 上午标题“来源条目摘录：Meiji Jingu”；下午引文包含 Monjayaki / Fukagawa meshi | 来源 `Transportation in Tokyo` 的引文明确说明 subway / buses / waterbuses 可参考 IC card、travel pass 或单程票；1500 CNY 是目标，不能确认是否满足预算 |
| selected-flight | 下午“来源条目摘录：浅草寺”；晚上“来源条目摘录：藏前” | 上午“来源条目摘录：上野”，详情包含上野之森美术馆等；下午资料标题较宽泛，但详情明确竹下通和可丽饼 | 成田特快 N'EX 的来源引文包含成田机场至东京站/品川/涩谷/新宿；4000 CNY 是目标，不能确认是否满足预算 |

两例页面显示 2026-10-20 起、2 天。未提供返程信息时页头仍为“结束日期待确认”；不是新增返程承诺。已选航班为 PEK→NRT，显示原始 08:00 / 12:30 provider-local 时间（时区未知有明确标注），第一天没有上午活动。self-ticket 没有查询或添加航班。原英文材料、笼统资料标题的可读性仍有限；本轮 P5 依据实际可打开的具体引文及实用内容判断，不靠标题或未知提示计通过。

服务端成功回复两例均为：“已保存 2 天的安排。请查看结果卡片中的建议时段与来源资料；来源标题和摘录不代表已确认出行日适用。”随后说明原预算目标及“费用与人数口径尚未完整核实，目前不能确认总支出是否满足预算”。回复恢复由后端/前端离线测试及 CloudPlanner 数据库用例验证；此次 H5 只验行程详情，没有把消息列表浏览器验收一并宣称通过。

| 条款 | self-ticket 当前副本 | selected-flight 当前副本 | 原记录及范围限制 |
| --- | --- | --- | --- |
| P1 | 保存、领域 satisfied、独立恢复通过 | 同左；flight revision=1、绑定保留 | owner/context/取消为现有定向回归；新 Provider 未测 |
| P2 | 公开卡片/详情不含模型新事实与预算保证 | 同左 | 回复/历史由独立回归覆盖；H5 不是消息列表测试 |
| P3 | 明确搜索摘要、URL/时间/hash；不宣称未来适用 | 同左 | 错 quote/hash、冲突由对抗测试覆盖；搜索摘要不冒充正文 |
| P4 | 1500 CNY，undetermined/null/incomplete | 4000 CNY，同状态 | 未知不当零，不排除未知费用 |
| P5 | 通过最低有限参考范围；D1 去处在可打开详情中 | 通过；文化/小吃、下午抵达后时段及交通参考保留 | **原记录直接投影两例失败**：全部泛化占位，无实用内容；不得追认为新攻略成功 |
| P6 | 原始去敏审计输入保留，旧版有限恢复已测 | 同左 | 原始 SQL/攻略/账本未改；独立副本不是自动迁移 |

验收中保留的失败：数据库旧模型调用数断言期待 2 次而实际 1 次（已按已实施 shortcut 修正）；夹具曾未 schema parse 造成哈希降级、曾缺 Taro storage wrapper/完整 Artifact envelope、期望文字未归一空白等（均为验收脚本修正，不冒充产品故障）。一个坏 hash 测试最初在更早的研究 schema 边界被拒绝，后改为直接测试发布函数的坏快照防护。浏览器失败报告按时间留存；一次嵌套 Vitest/Chromium 启动静默卡住，核对本轮 PID 后停止并直接复跑成功。没有清理其他应用进程或重启 Docker。

复现：先 `npm --prefix backend run build`；离线样本用 `npm --prefix backend test -- src/travel-guides/publication-fixture.test.ts`；数据库先设置显式 `TEST_DATABASE_URL` 指向独立测试库，再 `npm --prefix backend run test:db -- src/travel-guides/publication-postgres.integration.test.ts src/workspaces/postgres.integration.test.ts`。各 suite 新建随机 schema 并清理；禁止指向旧 live 实验库。

## 固定双入口真实烟测准备

已执行原 runner 的 dry-run，未传 `--execute`。输入仍为 2026-10-20 至 21 东京文化与小吃：self-ticket 两天总预算 1500 CNY；selected-flight 4000 CNY、采用既有北京至东京航班、抵达前不安排活动。模型仍为 `deepseek/deepseek-v4-flash-0731`，OpenRouter 官方入口与 SerpApi 不变。

原账本目录：`backend/.demo/g1-live-2026-09-20T12-12-39-743Z`。SHA-256：`af9b37f56d2285599a4fe2f1b7163947ac0d974bcd50d36ebd4513bf1b035442`。累计模型 33/48、搜索 24/24，占用 US$1.233018（含未知搜索成本预留），剩余 US$0.766982；剩余搜索次数为 0。不得新建空账本绕过限额；没有新增授权就不能执行下一批。

下一次授权批次仍用 `backend/scripts/verify-g1-live.mjs`、两条原 prompt 及原账本；先记录明确新增次数/金额并保留累计计费，再执行。逐例记录 P1 保存/验收/恢复、P2 卡片和回复、P3 引文绑定、P4 预算、P5 每日去处时段及交通/饮食、P6 历史恢复；同时保存 setup、航班采用、接受、model/tool/http、首 Artifact、durable verified、最终回复、workspace restore 时间。两例各一次只是烟测，不是可靠率或模型横评。

## 放行范围

已关闭本次**离线发布合同、双入口独立数据库持久/领域复验、H5 固定结果详情显示/刷新、微信开发者工具固定结果详情显示/页面 reLaunch 恢复**的声明范围。G1 总门仍不关闭，M1 不启动。

剩余项只有：① 新授权下固定双入口真实烟测；② 将来若声明冷启动/真机范围则补该证据（本次微信仅页面 reLaunch）；③ 原记录 P5 仍失败，如需使其成为有用当前交付，只能沿现有保存边界从绑定来源重发新 Artifact，保留旧审计数据，不能恢复原模型散文或悄悄回填。本轮已验证该副本路径，不部署批量历史升级。不增加 critic、新 harness、模型横评或新的质量条款。
