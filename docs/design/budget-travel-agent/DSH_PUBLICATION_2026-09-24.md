# DSH 主 Agent 集成发布（2026-09-24）

## 2026-09-26 同值 Trip setter 的持久确认

真实预算续验暴露：重复明确设置已经为1200的预算，Trip版本实际写入后，旧 `trip_context_update` verifier 因数值未变化仍判未交付。现在 core setter 只在独立读回与 canonical patch 结果一致后，为当前 owner/Trip/run/generation/写入版本持久保存实际提交字段的 SHA-256 回执；既有 Run JSON working set 承载，不新增表、Goal参数或模型输入。全部请求字段均在回执中且匹配当前版本/值才确认同值保存；完全无回执的历史记录继续使用原差异验证；已有回执缺请求字段或scope/值/版本失配则pending / trip_update_receipt_stale，不允许回落差异规则。不是以现有字段存在或模型宣称完成取代 verifier。

读回前后检查取消/当前generation，Run更新用原revision CAS；已取消/终态Run不能加回执。Trip可能已经写入但回执失败时保留真实写入并报告失败，不伪造事务回滚或satisfied。最终完成仍走共享 completion 的当前Trip版本和Goal/Run原子校验。working-set artifact/location合并保留已有回执，不能由新增引用覆盖回执。

离线4文件72/72通过（9.52秒）：同值真实工具写入→读回→receipt→shared completion satisfied；无receipt仍pending/partial；缺请求字段、错误值/版本/owner/run/generation/Trip拒绝；提交后取消、竞争写、返回值不一致及owner变化均无receipt；旧core、Goal和旧差异验证回归通过。backend `npm run check` 通过。首次沙箱spawn EPERM未启动，允许本地测试子进程后通过。本段不代表新的真实Provider/H5验收，未运行任何付费调用。

状态：后端应用函数、DSH 组合提交工具与离线测试已实现；本记录不代表真实 DSH/Provider 或全量 G1 通过。DSH 执行器接入、数据库及端到端结果由本轮总报告记录。

## 应用接口

`backend/src/travel-guides/finalization-service.ts` 导出 `publishIntegratedGuide({ ownerId, record, artifacts, locale, text, requirements?, memoryEnabled?, signal?, assertCurrent })`，返回保存后的 `ArtifactRecord`。`record` 必须是已通过既有领域验证、带空 `publication.finalization` 的隐藏攻略；调用者先将主 Agent 的文本映射为持久化的活动和来源身份，不能由该函数猜测或替换来源。`text` 作为 unknown 做严格 `FinalText` schema 校验，不接受 status/observation 等附加字段。

该函数复用 legacy `finalizeGuide` 的应用边界：重新读取 owner-scoped Artifact、校验 hash、按同 Trip/version 收集其他研究并保留反证、Memory 关闭时限制扩展来源会话、100 条上限不静默省略材料、同 owner/Artifact/hash/locale 合并并发、保存前重新检查当前业务状态和取消、交给现有 repository 做最终原子版本校验。必传 `assertCurrent` 由调用方检查当前 owner、Trip 和已采用航班；此应用函数不绕过这些领域校验。

主 Agent 的文本只通过 `validateIntegratedFinalText`。该纯程序校验与 legacy 共用 `prepareFinalization` 和 `textProblems`：稳定唯一活动身份、来源材料、practical 角色、同主体结构化 claim 冲突、输入字符和 omitted 围栏、严格日/活动顺序、精确 sourceRefs、当前语言、无占位、内部叙述、精确价格/耗时/门票/营业时间、预算保证及 URL 等。正常文本成为 accepted；失败文本置 null，保存具体 issues，公开投影保持空 days。它不替代领域 validator，不独立确认散文事实，也不承担额外语义模型审核。

2026-09-26 B09:50真实已接纳reply中的“整体预算仍在既定总额内”暴露表达漏检：旧检查没有识别无金额、无“保证”字样的总额满足断言。修复在同一纯函数补充有限中英预算保证表达，包括预算/费用/花费/支出/开销仍在既定总额内、控制在预算范围内、不超预算上限、符合/满足预算要求、预算肯定足够及`within the allocated total`等。检查覆盖所有公开字段（reply、overview、每日theme、活动name/introduction/recommendationReason），不局限reply；谨慎说明“预算只是目标，实际费用仍待核实，不承诺未知费用一定够”及只读权威预算确认仍允许。既有核心领域validator未放松，不加LLM或目的地特例，也不宣称正则能够穷尽自然语言中的无依据保证。

离线红绿验证先复现13项失败（2.75秒）：六类publication字段都错误accepted，以及七类表达漏检；修复后reply47、finalization49、DSH commit34、legacy finalization1，共4文件131项通过（7.94秒），backend类型检查通过。publication回归验证拒绝后text=null、公开days为空、零独立模型调用。该批未发真实Provider请求。历史accepted记录保持原样，不伪改数据库或追认合格；后续合法H5局部修改可在原baseGuideId/hash/replaceSlots约束下同时提交安全reply/overview，保留非目标槽位并产生重新验收的新guide。当前schema不支持零slot文字专用patch，不以本地化接口覆写已有中文接纳稿。

