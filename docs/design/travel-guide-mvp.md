# 路线研究与攻略生成 MVP

2026-09-08。实现决策见 [ADR 0012](../adr/0012-agent-authored-itineraries.md)，最新验收见 [DEMO_STATUS](../DEMO_STATUS.md)。

## 用户得到什么

在现有「规划」对话中告诉 Agent 日期、目的地、预算、兴趣和节奏，Agent 研究具体去处，选择每天的重点、顺序、建议时段和推荐理由，并保存可恢复的五日或多日攻略。每天的安排由 Planner 选择，允许不同天有不同活动数量。日程详情显示当天主题、提醒、活动建议和来源链接。

本次修改限定在游玩路线的研究、编排、保存与展示。现有机票搜索、最终航线生成引擎、Trip/Conversation/Goal 和登录体系继续使用。

## 实际链路

```text
用户约束 → 主 Planner 自主选择工具
                 ↕
        research_destination / web_research
                 ↓
       SerpApi 搜索 → Research LLM 综合有来源的 findings
                 ↓
       Planner 选择活动、天数分配、顺序、时段与个人化说明
                 ↓
       save_travel_guide → 共享约束校验 → route + travel_guide
                 ↓
       服务端 Goal 交付校验 → 对话卡片 / 日程详情 / workspace 恢复
```

这是职责关系，工具顺序由 Agent 根据当前约束和已有研究决定。已有兼容研究可以复用；保存攻略不要求先生成 destination_set 或固定日程骨架。

活动搜索仍使用 SerpApi，OpenRouter Research 模型负责综合来源；尚未接入模型原生联网。对话研究去掉了额外的检索词规划模型调用，由主 Planner 直接提供研究问题；搜索保持最多 8 次、并发 2，以两个持续领取任务的 worker 执行，结果顺序稳定。

## 保存契约

- 主 Planner 提交 `researchArtifactIds` 和逐日安排。活动使用 `researchIndex`、`findingId` 引用研究，另填 `timeOfDay`、`planningNote`；每天可填 `theme`、`notes`、`kind`。
- 服务端恢复原始标题、描述、类别和 verification，不接受模型伪造这些事实字段。主题、玩法和建议时段单独保存为推荐内容。
- 保存前和完成 Goal 使用同一内容校验：天数与逐日覆盖、城市、必选活动、日期窗口、来源一致性、有效期、研究类别、条目上限及部分核实策略。缺少条件返回 `needs_revision`，该次无效提交不写攻略。
- 云端保存必须有已激活的 travel-guide Goal/run；仅读取 `get_active_goal` 不会激活旧目标。修订反馈保留原目标约束，重复条目一次返回涉及的日期和 finding ID。
- 只将实际选中的研究放入 lineage，未选中的旧研究不会污染新结果。owner、Trip version、取消和运行状态继续由 Artifact workspace 检查。
- 地点选择器统一将安全整数 ID 与相同的字符串 ID 匹配到可信地点；未知、负数、非整数及歧义选择不会变成地点事实。
- 明确休息或转场日需要当天说明，且接受的 Goal 必须允许 `allowRestDays`；默认仍要求每天有合格研究条目。
- 沿用 `travel_guide` v1，以可选字段扩展旧卡片兼容性。派生 `route:trip_route_plan` 记录 Planner 实际选择的城市和天数，不重新平均分配。
- route 与 guide 分别通过现有 workspace 写入；两次写入间取消或改条件可保留前一步 route，但不能生成成功攻略交付。没有新增跨 Artifact 的原子事务。

## 本地启动与最小验证

依赖已配置的 `backend/.env` / `backend/.env.demo`。必需项为 `DATABASE_URL`、`JWT_SECRET`、`REDIS_URL`、`OPENROUTER_API_KEY`、`SERPAPI_KEY`；可分别设置 `PLANNER_MODEL`、`RESEARCH_MODEL`。本地可使用 `REDIS_ENABLED=false`。不要提交环境文件。

从仓库根目录执行：

```powershell
npm --prefix backend run build
npm --prefix backend run demo:api
# 另一终端
Invoke-RestMethod http://127.0.0.1:3000/health/ready
$env:FLIGHTOR_USE_MOCK = 'false'
$env:FLIGHTOR_API_BASE_URL = 'http://127.0.0.1:3000'
npm run build:weapp
```

数据库必须已启动并完成迁移。通过微信开发者工具导入根目录 `project.config.json`；真实登录需要 `WX_APPID` / `WX_SECRET`，手机需要可达的 HTTPS API。

缺少微信凭据时，可以使用已实现的[本地测试登录](../local-test-login.md)：显式配置后运行 `npm run build:weapp:local`，再在登录弹窗点击「本地测试登录」。该入口连接真实开发后端。

在「规划」里输入：

> 2026 年 10 月 10–14 日在东京玩 5 天，预算 5000 元，喜欢美术馆、日料和安静街区，节奏轻松，第一天少安排。先只做游玩攻略，不查机票，不需要特定展期。请研究具体去处，按天安排重点、时段和推荐理由并保存，部分核实的信息标明。

独立验证真实 Provider 和数据库，无需启动或替换已有 API 进程：

```powershell
cd backend
node --env-file=.env.demo scripts/demo-guide-mvp.mjs
```

该脚本仅允许 `flightor_demo`，创建随机开发身份和新 Trip，通过公共 Trip API 预置已确认的日期、预算和偏好，再调用当前生产路由及真实 SerpApi、Research LLM 与 Planner。预期最后输出 `stage=completed`、`restored=true`，且已保存 `composition=agent_authored` 的五日攻略、服务端 `delivery=satisfied`。失败和 partial 会以非零码退出。证据写入忽略目录 `backend/.demo/guide-mvp-*.json`，不保存 access token。

可选 `--from-empty-trip` 扩展测试自然语言条件录入；`--resume .demo/guide-mvp-<timestamp>.json` 显式继续该脚本创建的测试行程，不自动重试，也不降低原 Goal 条件。默认测试通过不等同于空白对话解析全部通过。

脚本身份绕过微信 code 交换；它验证服务端链路，不等同于微信真机验收。默认真实调用会使用已配置供应商的额度。

## 当前边界

建议时段没有地图路程或营业时间可行性证明，预算也不是完整旅行报价。来源标题与摘要受服务端约束，但自由文本推荐理由没有额外事实级核验。真实样本仍出现泛化条目和待核实的临时活动信息，内容质量及每个去处的时效尚未完整验收。公开网页摘要允许按 Goal 标为部分核实，`delivery=satisfied` 表示约定的交付条件满足，不代表全部旅行事实已完全核实。

本次没有新增地图供应商、精确交通时间、预约与票价核验、原生联网模型、长期后台 Planner 或新的多城机票引擎。单轮仍受现有 150 秒和 10 个工具步骤限制，真实延迟随供应商和模型变化。
