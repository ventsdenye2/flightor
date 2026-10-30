# 航班查询方式扩展验收

日期：2026-10-20，北京时间。当前分支backend-mvp，使用本机3000后端与4178 H5。实测为Trip.com查询报价，不进行预订或结算，不调用模型；保留既有登录状态，不绕过访问限制。

## 手动入口真实查询矩阵

覆盖4种地点组合×单程/往返，成人数1–9每档至少1次。不是9×8的72种人数/地点全笛卡尔积，也不是全球航线穷举。所有候选分别核对原生网址的机场过滤、日期、人数、币种、完整航段；往返核对两个方向和原生组合价，多人总价直接读取网站。

| 用例 | 条件 | 人数 | 耗时 | 最新结果 | runId |
| --- | --- | --- | --- | --- | --- |
| cc-one-1 | 北京 → Tokyo，2026-10-31 | 1 | 36秒 | complete / PASS | `9bd327aa-8406-4897-a2bc-9ead1ba6857b` |
| ca-one-2 | BJS → 羽田，2026-11-01 | 2 | 34秒 | complete / PASS | `8dc0d8f2-e69a-4555-953a-aca83974fa8d` |
| ac-one-3 | PVG → Lisbon，2026-10-30 | 3 | 33秒 | complete / PASS | `f0d938f7-3374-4d19-a051-c3504e5ea25c` |
| aa-one-4 | Beijing Capital International Airport → HND，2026-11-05 | 4 | 33秒 | complete / PASS | `d9c54f54-d707-4ada-af9e-242c2de09903` |
| cc-round-5 | Beijing → 东京，2026-11-07 / 2026-11-10 | 5 | 45秒 | complete / PASS | `944aa28f-b315-4659-a888-eed451cf5a94` |
| ca-round-6 | 上海 → HND，2026-11-12 / 2026-11-15 | 6 | 52秒 | complete / PASS | `c2bb01a2-1b25-4f15-86ad-64c38833f4d9` |
| ac-round-7 | PEK → TYO，2026-11-19 / 2026-11-22 | 7 | 43秒 | complete / PASS | `9c496ae8-3b66-4d3b-a7ae-862c261e3330` |
| aa-round-8 | PVG → 羽田，2026-11-26 / 2026-11-29 | 8 | 49秒 | complete / PASS | `acfae41d-c1a4-4145-b124-862d5f3f3d26` |
| same-day-round-9 | PEK → Shanghai Hongqiao International Airport，2026-11-06 / 2026-11-06 | 9 | 30秒 | complete / PASS | `eb3ca427-991c-462c-9afd-f6bbf4b279e5` |
| reset-one-1 | PVG → LIS，2026-10-30 | 1 | 31秒 | complete / PASS | `852b88fb-9527-4125-9197-82acc88341a3` |
| domestic-city-one-2 | 北京 → 上海，2026-11-08 | 2 | 26秒 | complete / PASS | `758b9c3d-5279-47b0-864f-13be3b0c2baa` |

首次国内同日往返失败run `aa7c37f9-41c8-46a9-9766-dcb4a289e31a`被保留，不计入通过。原因是国内页面/chinaflights和JSON FlightListSearch未被国际SSE观察器识别；修复后原条件30秒complete且仅1次尝试，再验证国内城市单程和切回国际单程。新回归56/56通过，工具构建通过；完整修复说明见 [FLIGHT_OPTIONS](FLIGHT_OPTIONS.md)。

## 输入、界面与取消

- 17种真实HTTP非法输入均400且无任务ID：缺地点、未知地点、城市与所属机场重合、无效/过去日期、单程多返程日期、往返缺返程或日期倒置、未知查询方式、人数0/10/小数/字符串、非经济舱、未知币种、未知字段。
- 320/390/1440真实浏览器+本地地点接口验证中英文/代码候选、机场全名的范围、交换、单程/往返日历、人数1/9边界及2人请求；航班结果模拟既有快照，错误/警告0，无横向溢出。
- 390模拟取消、访问受限、查询超时、网络失败、空结果、随后成功6种状态；每次只提交一次，失败/取消不生成候选，无未捕获页面异常。模拟无航班不算供应商真实零库存验收。
- 真实取消run `24fbc9eb-46ed-4441-83cc-56cb8ccfcbd9`：查询中再次提交409；确认已启动Chrome后DELETE，cancelled，约3.2秒含进程复查；本次拥有的12个CLI/Chrome进程均退出，无残留、无迟到候选。取消后run `1040ba75-680d-4aee-bfe3-6b0092a69fff`重新查票complete。

