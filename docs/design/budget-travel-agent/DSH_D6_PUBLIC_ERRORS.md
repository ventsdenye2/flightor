# DSH D6 公共文案与错误恢复

2026-10-07 r24真实解释失败，当前暂停、尚未修复：原冻结函数将合法裸“整趟”预算范围和“并非已经核实的费用结论”的否定关系误判，同时漏检无金额“小吃通常单价低”；两类问题须分别补回归，不能修误拦后让含无依据成本评价的原解释通过。公开页面仍显示“这次未能给出合适的说明，请换一种方式描述你想了解的问题。”，对一个有效的只读解释请求归责问法不准确；此缺口由D6-53记录，后续错误文案须准确指明说明内容校验阶段，保持原保护与已保存成果。原文、实际codes、PG与暂停范围见[本轮失败审计](evidence/d6-r24-b01-failure.json)，不宣称新的行为已实现。

2026-10-07 r22数量前置（已实现，定向验证通过）：`guide_initial_result_limit`明确归commit阶段，公开答复仍使用既有固定双语文案，不显示内部数量字段、候选键或异常正文。内部模型反馈区分尚未接受的新intent参数纠正与已接受Goal内容修订，完整选择数量、原限额和合法上限均按[字段反馈](DSH_D6_PRESENTATION_FEEDBACK.md)白名单输出；修正数量不豁免预算保证、免费入场、证据重复或其他发布拒绝。最终12文件473/473含公开分类、字段过滤及[免费入场窄修](DSH_D6_EVIDENCE_AND_LOCATIONS.md)通过；r21原失败不追认，真实H5仍须新冻结复验。

2026-10-07 r20补充：权威预算scope=trip时，擅自排除、另计或限定支出的公开文案返回受控budget_scope_changed；归入publication错误，保留固定中英文安全答复，不输出原被拒文字。未知费用、否定排除和票品/行程包含范围的边界由27个scope例及4文件241/241覆盖；明确预算优先于itinerary/行程安排前缀豁免。局改的guide_edit_result_limit、guide_edit_limit_conflict、guide_edit_limits_unavailable归受控commit前置失败，反馈不改变已接受Goal。真实H5仍待新冻结复验。

2026-10-07 r19名词列表补验：独立复核还记录两版均有的合法“门票价格与预约情况”及“门票、交通费和实际花费”延期核验误拦。本批纳入正例修复，并加入同额“亦是费用”关系反例；延期核验只允许纯成本/时间/预约名词枚举，不能跨肯定金额关系。结果另记，不能以旧版同样误拦而忽略当前已确认问题。

2026-10-07 r19第二次独立预算复核：合法费用延期核验修复还暴露“预算目标1200元肯定足够”的保证识别缺口，以及成本词前“已确认/已核实/已支付”被尾随延期核验掩盖的边界。已补中英文金额间隔保证与前置确认/支付反例，红7失败/200通过→绿207/207；后续复核又确认括号前的已确认预算不能跨范围绑定到括号内实际花费，继续补相邻前缀回归，保留仅确认总预算、不确认费用及是否足够未知的正例。最终结果后续记录，不据先前focused通过宣布最终验收。

2026-10-07 r19活动日期缺口公开提示已实现：准确区分活动日期来源缺口与用户目的地/偏好缺失，使用固定中英文，不输出code、内部字段或来源正文。service的lastCommitCause纳入受控日期原因，保留到后续修订额度拒绝，真正后续Provider/output_limit仍优先。最新service12、commit-recovery28、public-errors23共63/63通过（8.69秒，`backend/output/d6/r19-service-joint-02.log`）；首次受限启动在配置阶段spawn EPERM、未收集测试，原日志保留。此离线结果不代表H5通过。

2026-10-07 r19预算保护收尾：中英文预算目标金额后的“足够”保证，以及紧邻成本词的已确认/已核实/已支付和同额肯定用途，均保留拒绝；预算确认不得跨括号归为成本确认。官方/当地延期核验仅承认明确名词列表，允许“门票价格与预约情况”及“门票、交通费和实际花费”的未知说明。先后红绿证据保留：保证/prefix红7失败/200通过→207/207；相邻prefix红1失败/207通过→208/208；名词列表与同额费用关系红3失败/208通过→最终两文件211/211（finalization146、reply65，2.79秒）。日志为`backend/output/d6/r19-budget-guarantee-prefix-*`、`r19-budget-adjacent-prefix-*`、`r19-budget-noun-list-*`。未更改费用保证、每日/币种/金额及发布校验标准；独立复核与完整冻结验收另记。

状态：2026-10-06，随 D6 实施；不代表 D6 全量验收或真实用户旅程通过。全量标准见 [D6 验收](DSH_D6_ACCEPTANCE.md)，本行为报告维护错误分类与公开显示边界。

2026-10-06 失败攻略状态：尝试提交攻略但没有成功确认 publication 时，交付为 `partial/travel_guide`、缺 `accepted_publication`，而非只读问答的 `not_requested`。候选关联失败或缺少可编辑基底且未接受攻略 Goal 时，`goals` 为空；不捏造 Goal ID，不继承前一成功 setter 的交付状态。具体缺基底的固定英文提示保持不变。联合定向回归首次111/112，唯一旧用例仍期待 `not_requested`；已改为断言完整 partial 结构及 `goal_partial`，原失败日志保留，复验结果见冻结验收。