首次集成不启动模型、不修复重试、不自动本地化。已保存 variant 保持幂等；修订通过新的领域草稿进行，显式本地化和技术重试继续用既有有界接口。GET、刷新、地图和图片读取无变化。仅 publication 发生变化，不改活动、预算、日期、航班、Trip 或内容 hash；前端未修改。

## 组合提交与局部修改

`backend/src/agent/dsh/commit-guide.ts` 的 `createCommitGuideTool({ evidenceStore, locale, memoryEnabled? })` 创建 `commit_travel_guide`。它以 `withGoalIntent` 接受既有 travel_guide Goal/Run，主 Agent 一次给出 days 与最终文字。日程 items 的 `activityKey` 与 `text.activities[].activityKey` 精确对应；存储产生真实活动身份后，服务端映射 `activityId/sourceRefs`，模型不需要猜 UUID，也不能提供 publication accepted 状态。locale 来自后端创建工具时的当前请求，不由模型覆写。

2026-09-26 warm followup协议补正：DSH advertised commit rawSchema以`anyOf`要求`intent`或`goalRef`至少一个，实例description要求每次完整提交（含修复）显式携带本轮目标，不再附带共享wrapper“later operations ... without repeating it”的相反提示。新turn的可信snapshot在publicHistory之后收尾写入`acceptedGoal=null`、空currentEvidenceRefs和简短作用域说明；旧raw refs无效，候选只能来自当前snapshot/read_artifact，或本轮web_search/web_fetch。共享withGoalIntent、legacy schema、公开API、一次修复限额不改；省略字段的同bound runtime仍兼容，重复相同intent或同goalRef只复用一个Goal，改参数仍拒绝。此为模型协议提示与已有执行验证的对齐，不生成intent、不伪造/迁移raw refs。

该批离线验证：commit34、service5、shared goal-intent13，共3文件52项通过（14.63秒），backend类型检查通过。新增回归覆盖相同intent、合法同Goal引用、无参数bound runtime三种修复均只accept一次；官方DSH worker/AgentLoop fixture实际接收新增schema，service确认turnState在snapshot末尾，既有更改约束拒绝与legacy Goal测试保留。首次测试启动被沙箱spawn EPERM阻止，允许本地测试子进程后通过；没有真实Provider/H5调用，不能据此宣布本次live修复通过。

新材料通过可选 `candidates[{key,evidenceRefs,title,summary,category,locationId}]` 提交。可信地点取当前 Trip 和已解析地点账本；evidenceRef 由本轮 Store 加载，转成既有 ResearchArtifact，先过现有来源/schema 检查，保存一次，再将 candidateKey 映射为持久候选引用。相同本轮材料的有界失败重试复用该 ResearchArtifact；可完全省略 candidates 并复用已有 candidateRef。没有调用旧 AgentRuntime、CloudPlannerService、ResearchAgent、synthesis 或独立 Finalizer。辅助资料用 supportingRefs 或 supportingCandidateKeys；现有类别、日期、Trip/航班及领域 validator 继续生效，不自动降低 allowPartial/requiredEvidenceTypes 等已接受约束。

日程通过未包装的 `saveTravelGuideTool` 写入隐藏攻略后才调用集成 publication。只有 publication accepted 才返回成功并进入共享 Goal completion；日程拒绝或文字 blocked 抛出 `DSH_GUIDE_NEEDS_REVISION`，details 保留具体修正反馈，Goal 不能因此提前 satisfied。执行器须把此有界反馈传回同一主 Agent，并执行全轮的修复次数上限；本工具不自行重试。主 Agent 的实际成本与源查询数另行计量，工具调用不能当作事实认证。

2026-09-25真实commit探针暴露一次可修输入错误：模型把6个已安排活动与2个辅助practical候选都写进text.activities，严格exact-cover校验正确拒绝，但原错误没有details且执行器未传递message，主模型只得到错误code而无法定位。现保留原校验，给此错误增加`activity_text_exact_cover`结构化详情：required/submitted/unexpected/missing/duplicateActivityKeys及repairHint；text.activities的公开schema同时说明只能写已安排活动，局部修改只写替换活动，practical/辅助候选放supportingCandidateKeys或supportingRefs，不需要活动展示文字。执行器只对服务端`DSH_GUIDE_NEEDS_REVISION`将message并入details.hint，已有结构化详情保留；其他provider/runtime错误不因本修复暴露任意message。该反馈仅供主模型修复，不进入公开回复，不增加提交次数或降低领域/publication校验。

执行器最多接受两次组合提交（一次修复）。失败回复只有在本轮确实写入攻略 Artifact 后才能称草稿已保存；在意图/参数/来源检查前失败则只报告未能发布。组合提交成功后，执行器从已保存 Artifact 的当前语言 accepted variant 读取 reply，而不是采纳工具回包的任意 reply 字符串或主模型后续自由文本；该回复与 publication 公共投影一致。最终返回引用同时核对当前 Trip version、接纳语言和 flight revision，取消后不追加成功回复。

