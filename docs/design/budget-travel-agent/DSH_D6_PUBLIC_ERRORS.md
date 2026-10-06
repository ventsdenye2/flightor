# DSH D6 公共文案与错误恢复

状态：2026-10-06，随 D6 实施；不代表 D6 全量验收或真实用户旅程通过。全量标准见 [D6 验收](DSH_D6_ACCEPTANCE.md)，本行为报告维护错误分类与公开显示边界。

2026-10-06 失败攻略状态：尝试提交攻略但没有成功确认 publication 时，交付为 `partial/travel_guide`、缺 `accepted_publication`，而非只读问答的 `not_requested`。候选关联失败或缺少可编辑基底且未接受攻略 Goal 时，`goals` 为空；不捏造 Goal ID，不继承前一成功 setter 的交付状态。具体缺基底的固定英文提示保持不变。联合定向回归首次111/112，唯一旧用例仍期待 `not_requested`；已改为断言完整 partial 结构及 `goal_partial`，原失败日志保留，复验结果见冻结验收。

## 预算与精确字段

只允许精确复述当前 Trip 结构化预算中的全程总额目标：金额、币种及 trip scope 必须与权威字段一致，并须明确写成全程预算目标。攻略可以在同一句目标说明中补充实际支出会随住宿、餐饮、购物等选择而变化、未知部分仍未知；这只是条件性不确定说明，不表示估算或费用已核实。该说明只帮助识别同句中的精确预算目标，不放行其他金额。其他金额或币种、每日金额、票价、门票价格、已核实支出、营业时刻和具体交通耗时仍被拦截。预算保证仍被拒绝；同一句中明确表示无法确认预算是否够用的谨慎表述可通过，但不能掩盖同句或后续分句中的肯定保证。纯文本货币代码（CNY、RMB、USD、EUR、GBP、JPY）也按金额检查。发布 validator 不因精确目标例外而放宽其他公开字段。

已采用航班的班次、日期、机场和起降时刻属于绑定航班 Artifact 的结构化展示字段，按航班卡展示。这个结构化展示不授权模型将其改写为自由文本中的精确交通耗时、费用或其它未经支持的事实；也不增加公共散文 validator 的普遍数字豁免。回归覆盖模型散文中的航班起飞时刻，仍应按精确时刻拦截。

## 错误分类与用户动作

DSH 的固定映射函数 `classifyDshFailure` 将已知故障分为 `provider`、`output_limit`、`location`、`evidence`、`context_conflict`、`commit`、`publication` 和 `ui_restore`。`publicFailureReply` 只从固定中英文文案表生成回复，不接收或显示任意 Provider 正文、异常消息、stack、Key 或内部工具负载。未知错误维持未分类，由现有安全通用文案处理。

新增精确映射：`DSH_GUIDE_BASE_UNAVAILABLE` 仍归为 `context_conflict`，但其受控 cause code 单独生成中英文提示：“当前没有可用于局部修改的已发布攻略。请先重新打开当前攻略并完成当前显示语言的准备，再请求局部修改。”不再声称处理期间行程或航班发生变化。`DSH_CANDIDATE_REFERENCE_UNAVAILABLE` 归为 `evidence`。`DSH_GUIDE_NEEDS_REVISION` 的 `candidate_key_unavailable` 前置原因也归为 `evidence`，并单独提示行程活动与参考资料未能正确关联、本轮未确认新的攻略结果，建议查看已有结果后再重试；它在准备阶段失败且 `contentAttempts=0`，不能描述为内容或发布检查失败，也不能暗示来源语义已评估。cause code 只参与白名单文案选择，不显示内部码、候选 key、原始错误、栈或工具负载；未知 cause 不改变该阶段的固定通用文案，前端已知错误码分类合同不变。