## 预算与精确字段

只允许精确复述当前 Trip 结构化预算中的全程总额目标：金额、币种及 trip scope 必须与权威字段一致。发布攻略必须明确写出整趟行程范围；短答复可在权威预算 scope 为 `trip` 时写明总预算目标，确认“两天/全程”口径或否定误解为每日金额。两种路径均只豁免对应目标金额的具体词段；同一句中的全程目标已明确时，才可豁免同额同币种且明确被否定的每日复述。不得豁免肯定的每日金额、目标句之外的重复金额或其他币种/金额。

费用名词本身不等于费用已确认。校验在分句及括号范围内检查费用谓词：明确确认/核实/支付、金额与费用的等同/估算/名词修饰关系，以及“这个金额/that amount”等金额指代，不能借全程目标豁免。明确费用关系在句号、分号、换行或同次提交的字段边界后仍检查，不因改标点把目标变成费用事实；局部否定或“无法确认该费用为这个金额”的谨慎关系保留。目标的“已确认”不能跨括号误作费用的“已确认”。`门票、餐饮等实际花费请以现场为准`、`未知费用不作估算`、成本资料查询提示及支出随选择变化等句子没有肯定费用谓词，不能仅因未命中特定提示模板而撤销权威目标豁免。局部谨慎说明不能掩盖相邻或转折后的肯定费用、每日预算或保证。这仍是受控表达检查，不是通用自然语言事实审核或价格核验。

预算保证仍被拒绝；明确表示无法确认预算是否够用的谨慎表述可通过，但不能掩盖同句或后续分句中的肯定保证。纯文本货币代码（CNY、RMB、USD、EUR、GBP、JPY）也按金额检查。免费开放、免费入场或免费进入属于禁止的入场/开放时间声明；免费 Wi-Fi 或免费导览资料不是入场声明。发布 validator 不因精确目标例外而放宽其他公开字段，预算范围、证据、版本、权限和修订额度保持原合同。

2026-10-07 r21独立反例补充：`amounts to/requires/共计/需要`与明确金额指代、已花费该金额等关系继续按费用声明拒绝，`may cost this amount`仍是费用估计，后接“尚未知”不能自动撤销。费用类别仅在绑定金额/指代时构成成本关系，单独确认住宿预订不等同确认价格；`Whether ticket costs are this amount has not been confirmed`是未确认的问句关系，保留通过。全程预算的“另计”规则沿用同一谓词检查并包含“另行计算”，否定另计及票品/套餐自身范围不据此变为全程预算排除。原两稿预算误拦与全部红绿、完整原文机械回放见[字段反馈](DSH_D6_PRESENTATION_FEEDBACK.md)；实际构建独立[24例](evidence/d6-r21-budget-independent-replay.json)与最终12文件461/461均为离线证据，不代表实际费用或完整旅行内容已认证。

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

2026-10-06 r16 精确预算词段与入场表达：原留存答复“你给的1200元是整个行程的总目标（不是每天1200元）……”因目标句未出现“预算”且仅第一次同额金额被遮蔽而误报 `excluded_precise_claim`。共享最终文案检查现允许与 Trip 的金额/币种完全一致、明确覆盖全程的目标金额词段，即使没有“预算”一词；仅在同一字段/句已有该目标时允许同额同币种的明确否定每日词段。每个金额分别定位并替换；其他金额/币种、每日肯定数值、否定的每日不同币种、目标外重复金额、无全程范围的目标金额、票价、已核实开销、保证表达仍按原规则拒绝。并补齐 `免费开放/免费入场/免费进入` 入场/开放时间用语拦截，保留免费 Wi-Fi/导览资料。`backend npm test -- src/travel-guides/finalization.test.ts`红测3失败/82通过（核心r15及中英近邻目标），加上入场对照后的红测4失败/86通过（该句和三种免费入场表达）；最终 `backend npm test -- src/travel-guides/finalization.test.ts` 94/94通过。运行首次遭Windows沙箱`spawn EPERM`，原始记录与允许的本地测试重跑均保存在忽略目录 `backend/output/d6/r16-budget-red.log`、`r16-budget-red-retry.log`、`r16-budget-and-admission-red.log` 与 `r16-final-green.log`。此定向离线验证不代表 Provider、H5 或完整 D6 旅程通过。