### 解释和澄清的轻量公开边界

无组合提交的回合继续回答当前问题，不套用“攻略已保存”。`publicProseProblems` 抽取原 finalization 的纯程序表达检查，攻略仍保留原有身份、来源、语言长度与发布要求；DSH 解释/澄清调用 shortReply 模式，允许“哪一天？”等简短回复和原语言地点名称。边界拦截错误语言、内部旁白/调试/系统提示词/工具名、内部 UUID/hash/地点身份、无支持的精确价格、营业时间、交通耗时、免费/全年开放及预算保证。它不是事实验证器或复杂语义 critic，不追加 LLM 或自动修复调用。

普通回复可复述当前权威 Trip 的两天总预算，例如 `Your current budget is CNY 1200 in total for two days.` 或“总预算是1200元”；仅对明确预算短句中与当前 amount/currency 完全相同且 scope=trip 的金额放行。它不放行不同金额、门票/费用声明或预算可满足保证。检查失败时，原自由文字既不返回也不写入公开 Conversation；替换成当前语言固定提示“这次未能给出合适的说明，请换一种方式描述你想了解的问题。”或对应英文，并在原有 warnings/消息 metadata 中记录 `dsh_reply_withheld`。不修改 Trip/Artifact/Goal/Run、不伪造保存或 accepted，前端和公开 API schema 不变。

局部修改必须提供 `baseGuideId`、`expectedContentHash` 与 `replaceSlots[{day,slot}]`，slot 为 morning/afternoon/evening/flexible。服务器读取同 owner/Trip/version 的已接纳底稿，核对内容 hash 和当前已采用航班，要求指定槽位原本存在。输入 days 仅允许修改这些槽位的 items；越界槽位和重写受保护活动文字直接拒绝。其余活动、顺序、日城市/kind/theme/notes、辅助证据及对应接纳文字从底稿恢复，不使用模型提供的替代元数据；新保存结果还逐项比较受保护活动，意外变化不得发布。因此“仅修改第二天下午”不会靠 prompt 保护第一天和第二天上午。日期/预算/航班继续从当前权威 Trip/workspace 生成，旧攻略保持原样，修改产生新的攻略 Artifact/content hash。

同一次 IPC 重放/请求级幂等由执行器提供；该工具声明 state/非并行。领域写入与 publication 是分阶段提交，取消或文字失败可留下隐藏草稿与材料，但不会覆盖底稿或将 blocked 文字公开，也不自动回退调用其他引擎。

### 明确休息日的输入合同（2026-09-25）

组合工具的公开 `days[].items` schema 现在明确已有领域条件：没有来源活动的休息/交通日必须使用 `kind=rest/travel`、提供有实际安排含义的 `notes`，并且在符合用户请求时由已接受的 travel_guide intent 设置 `allowRestDays=true`。普通 visit 日仍需来源活动，至少一个实际活动的全攻略要求不变；服务端没有放宽 coverage validator 或自动改写意图。最小两日 probe 可以包含第一天文化景点和第二天休息，但不能省略这些条件。

新增组合提交回归覆盖允许休息时 publication accepted/Goal satisfied，以及未允许休息、缺少休息说明时保持拒绝且无攻略写入。`npm test -- src/agent/dsh/commit-guide.test.ts`：17/17 通过，2.82 秒；首次沙箱内 esbuild spawn EPERM，允许启动离线测试子进程后通过。无付费调用，不是新真实 Provider 或 H5 验收。

## 验证

- `npm run check`：通过。
- `npm test -- src/travel-guides/finalization.test.ts src/agent/cloud/finalization.test.ts`：44/44，通过，Vitest 3.33 秒。其中新增 17 项覆盖中英集成发布、零独立模型调用、幂等、隐藏错误语言/来源/活动身份/无依据价格与耗时/占位/schema、材料缺失/practical/字符预算/omitted、已取消和保存前取消、Trip/航班回调变更、内容 hash 和 owner 范围、要求隐藏草稿。其余为 legacy 回归。
- 组合工具接续：`npm test -- src/agent/dsh/commit-guide.test.ts src/travel-guides/finalization.test.ts src/agent/cloud/finalization.test.ts`，56/56，通过，4.57 秒。新增 12 项执行真实领域保存与共享 completion（内存仓库），验证 publication 后才 satisfied、研究只保存一次、无独立研究、失败保持 pending、复用候选零新增研究、第二天下午局部修改保护、hash/越界 slot/受保护文字拒绝、错误证据/地点、取消、过期执行、真实 Trip 版本变化及航班守卫。
- 初次运行在沙箱内因 esbuild 子进程 `spawn EPERM` 未启动；授权同一离线命令后，首次 43/44（变更 hash 测试误加非法 summary 字段）失败，修正 fixture 后以上 44/44 通过。没有压低断言或绕过发布校验。
- 公开回复边界：`npm test -- src/agent/dsh/reply.test.ts src/agent/dsh/service.test.ts src/agent/dsh/multi-turn.test.ts src/travel-guides/finalization.test.ts src/agent/cloud/finalization.test.ts`，最终5文件77项通过，9.56秒；其中30项纯表达用例、真实官方 fixture worker 的拒绝/中文简短澄清/持久公开消息与零额外调用验证，以及成功发布后恶意 debug/价格/预算保证自由文字必须被 accepted reply 覆盖的多轮回归。此前74项通过后新增混合错语言、think标签及总预算不得改成per-day共3项，再跑上述最终结果。`npm run check` 通过；首次类型检查指出 exactOptionalPropertyTypes 的可选预算 undefined，改为显式 null 后通过。无付费调用。
- exact-cover有界修复：`npm test -- src/agent/dsh/commit-guide.test.ts src/agent/dsh/multi-turn.test.ts src/agent/dsh/service.test.ts`，3文件16项通过，7.35秒；新增practical文字误入activities用例确认首败无Artifact写入且Goal pending，删去多余文字后保留两个supporting候选并发布accepted；真实官方fixture worker多轮用例确认结构化详情及hint穿过service/IPC、只修一次即可发布，后续自由文字仍不能覆盖accepted reply。`npm run check`通过。此为离线修复验证，不声称真实commit重试已通过，费用0。