- 390日历实际点选通过同日往返、2026-12-31至2027-01-03跨年、切回单程后不发送旧返程日期（航班API模拟，断言真实POST载荷）。
- 16组真实H5地点接口通过中文、英文、大小写IATA及ICAO（含美/英/法/澳/南非/新西兰），虹桥SHA机场使用机场全名value，未被同码城市SHA吞并；无匹配输入返回空候选。

## 调用入口扩展


| 入口 | 条件 | 币种 / 人数 / 候选数 | 结果 / searchId |
| --- | --- | --- | --- |
| CLI | JFK → LHR，2026-12-31 | USD / 1 / 5 | complete，`3f262546-5e64-4fc2-85be-362cf954e0fd` |
| MCP stdio | LHR → JFK，2026-12-05 | EUR / 1 / 2 | complete，`b576d81e-bade-4aba-a2b6-65f1e0d76513` |
| MCP stdio | HKG → TYO，2026-11-05 | HKD / 1 / 4 | complete，`a6352aee-f591-4150-9112-cb490873b6e0` |
| MCP stdio | PVG → HND，2026-12-31 / 2027-01-03 | SGD / 2 / 1 | complete，`027cc4d9-d337-4e9a-9222-f94774a286c5` |
| 后端DSH ToolRuntime | London ⇄ Paris，2026-11-10 / 11-15 | GBP / 2 / 3 | complete，`89862f74-4539-4831-9994-d5621a9d5dc2` |

手动入口11个用例、取消后重查1个、CLI/MCP四个、DSH一个，共17个真实查询用例最终均complete。原国内用例首轮失败不删除、不计PASS；它在修复后独立复验通过，不能把本轮说成从未失败。CNY/USD/EUR/GBP/HKD/SGD全部实测，maxResults 1/2/3/4/5全部实测；后端手动入口固定3个候选，不把CLI可调数量冒称前端可调。

MCP三项查询在同一stdio客户端中顺序执行，并分别调用get_flight_details；CLI验证有效详情snapshot及错误candidateId的CANDIDATE_NOT_FOUND，未重新搜索；DSH通过实际SDK ToolRuntime调用后端注册的search_flights与get_flight_details，密集JSON输出被真实运行时接受。均不调用模型，因此未验证模型根据自然语言选参、缺日期追问或交通确认后才规划的语义行为。

新币跨年往返（12/31去、2027/01/03返）每人显示628、原生2人总价1255，工具如实保留网站舍入后的总价，未以人数乘单价伪造总价。


机器报告及完整快照保留在当前Codex visualization目录：query-methods-matrix.json、matrix-input-errors.json、flight-pickers-adults-qa.json、matrix-ui-states.json、matrix-cancellation.json。每个真实用例另存完整run或工具快照；仓库backend/data与trip-flight-tool/artifacts保留原始成功和失败。不发布私有会话、原始响应令牌或本地证据字段到产品页面。

## 验收边界

国内JSON修复后工具56项回归、工具构建通过；页面表单、状态与日期边界均重新实测。未修改前端源码，本批不重复上轮已通过的H5/微信构建，也未做微信真机。无航班状态及失败状态有本地模拟和协议回归，不冒充真实供应商零库存查询。全球离线目录与代表性跨洲/地区输入不等于穷举全球所有机场、日期或所有72种人数×地点×类型组合；仍不承诺供应商网络、访问限制和未来页面变化下的100%成功率。往返覆盖仍为首个最低起价去程分支对应返程，未穷尽所有去程组合。
