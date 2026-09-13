# 路线研究与攻略生成 MVP 验收状态

> **2026-09-13 手动测试失败修复**：用户真实输入触发原生研究 HTTP 429，随后
> 到达工具步数上限。已补同轮冷却、原因透传与失败重试 UI；本地供应商仍可能限流。
> 诊断及本轮验证见 [限流修复记录](HANDOFF_2026-09-13_RATE_LIMIT.md)。

> **2026-09-13 本地集成续作**：同一真实测试 Trip 从详情返回规划后，已修正为
> 10 月 12–13 日/2 天，并生成新 immutable guide；旧版保留，API/网页刷新恢复成功。
> 日期冲突、attempt 收尾/并发、原生 HTTP 审计已补回归，后端全量与独立 PG 组、
> 前端测试/类型检查和真实 weapp 构建通过。具体数量、最后补充回归与限制见
> [续作交接](HANDOFF_2026-09-13_CONTINUATION.md)。微信/真机和通用取消仍未验收。
> 下文保留此前阶段证据。

更新时间：2026-09-08。当前 HEAD 为 `fb0a2db`；本轮改动未提交。

## 追加：300 秒 Planner 与临时执行状态

按 [ADR 0015](adr/0015-transient-planner-progress.md)，正式 Planner 整轮执行预算
由 150 秒改为 300 秒；外层任务 315 秒截止，客户端最多等待 330 秒，为超时回复和
结果落盘留出收尾时间。单次模型/Provider 上限保持独立，不代表每次调用都等待 300 秒。

小程序改为一次 `POST /v1/agent/turns` 提交，再用最长 10 秒的短 GET 每约 2 秒串行
查询；旧 `/v1/agent/converse` 继续调用同一服务并返回同一格式。阶段来自真实执行事件，
只暴露思考、更新条件、查询机票、研究、编排行程和整理结果，不包含模型推理文本。
临时状态按 owner 隔离，进程缓存容量 128，终态最多保留 10 分钟；重启后临时状态消失，
已持久化的消息、行程和 Artifact 仍可恢复。不会自动重新提交网络结果不确定的 POST。

Plan 显示旋转加载图标、当前活动和等待秒数；失败/超过 15 秒未确认心跳时显示
“正在确认连接”，保留上次已确认活动供参考。状态覆盖会话初始化与结果加载阶段，
不写入对话、Memory 或本地历史，结束/切会话/退出登录后清除。真实 MobX reaction
验证了阶段变化与清理会触发观察者。取消边界同时覆盖模型调用及 Goal working-set
同步，挂起读取恢复后不能在取消状态下发起后续写入。

验证结果（2026-09-08 21:35 左右）：

- 后端 5 个相关套件 33 项通过；独立 Node 严格 rejection/真实 localhost HTTP
  取消回归 5 项通过。使用模型/工具桩，不是新的真实 Provider 全链路验收。
- 客户端 Phase 5 / 轮询 / session recovery / Phase 6 共 115 项检查通过；前后端
  TypeScript、后端构建、保留本地登录的 weapp 构建、diff 检查通过。
- Playwright 使用真实 PlannerProgress 源组件、Plan 样式及 Taro View/Text DOM
  适配器，在 320/375/1024 宽度验证旋转、计时、真实阶段输入、断连/过期/恢复、
  完成卸载、减少动态效果及无溢出；console 无相关错误。这是受控组件验证，
  未操作微信开发者工具或真机，也未运行新的真实模型 300 秒样本。
- 最终 API 已启动，PID `260496`；`/health/live` 与 `/health/ready` 为 200，
  PostgreSQL 正常。真实 HTTP 验证新接口的认证、404/no-store、无效 scope 提交拒绝，
  并成功恢复原日本 Trip workspace；此验证没有写入行程或调用 Provider。

日志：`backend/.demo/api-planner-progress-20260908-213433.*.log`。小程序产物已更新，
微信开发者工具重新编译后可使用；后续可复跑：

```powershell
npm run test:conversation-progress
npm run test:phase5-client
npm --prefix backend test -- src/agent/cloud/turns.test.ts src/agent/runtime/runtime.test.ts src/routes/agent-cloud.test.ts src/routes/agent-turns.test.ts src/agent/cloud/service.test.ts --maxWorkers=1
npm run build:weapp:local
```