以上均为离线内存仓库及确定性模型 fixture，不代表新的 PostgreSQL/真实模型/搜索验证；费用为本子任务无外部调用。集成 variant 的调用数为 0 只计本程序阶段，实际主 Agent 成本必须保留于其独立观测。

## 跨轮原始来源引用的精确修复（2026-09-25）

真实execution `5806fe88-98a9-472b-820b-a661691774c5` 已调用组合提交，但一个候选混合本轮来源与上一generation的原始evidenceRef。Store按generation拒绝旧引用是正确边界；原转换抛出普通Error，执行器只回传`DSH_TOOL_FAILURE`，下一模型准入又被本轮次数上限拒绝，故没有发布。这次失败与exact-cover错误不同，不能算作真实accepted。

组合工具现在在保存ResearchArtifact前检查提交的每个引用，失败返回`DSH_GUIDE_NEEDS_REVISION`及`candidate_evidence_unavailable`详情，逐候选列出提交中不可用的引用；不读取或披露其他owner/Trip/generation的元数据。repairHint要求仅在剩余当前证据足以支持该候选时删去旧引用，否则获取本轮材料，或改用已有ResearchArtifact的candidateRef。公开schema也说明原始引用限当前轮及最新Trip版本。隔离、已有Goal约束、publication检查与最多一次修复均不变，服务端不自动删除引用、迁移来源或降级验证。

DSH persona明确：上轮未完成Goal与missingFromPreload/missingByDestination只是历史目标或材料库存，不能自动成为当前用户必需项。当前用户收窄目标时，由同一主Agent提交符合当前请求的新intent；只有参数匹配才能用goalRef，不能静默改写或降低旧Goal约束。这里不解析关键词、不改shared planning-context或legacy行为；也不声称仅靠提示词已证明真实模型行为达标。

离线验证：`npm test -- src/agent/dsh/commit-guide.test.ts src/agent/dsh/multi-turn.test.ts src/agent/dsh/evidence.test.ts src/agent/dsh/evidence-file.test.ts`，4文件25项通过，7.69秒；`npm run check`通过。新增混合当前/旧generation来源拒绝且零Artifact写入、原Goal保持pending、精确去掉旧引用后同Goal accepted；真官方fixture worker验证错误详情经过执行器与IPC、一次改用持久candidateRef后发布、随后解释零新增写入及冷恢复。所有测试均离线，费用0，不替代真实重试。

## 原始证据与 Goal 可信度合同（2026-09-25）

第五次真实最小 commit probe（execution `1f188617-da9a-4f4b-9ea8-e0ecc8863430`）已取得 gotokyo 正文及可用 evidenceRef；26.600 秒、6 次主模型调用和 1 次官方搜索后仍未接纳，本次未知费用预留 US$0.36，累计98模型准入/33搜索/US$6.56未知预留。主 Agent 首次提交选择了 `allowPartial=false`，而 DSH 原始证据转换固定保留 `partially_verified`，因此领域 validator 正确返回 `verified_evidence`；已接受 Goal 随后不能在同轮降低要求。这次失败没有变成 accepted，不属于搜索或正文获取失败。

`commit_travel_guide` 公开描述现明确：原始联网材料仅为带来源、未独立核实的参考；普通基于研究的旅行安排应在首次接受 intent 时设置 `allowPartial=true`，保留既有不确定性提示。若用户明确要求独立核实的事实，当前路径不能满足，应解释限制并澄清，不能提交或降低已接受 Goal。本变更不自动覆盖模型参数、不改证据状态、不降低 validator 或放松 Goal 不可变约束。