当提交省略候选 `locationId` 或日程 `cityId`，而准备快照没有唯一已选 canonical city 时，`candidate_location_unresolved` 作为 `location` 前置错误单独使用固定双语文案：地点尚未与当前行程确认关联，提示核对并确认行程目的地后继续。模型反馈最多含110个通过路径白名单的字段路径（50个候选加60天日程）、Trip destination mode 和已选 city 数；路径先验证为索引规范且范围内的 schema 字段，再去重并限量，不回显候选名或用户输入。该前置失败不消耗内容或参数纠正额度。模型可为每个缺字段显式选择当前 Trip 已确认且与该地点匹配的 canonical city，保留用户已设的多城市范围；不能从另一日程的 `cityId`、文本或 web 来源推断候选身份。唯一已选 Trip city 才能自动补全省略字段。若当前 Trip 没有能识别用户请求地点的已选城市，应请用户确认；仅当用户请求明确支持变更且 trusted resolver 给出身份时才更新 Trip。Trip 版本推进后必须重新准备并重新研究；旧版本 sourceRefs 和候选绑定不可复用。公开提示不声称用户未提供城市，也不增加 API 字段。

公开说明要指出失败阶段和下一步：Provider 暂时不可用时先查已保存结果；输出达到上限时缩小规划或编辑范围；地点不确定时补充城市或地点；资料不足时补充范围；行程/航班冲突时重新打开当前行程并核对条件；提交或发布失败时确认没有将草稿当正式结果，并检查既有攻略；UI 无法恢复请求时重新打开行程、查结果后再决定是否重试。不得通过自动重放旧提交来修复版本冲突。

后端生成的已完成响应继续使用既有 `reply`、`stopReason` 与 `warnings` 字段；失败 turn 继续使用既有错误 `code`。客户端只把已知错误码转成固定用户提示，忽略服务端任意异常正文。该变更不增加公开 API 字段。

前端 Artifact GET 被更新的同 key 请求取代时，`ArtifactRequestSupersededError` 以受控 `code` 标识内部竞态。Plan effect 忽略此结果，不把它报告为用户规划失败，之后可由当前规划数据恢复继续更新。仍停留在 Route 的 active effect 则把它作为 UI 恢复受阻显示固定 `ui_restore` 文案，并提供现有刷新动作，避免无错误的永久加载；scope 和 generation 仍限制该回调写入。其他读取失败也显示固定中英文恢复提示，并引导重新打开行程和检查已保存结果。未知异常正文、stack、token 和 HTTP 响应内容不进入页面。

DSH `commit_travel_guide` 的模型可见纠错回执只从 schema 路径与受控领域字段组装。候选缺少 `category` 时返回具体 `candidates.<index>.category` 字段及共享 `researchTypeSchema` 全部类别；不回显候选原值、错误消息或 Provider 正文。服务按本轮 `acceptedGoalIntent` 判断首次提交状态：尚无已接受 Goal 时要求保留本次用户目标的原始 intent 并随纠正后的首次持久操作提交；Goal 已接受时要求省略 `intent/goalRef`，保留其不可变参数。日覆盖提示仅允许 `expectedDays`（1–60）、`submittedDays`（元素均为1–60且最多60项）和合法 ISO 日期 `travelWindow.from/to`；未知或越界字段丢弃。覆盖修正与既有精确价格/时刻文案修正合并，任意 `repairHint` 不透传。此回执不改变参数/内容修订分类、Goal 限制、证据检查或纠错额度。

## 验证

2026-10-06 r12原会话确认：两次完整提交都因`verified_evidence`拒绝，并附`excluded_precise_claim`；首次intent的`allowPartial=false`已被接受，而此轮新网页候选按现有合同均为部分核实材料。第三次触及原内容修订上限。DSH提交现在在首次Goal接受之前检查：新提交raw候选若被日程或补充材料选中，不能同时要求完全核实；返回受控`raw_evidence_requires_partial`及`intent.parameters.allowPartial`字段，不写Goal或研究，也不消耗内容修订次数。主模型只能在符合用户请求时显式纠正首次语义intent；用户要求独立核实时应说明资料能力限制。已接受/恢复的严格Goal仍交原领域验证，不能改为宽松Goal。参数、前置与内容额度上限不变。前置门红测2失败/49通过→51/51，官方worker修后接线1/1（未取得该新fixture修前红测），联合预算/Goal/Trip更新/准备/回复/公开错误8文件207/207，backend check/build与docs113份736链接均通过。真实完整验收仍待新冻结批次，不能据离线通过宣称已完成。

