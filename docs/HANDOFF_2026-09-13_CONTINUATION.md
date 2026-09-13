# 2026-09-13 续作交接

本记录接续 [生产集成交接](HANDOFF_2026-09-13_PRODUCTION_INTEGRATION.md)，
工作目录仍为 `.worktrees/production-integration`，分支 `codex/production-integration`。
主仓和其他工作区未改；本轮源码、测试与文档统一保存在该集成分支，尚未合并主仓。保留 `._*`、依赖联接及被忽略账本。

## 已完成

- 日期一致性：共享 `trips/dates.ts` 校验完整 merged snapshot，创建/更新冲突返回
  `TRIP_DATES_INCONSISTENT`，不写入也不增加版本。精确窗口不能承载整个旅程区间；
  天数包含首尾两日。固定日期可推导规划/验证天数，弹性日期按可行区间计算研究覆盖。
  历史冲突可读但不能生成新研究、日程或满足攻略交付。详见 ADR 0017。
- Goal attempt：轮次结束关闭本 generation 的残留 running attempt；Goal/已有证据
  保持可恢复。取消、迟到创建、并发 revision 和有界清理均有回归；后台任务独立。
- 原生研究 HTTP 失败：专用单次 transport 保留限长且脱敏的 status/body/允许 headers，
  审计可独立解释 429/5xx。未知费用保留 reservation，不从错误响应猜费用为零。
- 测试配置：默认离线与 6 个 PostgreSQL suites 明确分开，固定无凭证测试配置；
  缺 TEST_DATABASE_URL 的数据库命令明确失败。preview/Taro 全局声明及适配器类型已修。
- 本地 launcher 移除跨会话累计 30 次的计数门槛；仍保留用户已授权的第二轮 $5、
  单次预留、请求体/token 限制和 Runtime 每轮上限，旧费用及未知预留均未重置。

## 本轮真实本地验收

浏览器打开原攻略 → 返回该 Trip 的规划记录 → 修改想法并提交自然语言 →
真实 DeepSeek Planner + Qwen 原生研究 → 新 immutable guide → GET 恢复及网页刷新成功。
未预置新攻略、未伪造登录、未调用机票或微信 code 交换。

- Trip 仍为 `01a09762-033d-711a-ab6f-85adc017966a`，当前 version **2**。
- 实际数据库确认 departure exact **2026-10-12**、return exact **2026-10-13**、
  travelDays **2**。旧 version 1 的错误实际是 departure exact 12–13、return exact 14；
  不是 UI 格式化导致，历史版本保留。
- 新 guide：`01a09791-b36b-763d-8bc5-8edacc20cbf2`，每天活动数 `[1,1]`，
  新 Run `satisfied`，保留部分核验提示。旧 guide `01a09771-4451-718e-a88a-2bf856069741`
  仍在原版本，未覆盖。
- 对当前 Trip 发起冲突天数更新，真实 HTTP 返回 **409**，版本保持 2。
- [本地新攻略](http://127.0.0.1:4179/live.html#/pages/route/index?artifactId=01a09791-b36b-763d-8bc5-8edacc20cbf2)
  刷新仍显示 **10 月 12–13 日 / 2 天**。
- 证据：`backend/.demo/continuation-evidence.json`、`verify-continuation.mjs`，
  以及原第二轮 ledger/receipts。验证脚本不保存或输出 access/refresh token。
- 本轮新增 11 次请求，已知费用 **$0.017644926**。第二轮累计 30 次，已知
  **$0.051765610**，未知预留 **$0.50**，准入 **$0.551765610 / $5**。
  native DB ledger 与外层 ledger 是同批费用的不同控制层，不能相加。

## 自动验证及范围

- 修复测试环境后的完整后端离线测试：**88 files / 614 tests** 全通过。
- 独立 PostgreSQL：**6 suites / 31 tests**；root tests **323 checks**。
- backend check/build、root/preview/Taro typecheck、真实 `build:weapp:local` 均通过；
  构建只有既有资源大小与分包建议。日志与命令见
  `backend/.demo/verification-2026-09-13.md`。
- 原历史 collection 卡顿根因未完全证实；此次显式配置的全量运行完成，不能仅归因于 `.demo`。
- 全量之后审查补入的日期覆盖/跨 generation 边界采用定向回归，最终结果补记于下方。

最终补充回归：日期/规划/攻略 **5 suites / 79 tests**，runtime/Goal tools/cloud
**49 tests** 均通过，backend check/build 再次通过。最后一轮日期 fork worker
曾无输出停滞，已结束该进程；相同 5 文件切换 `--pool=threads --maxWorkers=1`
约 4.6 秒全通过。88/614 是补充审查前的完整通过记录，不冒充最后新增测试的总数。
外代 running Run 的 resume/declare 激活返回 `GOAL_RUN_ALREADY_RUNNING` / 409，
不会被本轮 cleanup 误关；历史回收仍是独立后续任务。

## 后续边界

- 首轮失败 Goal/Run 在后续对话中已取消，`continuation-evidence.json` 的实际状态为
  `cancelled`，不能继续标为 running。通用的崩溃恢复/遗留 attempt 收尾仍需另做，
  必须依据 liveness 判断，不能直接把外代正在运行的 Run 当作自己的。
- 通用对话取消 UI、取消/换账号的真实浏览器闭环、真微信登录、真机地图/键盘/安全区
  尚未验收。现有自动化取消/owner 隔离测试不等于上述设备验收。
- 内容仍含部分核验、开放时间/票价/照片/坐标未知状态；人数没有结构化字段，仍待确认。
  固定日期覆盖及并发补丁有离线证据，未为此重复发起付费研究。
- 本地服务保留：PG **15432**、API **3011**、Vite **4179**；启动配置与目录见上次交接。
  本轮先本地，不要求用户配置 HTTPS。下一步如需提交，先审查 integration diff，
  不暂存 `.demo`、环境文件、AppleDouble 或其他工作区。
