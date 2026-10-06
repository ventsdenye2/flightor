# DSH D6 公共文案与错误恢复

状态：2026-10-06，随 D6 实施；不代表 D6 全量验收或真实用户旅程通过。全量标准见 [D6 验收](DSH_D6_ACCEPTANCE.md)，本行为报告维护错误分类与公开显示边界。

## 预算与精确字段

只允许精确复述当前 Trip 结构化预算中的全程总额目标：金额、币种及 trip scope 必须与权威字段一致，并须明确写成全程预算目标。简短确认和攻略公开文字均不得借此推断预算可行或表示费用已经核实；其他金额、币种、每日预算解释、票价、门票价格、营业时刻和具体交通耗时仍被拦截。预算保证仍被拒绝；同一句中明确表示无法确认预算是否够用的谨慎表述可通过，但不能掩盖同句或后续分句中的肯定保证。纯文本货币代码（CNY、RMB、USD、EUR、GBP、JPY）也按金额检查。发布 validator 不因精确目标例外而放宽其他公开字段。

已采用航班的班次、日期、机场和起降时刻属于绑定航班 Artifact 的结构化展示字段，按航班卡展示。这个结构化展示不授权模型将其改写为自由文本中的精确交通耗时、费用或其它未经支持的事实；也不增加公共散文 validator 的普遍数字豁免。回归覆盖模型散文中的航班起飞时刻，仍应按精确时刻拦截。

## 错误分类与用户动作

DSH 的固定映射函数 `classifyDshFailure` 将已知故障分为 `provider`、`output_limit`、`location`、`evidence`、`context_conflict`、`commit`、`publication` 和 `ui_restore`。`publicFailureReply` 只从固定中英文文案表生成回复，不接收或显示任意 Provider 正文、异常消息、stack、Key 或内部工具负载。未知错误维持未分类，由现有安全通用文案处理。

新增精确映射：`DSH_GUIDE_BASE_UNAVAILABLE` 仍归为 `context_conflict`，但其受控 cause code 单独生成中英文提示：“当前没有可用于局部修改的已发布攻略。请先重新打开当前攻略并完成当前显示语言的准备，再请求局部修改。”不再声称处理期间行程或航班发生变化。`DSH_CANDIDATE_REFERENCE_UNAVAILABLE` 归为 `evidence`，提示补充地点或偏好资料。cause code 只参与白名单文案选择，不显示内部码、原始错误、栈或工具负载；前端已知错误码分类合同不变。

公开说明要指出失败阶段和下一步：Provider 暂时不可用时先查已保存结果；输出达到上限时缩小规划或编辑范围；地点不确定时补充城市或地点；资料不足时补充范围；行程/航班冲突时重新打开当前行程并核对条件；提交或发布失败时确认没有将草稿当正式结果，并检查既有攻略；UI 无法恢复请求时重新打开行程、查结果后再决定是否重试。不得通过自动重放旧提交来修复版本冲突。

后端生成的已完成响应继续使用既有 `reply`、`stopReason` 与 `warnings` 字段；失败 turn 继续使用既有错误 `code`。客户端只把已知错误码转成固定用户提示，忽略服务端任意异常正文。该变更不增加公开 API 字段。

前端 Artifact GET 被更新的同 key 请求取代时，`ArtifactRequestSupersededError` 以受控 `code` 标识内部竞态。Plan effect 忽略此结果，不把它报告为用户规划失败，之后可由当前规划数据恢复继续更新。仍停留在 Route 的 active effect 则把它作为 UI 恢复受阻显示固定 `ui_restore` 文案，并提供现有刷新动作，避免无错误的永久加载；scope 和 generation 仍限制该回调写入。其他读取失败也显示固定中英文恢复提示，并引导重新打开行程和检查已保存结果。未知异常正文、stack、token 和 HTTP 响应内容不进入页面。

DSH `commit_travel_guide` 的模型可见纠错回执只从 schema 路径与受控领域字段组装。候选缺少 `category` 时返回具体 `candidates.<index>.category` 字段及共享 `researchTypeSchema` 全部类别；不回显候选原值、错误消息或 Provider 正文。服务按本轮 `acceptedGoalIntent` 判断首次提交状态：尚无已接受 Goal 时要求保留本次用户目标的原始 intent 并随纠正后的首次持久操作提交；Goal 已接受时要求省略 `intent/goalRef`，保留其不可变参数。日覆盖提示仅允许 `expectedDays`（1–60）、`submittedDays`（元素均为1–60且最多60项）和合法 ISO 日期 `travelWindow.from/to`；未知或越界字段丢弃。覆盖修正与既有精确价格/时刻文案修正合并，任意 `repairHint` 不透传。此回执不改变参数/内容修订分类、Goal 限制、证据检查或纠错额度。

## 验证

当前定向验证：`backend npm run check` 通过；D6 public-error、service wiring、preparation 3文件/29项通过，覆盖缺当前语言基底的双语公开回复以及不泄露内部码；`node scripts/test-public-planner-errors.cjs` 的 40 项分类、固定双语文案及 failed-turn 接线断言通过。既有 `npm test -- src/agent/dsh/public-errors.test.ts` 14/14 与 `npm test -- src/travel-guides/finalization.test.ts src/agent/dsh/reply.test.ts src/agent/dsh/public-errors.test.ts src/agent/dsh/commit-recovery.test.ts` 4文件/138项，以及 `npm run test:production-presentation` 的呈现36项、格式化回复6项、生产库7项、媒体客户端1项和媒体迟到结果1项为先前检查，不替代当前完整回归。当前批次 `node scripts/check-docs.cjs` 检查113份Markdown和709个相对链接及同批文档更新通过；`git diff --check` 通过。真实 Provider、H5、微信和完整 D6 验收均未由这些定向检查证明。