## 追加：航司联程进入路线比较

普通 SerpApi 航班搜索原本已经保留航司联程；此前 `LiveFareConnectionSearch`
只把直飞送入路线生成。现按 [ADR 0014](adr/0014-provider-connecting-fares.md)
把每份联程完整报价作为一个 edge，保留所有航段、总价和不可变 fare 引用。
路线规划、转机计数、机场排除、缓冲与价格复核都检查内部航段；未验证的
保护/行李信息不升级为事实。缺少全程时长的报价继续保存，未知等待不计为 0。

前端卡片和详情展示完整机场链及每次中转，不再重复第一个 hub。
Agent 的精确/弹性搜索摘要提供直飞/联程数量和各类最低价的完整路径。
旧 SerpApi 行李默认值在原始快照中保留，通过统一 presentation 标记为待确认。

20:35 的真实 SerpApi 样本（最终构建后 20:48 复核一致）为 SZX → LHR、2026-10-02：1 个直飞 + 10 个联程，
11 份报价全部进入 route edge，10 条路径通过约束，最终比较包含直飞与联程。
验收复用了同一次真实报价，通过生产连接/规划/优化服务；拓扑使用空桩，
Artifact 使用内存仓库，没有执行 Worker、LLM、出票或微信真机流程。
本地机场参考表的时区仍为空，联程保护也未证实，因此相关结果保持 partial。
证据位于忽略目录 `backend/.demo/connecting-fares-verification.json`。

本轮相关后端 15 个套件共 141 项不同测试累计通过，客户端相关检查 70 项通过；
前后端 TypeScript、最终后端构建与保留本地测试登录的 weapp 构建通过。
旧伦敦回程快照的 7 个联程也全部进入路线候选；实际 PostgreSQL 旧去程快照
中的 9 个无来源行李默认值经 presentation 标记待确认，Agent 读取同义，原始
payload 不变。这些结果不代替微信开发者工具交互/真机验收。

可重复验证（`--live` 会调用一次配置的真实票价服务；`--artifact=<id>` 回放旧单日快照）：

```powershell
cd backend
npm run build
node --env-file=.env.demo scripts/verify-connecting-fares.mjs --live --origin=SZX --destination=LHR --date=2026-10-02
```

## 追加：规划超时引发的进程退出已修复

本地登录后的首条整合机票与攻略请求在 19:14:28 进入 API。前几步已保存两份机票搜索与一份含 13 条 finding 的部分核实研究；19:16:58 到达原有 150 秒整轮上限，随后 API 因未处理的 Promise rejection 退出，未保存 assistant 回复或最终攻略。这不是正常等待。

根因在 ToolRegistry 的取消边界：顺序批次前一工具被取消后，下一工具的 Promise 已先启动，但等待函数看到已取消信号直接退出，没有订阅该 Promise 的拒绝。现已改为由等待函数拥有工具启动：先检查取消，启动前再次检查，统一接收同步抛错及迟到拒绝；未启动的工具不计成本。超时会返回明确的超时回复，150 秒上限保持原值。

后端构建通过。独立 Node `--unhandled-rejections=strict` 回归五项通过：预取消/同 tick 取消均不启动工具，迟到拒绝被处理，约 1 秒测试整轮上限后 HTTP 返回 `turn_timeout`，同进程 health 仍为 200。该回归仅用本地假工具，不调用真实供应商。Vitest runtime/cloud/routes 组及 runtime 单套件遇到既有 worker 模块加载 `fetch` 超时，没有执行断言，未计为通过。

API 已恢复；真实 HTTP health/ready 与原 Trip workspace 均为 200，原两份机票和研究仍可读取。原对话只有用户消息，没有伪造补回模型回复；从「行程」重新打开原行程可以继续。此次修复不代表整合机票与攻略的延迟已优化或伦敦行程已完成。

```powershell
npm --prefix backend run build
node --unhandled-rejections=strict backend/scripts/verify-agent-cancellation.mjs
```

原故障日志为 `backend/.demo/api-local-login-20260908-185830.stderr.log` 和同名前缀的 stdout；恢复后的 API 日志为 `backend/.demo/api-planner-timeout-*.log`。原 Trip 为 `01a080b9-ff89-73d2-8109-1e621104d026`，Conversation 为 `01a080b9-ffa1-72f9-a9d4-e6bfc344063c`。

