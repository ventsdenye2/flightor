# 全球机场地点目录

更新：2026-10-19。所属能力：trip-flight-tool 地点解析与 DSH 航班工具输入。

原手工地点表遗漏 PRG，导致北京到布拉格请求在本地以 LOCATION_NOT_SUPPORTED、attempts=0 失败，尚未进入 Trip.com。此次接入 MIT 许可的 mborsetti/airportsdata 全球 IATA 机场快照；保留原城市聚合与中文名称，扩展机场、英文名称、ICAO 和唯一城市名称解析。数据和 IANA 时区随 CLI 离线打包，不在查询时下载。

来源、获取时间、源文件 SHA256、条目数及国家地区数保存在 src/core/data/airports.json 的 metadata 中，原始许可证随快照保留。更新脚本使用 csv-parse 解析标准 CSV，校验重复 IATA、必填字段、时区及异常小的数据集，再生成目录。
更新器支持本地 CSV、城市表和许可证输入。城市表的国家代码若与机场主表冲突，采用主表并在 metadata.sourceCorrections 记录修正，避免把上游误标国家直接带入目录。
同码机场如果被上游城市表漏掉（此次 JNB），在国家和时区一致时补回聚合。名称与 ICAO 撞名时（Kobe/KOBE），全大写四位输入优先按明确 ICAO 处理，普通名称优先按城市或机场名称处理。

同名城市或机场必须指定 IATA 代码；国家/地区不能自动替代某一个机场。机场目录有记录不代表 Trip.com 当前有航线、库存或能成功加载报价。无 IATA 机场、停用机场和上游未记录的地点不保证覆盖。真实网页和报价验收单独记录，不把解析成功冒充查询成功。

解析实现：保留原城市聚合，同时接入上游 41 个多机场城市；代码优先，名称去重音并忽略大小写和空白。IATA、ICAO、机场全名、唯一英文城市名及人工中文别名使用内存索引。机场特定名称（如上海虹桥、成都双流）保留 airport 类型，避免误选全城机场。机场+城市主目录共有 7,906 个唯一代码，主目录含 417 个显式别名，另有同码机场特定别名。中文名称没有穷尽，未命中时可用全球 IATA 代码。

新增回归覆盖：全部 IATA 代码与时区、全球代表机场、原有和导入城市聚合、全部中文别名、PRG 名称与 ICAO、同名 Cambridge 提示和 PRG 网页选择控件。别名使用快照当前的 BSZ（比什凯克）和 KTI（金边德崇），不沿用已不在主表中的 FRU、PNH。

## 数据维护

快照固定于上游提交 `47ae282a8491758e6dafe28d4139539e561b54d5`，MIT 许可证与原始归属在 `trip-flight-tool/src/core/data/AIRPORTS-LICENSE.txt`。`npm --prefix trip-flight-tool run data:update` 生成目录；`-- --ref <commit>` 明确选择新版本。脚本也接受本地 `--csv`、`--macs`、`--license`；需保证来自声明的同一提交。新增中文名称编辑 `src/core/location-aliases.ts`，不用手改生成 JSON。

生成后执行 typecheck、test、build；构建会复制 JSON 到 dist。许可证随 src 纳入 package files。后端每次调用新 CLI 子进程，重新构建即生效；长驻 MCP 进程需重启。

## 2026-10-19 验证

日历故障后续修复：真实页面打开时恢复 `2026-11-19`，显示 November/December 2026；查询 `2026-10-28` 需要向前翻月。旧实现只会下一月，最终翻到 September/October 2027 边界。现按可见年月判断前后方向，避免等待已禁用按钮；修复后的成功验收见下文。

- `npm --prefix trip-flight-tool run typecheck`、`npm --prefix trip-flight-tool run build` 通过，编译后的 Node CLI 已读取全球目录。
- `npm --prefix trip-flight-tool test`：33/33 通过，包含全部 7,884 个 IATA 代码和有效时区，全部显式别名、城市聚合及本地网页控件测试。
- `npm --prefix trip-flight-tool run smoke:mcp`：protocol PASS；未调用付费模型。
- 一次真实 CLI：`BJS -> PRG / 2026-10-28 / CNY / maxResults 1`，单次预算 90 秒、单步 15 秒、最多 1 次。地点选择通过后，原有日期选择代码点击 aria-disabled=true 的 Go to next month，返回 PAGE_CHANGED / attempts 1；没有获得报价，不是 LOCATION_NOT_SUPPORTED，也不能据此说没有航班或登录失效。证据 searchId `f845e72b-5a63-41fc-8ae1-97347b247ae4`，结果在忽略的 `output/airport-prague-cli.json`。日历逻辑不在本次地点目录变更中修改。

## 日历修复后验收（2026-10-19）

正式 CLI 同条件 `BJS -> PRG / 2026-10-28 / CNY / maxResults 1` 一次成功（attempts 1 / complete / exit 0），searchId `019231e6-f02d-4dfc-b8f6-65841f645697`。2026-10-19 15:06:44（UTC+8）观察到25条结果，按最低价排序后提取1项及全部详情：2150元/成人，PKX 10月28日07:45→PRG 10月29日16:20，总39小时35分，JD5755→GS7965→W92602，经重庆、伦敦两次中转；伦敦LHR→LTN换机场并需自行转机，页面显示手提及托运行李均不包含。这是搜索报价，未结算核价，不自动选为行程方案。

原始结果在忽略的 `output/airport-prague-cli-calendar-fixed.json` 与对应 artifacts/searchId 目录。现有登录状态即可完成；此次结果证明修复后的查询路径可用，不代表长期成功率。后端每次启动独立CLI，已构建的修复下次调用即生效。

最终验证：39/39测试通过（原33项加6项日历回归），typecheck、build与MCP protocol smoke通过；未调用付费模型。