新增回归验证 `allowPartial=false` 必须拒绝原始材料、无攻略 Artifact 写入且 Goal 保持 pending；同轮改成 true 继续因 `GOAL_INTENT_CONFLICT` 拒绝，原参数保持 false。既有普通研究提交成功测试继续覆盖 true 分支。`npm test -- src/agent/dsh/commit-guide.test.ts`：18/18 通过，7.40秒；无付费调用，不替代下一真实 probe 或 H5 验收。

## 终稿金额表达反馈（2026-09-25）

第六次真实最小 commit probe 获得可用来源且首次 intent 正确设置 `allowPartial=true`，但 overview 重复用户的 `1500元` 预算目标，现有发布表达检查返回 `excluded_precise_claim`。同轮模型只删去交通耗时，保留该金额，故第二次提交仍 blocked；本次33.785秒、7次主模型及1次搜索、US$0.40未知费用预留，原账本累计106模型准入/34搜索/US$6.96未知预留。不是 accepted。

DSH工具描述及overview公开schema现与既有Finalizer指令对齐：终稿所有文字省略金额（包括预算目标），权威预算由现有UI独立展示；同时不写精确时刻、分钟/耗时等。`excluded_precise_claim`返回新增具体repairHint，明确检查reply、overview、每日主题和活动文字中的预算金额以及时刻/分钟，让同一主Agent仅修被拒文字。服务端不替换或裁剪文字、不追加LLM、不改validator或增加修复次数。

新增离线用例复现预算目标被拒、隐藏blocked文本、Goal pending；主Agent输入删除金额后可在同Goal发布，活动和研究来源保持相同。`npm test -- src/agent/dsh/commit-guide.test.ts`：19/19通过，5.31秒；无付费调用，不替代真实重试或H5验收。

## 同轮完整修复与已接纳攻略局部修改的区分（2026-09-25）

真实H5 A重试2（execution `2ebd27ec-3786-4608-8004-59ccf96195db`）将同一`asakusa_area`候选用于三个时段，被既有`guide_duplicate_evidence`拒绝。随后legacy保存函数的`repair.draftRef/revision`透传给DSH，主模型将其误作已接纳`baseGuideId`并编造全零hash、未重交days，第二次也失败；没有accepted产物。

组合工具现将领域保存反馈映射成DSH自己的输入合同：保留issues/details/requirements及availableCandidates，删除不受DSH工具支持的legacy `draftRef/revision`，替换为完整重交days/text的明确提示。重复finding反馈说明每个实际安排须用不同候选；同一原始来源可支持多个真实不同地点/体验，但不能只改key重复同一活动。公开candidateKey/candidateRef schema也明确不能跨时段复用finding。首次攻略同轮修复不需要baseGuideId/hash/replaceSlots；仅修改真正已接纳攻略时才使用实际持久身份/hash，仍只提交受允许的替换范围。validator、来源约束和最多一次修复不变，没有自动改候选、写死攻略或忽略重复项。

新增离线回归：同一finding跨三时段先拒绝、反馈不含legacy草稿token；同轮完整重交不同真实候选（共用一个支持材料）可accepted/satisfied，不需任何base字段且只保存一份research。`npm test -- src/agent/dsh/commit-guide.test.ts`：20/20通过，1.98秒；无付费调用，不替代正式H5真实重试。

## Workspace结果引用与隐藏草稿（2026-09-25）

正式H5 `A-round-1-2026-09-25T13-59-21-417Z` 已通过DSH生成并持久接纳攻略 `01a0d8de-2690-7589-b437-e2adc39ad11a`，delivery=satisfied；但workspace返回最新优先的全部Artifact，包含前一次被拒草稿 `01a0d8de-0322-76b9-9d9b-1a8a41a94cc5`。现有前端将新引用追加并选择最后一个攻略，因此打开了隐藏草稿，尚未证明页面显示成功。

后端workspace现仍读取最新100条Artifact窗口，但公开`artifactRefs`按创建先后（旧→新）返回，与正式前端既有选择合同一致。存在finalization但没有任何accepted语言、且未被当前会话assistant消息显式公布的初始草稿不进入结果引用；底层Artifact不删除，审计和有权读取仍可访问。另一语言已accepted的攻略仍可见，当前语言缺失或blocked时继续提供显式本地化/重试入口；legacy没有finalization的攻略及assistant已公布的失败攻略继续兼容。公开字段形状和前端源码不变，GET不调用模型或搜索。

新增PostgreSQL回归覆盖accepted后出现更晚的内部草稿、多个accepted版本的旧→新顺序、legacy攻略和显式失败引用保留、中文已accepted但英文blocked仍能恢复。最初3/3通过21.27秒，类型检查通过；9月26日增加预算继承用例后4/4通过15.73秒。恢复历史缓存污染须通过正式重新进入Trip替换workspace引用，不靠重发规划或伪造UI状态。

## 仅预算更新后的攻略版本继承（2026-09-26）