## 追加：本地登录测试阻塞已处理

18:45 左右完成本地测试登录：已确认原微信失败来自空的 `WX_SECRET`，用户选择先增加本地测试入口。后端、专用小程序构建已启用；重新编译后点击「本地测试登录」即可连接真实开发后端。详见[使用说明](local-test-login.md)和 [ADR 0013](adr/0013-local-test-authentication.md)。

14 项后端认证相关测试、61 项客户端相关检查、前后端类型检查及 weapp 构建通过。真实 HTTP/PostgreSQL 验证确认身份隔离、Token 刷新、重复登录和行程/workspace 恢复；18:59 左右追加验证关闭入口/生产配置会拒绝已有测试 Access/Refresh Token。证据保留在 `backend/.demo/local-login-*.json`。这项验证没有调用微信 code 交换，也没有操作开发者工具画面。入口默认关闭，生产环境禁止启用，只接受本机连接和显式本地密钥。

## 本轮实现范围

本轮只优化游玩路线的研究、模型编排、保存、校验和已有攻略界面。详细契约与启动方式见 [路线研究与攻略生成 MVP](design/travel-guide-mvp.md) 和 [ADR 0012](adr/0012-agent-authored-itineraries.md)。

- 主 Planner 通过 `save_travel_guide` 选择每日主题、城市、活动顺序、建议时段与个人化说明，支持不同天有不同活动数。
- 来源标题、描述、类别和 verification 由服务端恢复；保存前和完成 Goal 共用内容校验，缺少类别、日期、来源、逐日覆盖或超限均返回修订反馈。
- 云端保存必须绑定已激活的 travel-guide Goal/run；仅读取旧目标不能生成丢失交付归属的攻略。重复条目一次返回所有需要修订的日期与 finding ID。
- 未选中的旧研究不进入新攻略 lineage。owner、Trip version、取消、Goal/run 完成事务继续使用现有机制。
- 地点选择器在共同边界接受原始字符串 ID 及其安全整数表示；仍必须匹配可信地点，未知/歧义 ID 拒绝，不接受模型提供的地点事实。
- 活动搜索仍为 SerpApi → 有来源的 Research LLM 综合 → 主 Planner 编排。对话路径去掉额外检索词规划模型调用，最多 8 次搜索、并发 2，持续领取下一条搜索任务。
- 现有小程序卡片和日程详情显示主题、时段、安排建议、日期说明和资料链接。旧 guide v1 保持可读。

## 本轮证据

| 范围 | 观察结果与边界 |
| --- | --- |
| TypeScript / 构建 | 后端构建、前端类型检查通过；`FLIGHTOR_USE_MOCK=false` 的 weapp 构建通过 |
| 后端相关回归 | 13 个相关套件累计 131 项不同测试通过；最后三个修改涉及的套件以单 worker 复跑，65 项通过。覆盖非均匀日程、来源事实、日期/类别/条目上限、重复反馈、休息日、Goal/run 归属、取消和版本冲突 |
| 前端回归 | Artifact 19、Phase 6 客户端 18、Phase 7–9 客户端 9，共 46 项通过；属于代码/契约检查，不等同于界面实机验收 |
| PostgreSQL / 本地 API | 独立 `flightor_demo` 已恢复监听 127.0.0.1:55439；最新构建 API 已启动在 127.0.0.1:3000，HTTP health/ready=200、postgres=ok、redis=disabled_local。独立 `flightor_test` 的四个持久化套件 19 项通过；discovery 套件因 Vitest 模块加载超时未执行 |
| 新 Trip 攻略生成 | 17:00 左右最终样本通过：通过公共 Trip API 预置已确认条件，无预置研究；6 次真实 SerpApi 搜索 + 真实 Research LLM/Planner，约 64.3 秒保存五日攻略，活动数 `[1,2,3,2,2]`；一次 save 成功，`stopReason=completed`、`delivery=satisfied` |
| 已有研究续作 | 最终续作样本约 93.8 秒，通过 `resume_goal` 复用先前真实研究，保存绑定原 Goal/run 的攻略，`delivery=satisfied`；该续作没有新搜索请求 |
| 持久化恢复 | 上述两个成功样本均重新 GET workspace 和 Artifact，确认同一份五日 `composition=agent_authored` 攻略及 satisfied delivery 已恢复 |
| 内容质量 | 仍有泛化的美术馆/餐饮条目及临时活动信息，未完成逐景点营业状态、活动日期、交通和整体内容质量验收。当前来源均按实际情况标为 partially_verified |
| 空白对话 / 微信 | 默认脚本从已确认 Trip 条件开始；早期空白对话样本暴露数字 ID 及参数/日期提取问题。数字 ID 边界已修复，但最终版本未重做空白对话全链路。未验收微信 code 交换、开发者工具交互或真机 |