2026-10-06 r17短答预算与小数边界：回放r16 unit失败中的既有 `reply.test.ts` 三项，复现确切总预算/两日总额及同额否定每日短答均被 `excluded_precise_claim` 拦截（3失败/47通过）。短答只在权威 budget scope=`trip` 时可使用同额全程总预算目标；扩展中英文目标词与范围词的前后词序识别，出版攻略仍要求显式全程范围，裸“总预算目标”不获豁免。任何路径均逐金额span处理并保留每日肯定金额、价钱、其他金额/币种、目标外重复数值及预算保证拦截。零出站小数回归复现 `1200.5` 被句号切分误判（1失败/94跳过）；切分现忽略数字之间的小数点，权威`1200.5`可精确复述，权威`1200`仍拒绝`1200.5`。初次四套定向回归158/158；后续检查发现整数金额末尾句点没有正确结束范围、每日修饰语与预算词分离后被误认，追加复现并修复：句点仅在左右字符均为数字时视为小数点；全程短答目标允许终止句点但不吞掉小数扩展；每日预算/目标的肯定口径拒绝，同额每日否定仅在同一句总额目标内允许。独立句的“不是每天”不得借前句总额；确切预算`1200.5`末尾句点可通过、权威`1200`仍拒绝`1200.5`。追加红测2失败/52通过（末尾句点正例）及4失败/53通过（含每日预算目标反例），最终 `backend npm test -- src/travel-guides/finalization.test.ts src/agent/dsh/reply.test.ts src/agent/dsh/service.test.ts src/agent/dsh/presentation-problems.test.ts` 四文件165/165通过。r17日志保留于忽略目录 `backend/output/d6/r17-budget-short-reply-red.log`、`r17-decimal-red.log`、`r17-budget-final-green.log`、`r17-budget-sentence-red.log`、`r17-daily-target-red.log` 与 `r17-budget-sentence-green.log`；未运行 Provider、数据库、浏览器或 build。

2026-10-07 r18预算否定范围：r17 seq95/seq129 的合法短答与概览曾因“全程预算”同句提到尚未确认费用、或“非每日预算”而误报 `excluded_precise_claim`。现允许权威 Trip 金额/币种在明确全程预算名词下复述（中文“全程预算1200元”、英文“whole-trip budget is CNY 1200”无需额外“目标”词）；否定只约束紧邻的费用/每日预算谓词。任何同句未被局部否定的已确认费用/票价或每日预算断言仍阻止金额豁免；“not only”不视为否定，且预算金额、币种、全程范围、票价、已确认花费、保证和每日肯定口径原限制不变。`backend npm test -- src/travel-guides/finalization.test.ts src/agent/dsh/reply.test.ts` 首次红测保留为6失败/159通过；加入单金额跨逗号/转折、括号与分号、中英费用与每日否定/肯定对照后，最终两文件182/182通过（finalization 117/117、reply 65/65）。日志保留于忽略目录 `backend/output/d6/r18-budget-negation-red.log` 和 `backend/output/d6/r18-budget-negation-green.log`。本批只验证离线文案分类；未运行 Provider、数据库、浏览器或 build，不代表完整 D6 验收通过。

2026-10-07 r19本地成本/官方核验说明：冻结 r18 的原文“1200元是整趟行程的总预算目标，实际花费以当地为准”与完整 overview 中“门票、营业时间与预约情况请以官方最新信息为准”均触发 `excluded_precise_claim`。回归确定全程预算目标本身已匹配；误拦来自同句/分号范围内任意 `cost` 词项触发的成本断言 veto。现只把紧邻的当地成本限定或官方事实核验关系作为成本不确定说明；同句其他肯定费用/票价、每日预算以及预算保证的原拒绝继续有效。真实 seq114 reply/overview、两条短预算句与“当地/官方说明后肯定费用/每日/保证”的对照加入回归。红测2文件3失败/187通过，最终 `finalization.test.ts` 125/125、`reply.test.ts` 65/65，共190/190通过；日志为 `backend/output/d6/r19-budget-red.log` 与 `backend/output/d6/r19-budget-green.log`。离线本地测试未运行 build、Provider、数据库或浏览器，不代表新的真实 H5 验收通过。

2026-10-07 r19独立复审收窄：独立复审发现“官方为准”若跨过“但/不过”或当地限定与同段其他费用/金额关系时，整段豁免会错误掩盖肯定价格。新增5条官方核验前后票价/费用、括号内另一个肯定费用以及当地限定后的肯定谓词反例；旧逻辑红测5失败/190通过。现按每个成本词项到紧邻尾随限定的关系判断：官方核验仅适用于其自己的列表/核验子句，当地限定必须是该费用谓词的完整尾项；同段其他明确金额及“并已确定”的肯定尾项仍拒绝。新的 focused suites 两文件195/195通过；红绿日志为 `backend/output/d6/r19-budget-scope-red.log`、`backend/output/d6/r19-budget-scope-green.log`。未运行 build、Provider、数据库或浏览器。

2026-10-07 r19官方核验列表边界：再加两条反例证明 `以官方最新信息为准` 不能作为任意成本词后的通用后缀；“门票费用就是这个金额请以官方最新信息为准”与“费用作为本次花费以官方最新信息为准”都应保留肯定费用判断。官方延期核验现只识别成本词项后明确列举的营业时间、预约/票务信息列表与官方核验谓词；未知或肯定费用内容不被最多字符数的通配符吞掉。旧逻辑红测2失败/195通过，最终 `finalization.test.ts` 132/132、`reply.test.ts` 65/65，共197/197通过；红绿日志为 `backend/output/d6/r19-budget-official-red.log`、`backend/output/d6/r19-budget-official-green.log`。未运行 build、Provider、数据库或浏览器。