正式H5第四轮将Trip总预算更新到1200 CNY、说明不保证未知费用；Trip由v1到v2，旧攻略正确成为过期状态，但没有当前版本攻略可刷新或本地化。`budget-guide.ts`现提供DSH专用领域继承：仅显式`update_trip_context`含budget时调用，GET/刷新不触发。它读取同owner的持久历史Trip快照，除预算/version外要求结构字段完全相同；notes仅允许预算目标/口径/不确定费用提醒的有限词汇子句变化，其余中英分句必须原样保留。日期、活动、交通、地点等额外notes仍拒绝。

继承需要同会话已accepted底稿、原Goal约束和相同航班选择。服务器为已选研究创建当前版本副本，保留原正文、检索时间、hash及verification，sourceArtifactIds回指旧研究；只在该精确副本创建边界使用既有来源兼容回调，并核对旧source的Trip/version/payload指纹。新route/guide使用当前版本研究身份，活动ID、顺序、时段、文字不变，sourceRefs映射到真实新研究身份，预算快照取当前Trip。新travel_guide Goal继承原要求，独立于更新Trip的Goal；调用原`validateGuideContent`、`publishIntegratedGuide`和completion，所有既有accepted语言重新经过纯程序发布检查。没有复制accepted状态、重估事实、搜索、额外LLM或Finalizer。

历史读接口`getAtVersion`按owner/Trip/version查询，不开放公开API；内存仓库也保留不可变版本用于离线验证。取消、Trip/航班竞争在写前及发布前检查，失败会关闭该派生Run；旧记录不改。当前版本已有同活动accepted攻略时不重复写；相同预算的显式写入若仍推进Trip版本，也须重新检查并产生相应当前版本副本，避免下一次重复更新再次使攻略过期。

验证：最初14项helper离线通过2.75秒；加v1→v3已有更新恢复后与组合提交共35项通过5.77秒；PostgreSQL4/4通过15.73秒含新Goal satisfied、来源副本真实谱系、其他owner无法读历史、workspace顺序。最新重复同预算版本与取消Run收尾增量结果由后续本批记录补齐。类型检查通过。以上不替代真实H5预算重试。

## 回滚与边界

本增量不迁移数据、不改公开 schema、不增加前端要求。保留 legacy `finalizeGuide`、`GuideFinalizer` 和已有本地化入口。回滚 DSH 调用方至 legacy 即可；已保存 FinalVariant 沿用 publication v1，仍可被现有读取路径投影。数据库的 owner/Trip/航班/hash/revision/signal 校验未被弱化。


2026-09-26真实H5局部修改首尝试保留为失败：Agent先遗漏新轮intent，再引用已satisfied旧Goal，并带入上轮raw evidenceRef；领域拒绝后触及两次commit上限，原攻略未变。现将新轮无acceptedGoal/无raw evidence的真实状态写入每轮snapshot，并明确已接纳攻略的编辑须新travel_guide intent，只有同轮已接纳后才可省略；替换地点仅复用真实匹配candidateRef，否则先补当前轮原始证据。不提高重试次数、不复活旧Goal、不降低来源作用域。此为指令修复，真实续验另记D4报告。
2026-09-26上述指令修改后的官方worker离线服务/多轮回归2文件4项通过（8.77s）；包括跨轮旧证据拒绝、有限修复、当前问题回答与持久resume。首次沙箱运行因spawn EPERM未启动，授权重跑通过；不据此认定真实局部编辑通过。
2026-09-26工作区PostgreSQL定向3/3通过（11.28s）：自备机票、已采用航班旧路径，以及按创建顺序恢复/隐藏未公开草稿/保留其他语言与旧失败重试入口。测试使用原测试库内临时隔离schema；真实E2E schema保留。

2026-09-26预算衔接接入位置为DSH update_trip_context成功后的预算patch分支：选当前会话最新已接纳终稿，纯程序检查历史Trip仅预算及有限预算备注变化后重建当前版本派生攻略，复用原内容与真实来源并重新执行领域和publication检查。GET、刷新、本地化不调用此操作；父trip_context_update Goal不被偷换，派生travel_guide Goal独立记录。无法证明兼容则保持过期状态，不能将旧accepted标志直接搬成新accepted。验证及真实结果待补。

2026-09-26 H5预算恢复追加：08:10 UTC真实重试时当前Trip已1200，模型仅回答、未调用update_trip_context，故旧攻略仍stale，保留失败记录。显式设置/确认保存预算的指令现要求调用领域更新（即使值相同），让已实现的严格预算变更校验处理历史失败恢复；纯询问当前预算仍只读。未直接改Artifact状态、未跳过发布检查。

2026-09-26预算派生取消增量验证：17/17 helper测试通过（6.00秒），新增研究副本刚保存即取消的负例，确认派生Run为cancelled、不发布攻略回调、旧accepted攻略保持原样。该验证不发Provider请求。