当前定向验证：`backend npm run check` 通过；D6 public-error、service wiring、preparation 3文件/29项通过，覆盖缺当前语言基底的双语公开回复以及不泄露内部码；`node scripts/test-public-planner-errors.cjs` 的 40 项分类、固定双语文案及 failed-turn 接线断言通过。既有 `npm test -- src/agent/dsh/public-errors.test.ts` 14/14 与 `npm test -- src/travel-guides/finalization.test.ts src/agent/dsh/reply.test.ts src/agent/dsh/public-errors.test.ts src/agent/dsh/commit-recovery.test.ts` 4文件/138项，以及 `npm run test:production-presentation` 的呈现36项、格式化回复6项、生产库7项、媒体客户端1项和媒体迟到结果1项为先前检查，不替代当前完整回归。当前批次 `node scripts/check-docs.cjs` 检查113份Markdown和709个相对链接及同批文档更新通过；`git diff --check` 通过。真实 Provider、H5、微信和完整 D6 验收均未由这些定向检查证明。

2026-10-06 r13公开错误分类：`candidate_key_unavailable` 是攻略准备前置失败（真实回执 `contentAttempts=0`），归为 `evidence`，单独使用固定双语候选关联提示，不暗示已经判断资料语义；不显示 cause code 或候选 key。回归覆盖分类、双语文案脱敏和未知 cause 的通用回退。红测2失败/15通过，修复后 `public-errors.test.ts` 18/18、`backend npm run check` 通过；`node scripts/check-docs.cjs` 检查113份Markdown及740个相对链接和同批文档更新通过，`git diff --check` 通过。日志保留在忽略目录 `output/d6/r13-public-errors-red.log` 与 `output/d6/r13-public-errors-green.log`。离线检查不构成真实 Provider 或 D6 旅程验收。

2026-10-06 r12预算目标误拦复验：原第二次提交overview把`1200元人民币`明确写为全程总预算目标，并注明实际花费会随住宿、餐饮、购物选择而变化、未知部分仍未知；逗号切分让条件说明与其变化结论分开，令目标金额未获精确字段豁免。仅增加同句、相邻分句的条件性支出变化识别；原预算金额、币种、trip scope 和全程目标条件不变。红测过程保留如下：首版为3失败/73通过，1项是原overview误拦，另2项是对无金额、独立句价格/核实表述提出了过严的`excluded_precise_claim`预期，随后改成同句同额门票价与已核实支出反例；修正中文反例后为1失败/76通过，英文例当时用`actual spending`未走精确cost分支，改为`actual costs`后最终红测为2失败/75通过，恰为中英文条件性说明被旧逻辑误拦。绿测`backend/src/travel-guides/finalization.test.ts` 78/78通过。负例覆盖金额、币种或scope不匹配、每日金额、同额门票价、已核实支出及预算保证；`cautiousBudgetLanguage`未放宽。真实 Provider、H5和完整 D6 验收不由本定向结果证明。

2026-10-06 r15 地点反馈上界：compact schema 最多含50个候选和60天，准备错误现返回全部最多110个遗漏地点字段。红测 `backend npm test -- src/agent/dsh/preparation.test.ts src/agent/dsh/commit-recovery.test.ts` 为2项失败/29项通过，分别复现准备端与反馈端截断在20；修复后同命令2文件31/31通过。反馈先过滤非白名单、非规范索引、越界及重复路径，再限制最多110项；覆盖非法路径排在110个有效字段之前的情况。红测概要与绿测原日志分别保存为 `backend/output/d6/r15-location-feedback-red-summary.log` 和 `backend/output/d6/r15-location-feedback-green.log`。通过只验证离线准备与脱敏反馈，不代表真实 Provider、H5 或完整 D6 验收。