真实 Provider 均使用现有配置的 `deepseek/deepseek-v4-flash-0731`。样本通过证明编排、保存、Goal 验证与恢复链路可运行；不证明预算已报价、全部事实完全核实或性能稳定。此前多次调用遇到供应商/模型延迟并到达 150 秒上限，也暴露了类别、数字地点 ID、重复条目和旧 Goal 未激活的问题。本轮没有延长超时或降低交付标准。

全量后端回归及后续 PostgreSQL 全组复跑因 Vitest worker 的模块加载 `fetch` 超时停滞，不能按通过计算；最终关键套件单独执行已通过。运行环境问题与断言失败分别记录，没有用早期全仓通过记录替代本轮结果。

成功证据位于忽略目录：

- 新 Trip：`backend/.demo/guide-mvp-2026-09-08T08-59-41-142Z.json`；guide `01a0803f-7ff4-72a1-8f7f-22d87f96ca02`。
- 续作：`backend/.demo/guide-mvp-2026-09-08T08-50-54-825Z.json`；guide `01a08037-c93f-770c-8936-ffc5b8033bf1`。
- 早期失败：同目录 `guide-mvp-*` 中保留失败状态和模型/工具轨迹，不将 partial、pending 或 timeout 算作成功。新脚本证据不保存 access token。

## 本地运行

必需服务与凭据见 [MVP 文档](design/travel-guide-mvp.md)。演示环境在 `backend/.env.demo`，未写出的密钥仍可从 `backend/.env` 加载；两者都已忽略，不提交。

本轮已启动本地 API。下面是需要重新构建、启动时的命令；已有服务运行时使用 health 检查即可。进程记录与日志保留在忽略目录 `backend/.demo/api-guide-mvp.*`。

```powershell
# 仓库根目录；数据库需已启动并迁移
npm --prefix backend run build
npm --prefix backend run demo:api
# 另一终端
Invoke-RestMethod http://127.0.0.1:3000/health/ready
$env:FLIGHTOR_USE_MOCK = 'false'
$env:FLIGHTOR_API_BASE_URL = 'http://127.0.0.1:3000'
npm run build:weapp
```

独立验证攻略链路，不需要启动或替换已有 API 进程：

```powershell
npm --prefix backend run demo:guide
```

脚本仅允许 `flightor_demo`，resume 也只允许自身创建的开发测试身份。默认通过 API 预置日期、预算与偏好，`--from-empty-trip` 可额外测试自然语言条件录入。若测试因超时留下未完成行程，可在 backend 目录使用 `--resume PATH`，其中 PATH 是该次输出的证据 JSON 路径。没有自动重试循环；不满足完整保存和恢复条件就以非零码退出。

该临时 PostgreSQL 数据目录为 `C:\Users\VENTSDENYE5\AppData\Local\Temp\flightor-pg16-20260908-01a07e88\data`，不是 Windows 系统服务。主机重启后需要重新启动；当前仅监听本机。第一次使用新数据库时需执行迁移：

```powershell
cd backend
node --env-file=.env.demo dist/db/migrate.js
```

微信开发者工具导入根目录 `project.config.json`；登录需 `WX_APPID` / `WX_SECRET`，手机需可达 HTTPS API。本轮未发布公网服务。

## 既有能力与本轮未重测范围

此前记录的真实机票搜索、去程路线生成与保存已通过，原始证据保留在 `backend/.demo/e2e-*.json`；报价属于历史快照。本轮没有改造或重新验收最终机票引擎，仍仅支持单起点、单目的地、去程，不能据此声称新增多城市、往返或地面交通组合。

建议时段、创作性说明、来源时效和完整旅行预算仍有未核实边界。`delivery=satisfied` 表示接受的结构化交付约束满足，不等于完整旅行产品或内容质量全部验收。