2026-09-26同值确认语义：当正式Trip已经是目标预算且当前版本攻略accepted，重复预算请求可只读确认，delivery保持not_requested/responded，不伪造新写入satisfied，也不强制提升版本。旧攻略stale时仍需真正领域恢复。此前真实setter satisfied、恢复accepted和后续确认分别留证。公开表达检查新增精确已知预算的否定每日口径例外（如不是每天1200元），要求存在总预算语境且不是票价/费用子句；不同数字、肯定每日金额、门票金额仍拦截。36项回复边界测试通过0.935秒。

2026-09-26真实PostgreSQL回执回归：在原loopback测试库的唯一临时goals schema完成真实core同值setter→Run JSON回执落库→全新repository实例读取→共享completeGoal持久satisfied；后续新版本以及预算被其他写入改为1300均不能借旧回执继续认完成。首次新增负例实际失败（6.06秒），发现有回执失配仍回落旧差异规则；收紧后整个Goal PostgreSQL文件12/12通过（7.14秒），离线4文件72/72再次通过（6.46秒）。只清理该临时schema，未触碰保留E2E schema、未发Provider请求；旧无回执行为仍有明确回归。


## 2026-09-26 同轮发布文字修复复用已登记候选

已采用航班B首轮真实失败定位：首次commit已把真实来源转换并持久保存research，但publication拒绝reply中的预算金额/精确时刻。主Agent按反馈只修文字并重交完整days、省略candidates；旧工具每次执行重建空candidate key映射，第二次错误报Candidate key unavailable。该失败及费用保留，不能当作Provider失败或增加修复轮数。

现 `createCommitGuideTool` 在单个实例内仅保存当前owner、Trip、conversation、generation、contextVersion、Goal/Run及完整selectedFlight指纹对应的候选映射。只有research实际持久成功并通过checkpoint后才登记 key→真实candidateRef；同scope文字修复可以省略candidates，领域工具仍重新从真实持久来源解析并执行完整攻略/发布校验。scope变化清空候选与research缓存；显式新candidates重新验证每条当前scope evidence并替换整个映射，不混入旧key。新工具实例不继承缓存，跨轮复用仍必须使用持久candidateRef。保存失败或取消检查未过不能登记，未改变两次commit上限、Goal参数、validator或公开API。

离线commit-guide 30/30通过（2.40秒）：真实领域format拒绝包含4000元/12:30的reply与预算overview，第二次省略candidates、保留完整days并仅修文字后同Goal/同research达到accepted+satisfied；owner/Trip/conversation/generation/version/Goal/Run/flight任一scope变化均拒绝旧key；显式候选替换不合并旧key；research保存失败不登记。未发Provider请求，真实B重试结果由既有D4报告单独记录。


## 2026-09-26 DSH 持久Goal请求标识隔离

B 09:05 UTC真实失败根因已通过原测试schema只读查询确认：08:52 generation `01a0dcea-9a5b-72f0-936f-12abe473648e` 与09:05 generation `01a0dcf6-81d1-705d-80fe-ffdc94a2b6fb` 的Conversation审计都记录Fastify `request_id=req-i`。旧DSH直接将HTTP requestId用于Goal acceptance；相同hash key `accept:764919e66198aa58b82d78e088c5249c2c5c8219be6ccedc496258a144d14580` 已绑定前者的satisfied `trip_context_update` Goal，后者travel_guide提交被现有PG参数指纹校验正确拒绝。不是模型传入旧幂等key，也不是provider错误。脱敏数据库证据见[请求标识证据](dsh-e2e-evidence/goal-request-identity.json)。

正式Agent路由每轮使用服务端uuidv7 generation，但HTTP `request.id`可能在进程重启后重复，也允许来自x-request-id header。仅DSH工具上下文现在用 `dsh-turn:SHA256([ownerId,tripId,conversationId,generationId])` 作为durable request identity；HTTP ID仍原样留在Conversation审计metadata。新generation不继承旧Goal幂等key，同generation/scope无论HTTP ID变化仍同key；同generation改变已接受参数继续冲突。legacy路径、公开API和共享Goal validator均不改，不修改任何旧Goal/Run或既有idempotency key。

验证：service5/5通过（5.81秒），真实官方worker fixture连续两代复用同req-i，分别实际setter持久两个Goal并satisfied；同代Run acceptance重放同记录、改约束仍拒绝、owner/Trip/conversation/generation作用域各自隔离。多轮官方worker2/2在组合跑中通过；首次组合新增测试fixture误将ownerId作为strict acceptance输入，1项失败后修复fixture并定向重跑通过，未改生产validator。backend类型检查通过。诊断只读原E2E schema，未跑新Provider或更改真实Goal状态。


## 2026-09-26 预算回复的只读历史恢复

A正式预算API曾返回正确确认，但workspace GET依据attached carryforward guide引用，无区别地把该消息正文投影为旧攻略publication.reply。现history边界只对DSH、completed、trip_context_update/satisfied且不含travel_guide交付的assistant消息，复用现有`publicProseProblems`检查当前locale及owner-scoped当前Trip预算；通过后恢复原预算确认文字，保留Artifact引用与delivery，不改持久Conversation。未通过时返回当前语言的安全短说明，即使没有Artifact引用也不裸露不合格文本。真正攻略交付仍取accepted publication.reply，legacy投影不放开。

workspace读取沿用已有当前Trip JSON为history scope提供权威budget；正式conversation/messages GET从现有认证owner的Trip repository只读获取budget。金额不来自message metadata或模型，旧金额、无依据保证、内部debug和错误语言不会因carryforward引用而绕过检查。没有改Agent运行、公开API形状或新增模型调用。

验证：history/正式cloud-state离线19/19通过（6.40秒），包含安全预算正文保留及错locale、错预算、保证、debug、legacy、partial、错误stop、真正guide消息负例。workspace PostgreSQL4/4通过（8.14秒），真实carryforward后append预算确认与附带新guide，fresh repository恢复正确文字/引用/交付；不安全保证被屏蔽、英文恢复不输出原中文、DB原文保持。backend类型检查通过。只使用独立临时schema，未触碰E2E数据或Provider；真实A刷新需在父任务重启加载后另行验证。

## 2026-09-26 研究历史读取的复用状态

B09:19实际失败先复用了warm历史中的旧版本candidateRef，现有保存版本校验正确拒绝。`read_artifact`原本已不为旧研究生成当前候选，但缺少显式状态，模型仍可能把历史正文当作新攻略输入。研究读取现在增加仅模型工具可见的`researchReuse`：`current_candidates`、`historical_only`或`unavailable`，携带`sourceTripContextVersion`、`currentTripContextVersion`和服务端notice，缺失版本为null。旧版本正文仍允许历史只读，无`candidates`，notice明确没有可用于新攻略的candidateRefs，禁止从历史消息复用或重构引用；应读取当前候选或补当前证据。当前候选只说明版本匹配，不认证来源新鲜度或publication已accepted。

未改公开HTTP合同、Artifact内容或保存校验；owner认证仓库与Trip匹配仍在任何内容/复用状态返回之前执行。定向回归3文件77/77通过（8.37秒）：authored guide30、旧Runtime44、正式cloud-state3；新增当前候选与状态一致、Trip升版后历史正文不变/候选消失/明确警告，以及跨owner/Trip不暴露正文或状态。backend TypeScript检查通过，无真实Provider调用。该工具提示本身不代表后续B accepted或多轮验收通过。

2026-09-26 B09:31真实提交首轮重复候选、第二轮预算金额文案拒绝、第三轮修复次数拦截。组合工具现仅在领域拒绝反馈中复用publicProseProblems，一并给出presentationIssues和对应修复提示，使一次修复同时处理候选与文案问题；不改变保存或最终publication校验、不新增LLM或增加commit上限。新增回归验证双问题首次同时报告、无攻略保存，并在同Goal一次修复后真实accepted/satisfied。真实续验结果仍需单独记录。

## 2026-09-26 正式图片按钮诊断边界

B攻略`01a0dd2b-9099-706d-bd2e-5cbc37fd25f6`的文字已accepted，图片是独立enrichment。此前页面仅GET media，返回200且activities为空，未自动搜索照片。10:07实际点击现有“补全 / 重试图片”后，隔离验收runner把media POST挡成403 `DSH_E2E_READ_ONLY`；已在原serve-execute及全部probe门禁内精确允许UUID artifact的media POST，并补本隔离进程缺省MEDIA_USER_AGENT。没有修改产品UI、用户base env或全局代理。

10:11重启加载后再显式点击一次，正式media POST返回200，但全部4项`mediaStatus=empty`、`media=null`，真实照片DOM=0。只读原测试schema所得持久原因如下：

| 当前活动 | 媒体原因 | 含义 |
| --- | --- | --- |
| 上野恩赐公园一带的文化散步 | source_identity_required | 尚无已解析POI，来源也不是唯一可核对的Wikipedia实体页 |
| 上野站旁的露天市场小吃 | source_identity_required | 同上，不能按名称搜索随意选图 |
| 浅草寺与雷门 | ambiguous_or_unsupported | 当前组合地点命名触发现有多个地点/不支持身份保护 |
| 上野室内文化场馆 | source_identity_required | 尚无已解析POI或唯一Wikipedia实体来源 |

这些结果在Wikimedia网络读取前返回；没有Wikimedia请求，也没有远程照片下载或解码失败，不能靠重试网络解决。保留严格实体匹配、许可和原图校验，不新增POI实施或替换随意图片。**runner的403已修，照片实际显示仍未成功**；accepted文字与整个DSH主链不因图片缺失而失效。两个按钮动作各仅1个media POST，0新Agent turn/模型/搜索；各自动作前后原账本完全相等，Trip、guide、route、flight不变。

原证据留在`output/playwright/dsh-e2e-20260924`：`B-media-2026-09-26T10-07-37-491Z.json`（403及页面错误截图）、`B-media-2026-09-26T10-11-36-357Z.json`（200空结果、图片网络/解码观测及截图）与同名前缀`-reasons.json`（只读DB原因）。由既有D4报告归档，不改写前次失败、不给空结果标记图片PASS。
