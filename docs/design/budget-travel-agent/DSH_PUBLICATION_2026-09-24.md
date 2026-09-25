# DSH 主 Agent 集成发布（2026-09-24）

状态：后端应用函数、DSH 组合提交工具与离线测试已实现；本记录不代表真实 DSH/Provider 或全量 G1 通过。DSH 执行器接入、数据库及端到端结果由本轮总报告记录。

## 应用接口

`backend/src/travel-guides/finalization-service.ts` 导出 `publishIntegratedGuide({ ownerId, record, artifacts, locale, text, requirements?, memoryEnabled?, signal?, assertCurrent })`，返回保存后的 `ArtifactRecord`。`record` 必须是已通过既有领域验证、带空 `publication.finalization` 的隐藏攻略；调用者先将主 Agent 的文本映射为持久化的活动和来源身份，不能由该函数猜测或替换来源。`text` 作为 unknown 做严格 `FinalText` schema 校验，不接受 status/observation 等附加字段。

该函数复用 legacy `finalizeGuide` 的应用边界：重新读取 owner-scoped Artifact、校验 hash、按同 Trip/version 收集其他研究并保留反证、Memory 关闭时限制扩展来源会话、100 条上限不静默省略材料、同 owner/Artifact/hash/locale 合并并发、保存前重新检查当前业务状态和取消、交给现有 repository 做最终原子版本校验。必传 `assertCurrent` 由调用方检查当前 owner、Trip 和已采用航班；此应用函数不绕过这些领域校验。

主 Agent 的文本只通过 `validateIntegratedFinalText`。该纯程序校验与 legacy 共用 `prepareFinalization` 和 `textProblems`：稳定唯一活动身份、来源材料、practical 角色、同主体结构化 claim 冲突、输入字符和 omitted 围栏、严格日/活动顺序、精确 sourceRefs、当前语言、无占位、内部叙述、精确价格/耗时/门票/营业时间、预算保证及 URL 等。正常文本成为 accepted；失败文本置 null，保存具体 issues，公开投影保持空 days。它不替代领域 validator，不独立确认散文事实，也不承担额外语义模型审核。

首次集成不启动模型、不修复重试、不自动本地化。已保存 variant 保持幂等；修订通过新的领域草稿进行，显式本地化和技术重试继续用既有有界接口。GET、刷新、地图和图片读取无变化。仅 publication 发生变化，不改活动、预算、日期、航班、Trip 或内容 hash；前端未修改。

## 组合提交与局部修改

`backend/src/agent/dsh/commit-guide.ts` 的 `createCommitGuideTool({ evidenceStore, locale, memoryEnabled? })` 创建 `commit_travel_guide`。它以 `withGoalIntent` 接受既有 travel_guide Goal/Run，主 Agent 一次给出 days 与最终文字。日程 items 的 `activityKey` 与 `text.activities[].activityKey` 精确对应；存储产生真实活动身份后，服务端映射 `activityId/sourceRefs`，模型不需要猜 UUID，也不能提供 publication accepted 状态。locale 来自后端创建工具时的当前请求，不由模型覆写。

新材料通过可选 `candidates[{key,evidenceRefs,title,summary,category,locationId}]` 提交。可信地点取当前 Trip 和已解析地点账本；evidenceRef 由本轮 Store 加载，转成既有 ResearchArtifact，先过现有来源/schema 检查，保存一次，再将 candidateKey 映射为持久候选引用。相同本轮材料的有界失败重试复用该 ResearchArtifact；可完全省略 candidates 并复用已有 candidateRef。没有调用旧 AgentRuntime、CloudPlannerService、ResearchAgent、synthesis 或独立 Finalizer。辅助资料用 supportingRefs 或 supportingCandidateKeys；现有类别、日期、Trip/航班及领域 validator 继续生效，不自动降低 allowPartial/requiredEvidenceTypes 等已接受约束。

日程通过未包装的 `saveTravelGuideTool` 写入隐藏攻略后才调用集成 publication。只有 publication accepted 才返回成功并进入共享 Goal completion；日程拒绝或文字 blocked 抛出 `DSH_GUIDE_NEEDS_REVISION`，details 保留具体修正反馈，Goal 不能因此提前 satisfied。执行器须把此有界反馈传回同一主 Agent，并执行全轮的修复次数上限；本工具不自行重试。主 Agent 的实际成本与源查询数另行计量，工具调用不能当作事实认证。

2026-09-25真实commit探针暴露一次可修输入错误：模型把6个已安排活动与2个辅助practical候选都写进text.activities，严格exact-cover校验正确拒绝，但原错误没有details且执行器未传递message，主模型只得到错误code而无法定位。现保留原校验，给此错误增加`activity_text_exact_cover`结构化详情：required/submitted/unexpected/missing/duplicateActivityKeys及repairHint；text.activities的公开schema同时说明只能写已安排活动，局部修改只写替换活动，practical/辅助候选放supportingCandidateKeys或supportingRefs，不需要活动展示文字。执行器只对服务端`DSH_GUIDE_NEEDS_REVISION`将message并入details.hint，已有结构化详情保留；其他provider/runtime错误不因本修复暴露任意message。该反馈仅供主模型修复，不进入公开回复，不增加提交次数或降低领域/publication校验。

执行器最多接受两次组合提交（一次修复）。失败回复只有在本轮确实写入攻略 Artifact 后才能称草稿已保存；在意图/参数/来源检查前失败则只报告未能发布。组合提交成功后，执行器从已保存 Artifact 的当前语言 accepted variant 读取 reply，而不是采纳工具回包的任意 reply 字符串或主模型后续自由文本；该回复与 publication 公共投影一致。最终返回引用同时核对当前 Trip version、接纳语言和 flight revision，取消后不追加成功回复。

### 解释和澄清的轻量公开边界

无组合提交的回合继续回答当前问题，不套用“攻略已保存”。`publicProseProblems` 抽取原 finalization 的纯程序表达检查，攻略仍保留原有身份、来源、语言长度与发布要求；DSH 解释/澄清调用 shortReply 模式，允许“哪一天？”等简短回复和原语言地点名称。边界拦截错误语言、内部旁白/调试/系统提示词/工具名、内部 UUID/hash/地点身份、无支持的精确价格、营业时间、交通耗时、免费/全年开放及预算保证。它不是事实验证器或复杂语义 critic，不追加 LLM 或自动修复调用。

普通回复可复述当前权威 Trip 的两天总预算，例如 `Your current budget is CNY 1200 in total for two days.` 或“总预算是1200元”；仅对明确预算短句中与当前 amount/currency 完全相同且 scope=trip 的金额放行。它不放行不同金额、门票/费用声明或预算可满足保证。检查失败时，原自由文字既不返回也不写入公开 Conversation；替换成当前语言固定提示“这次未能给出合适的说明，请换一种方式描述你想了解的问题。”或对应英文，并在原有 warnings/消息 metadata 中记录 `dsh_reply_withheld`。不修改 Trip/Artifact/Goal/Run、不伪造保存或 accepted，前端和公开 API schema 不变。

局部修改必须提供 `baseGuideId`、`expectedContentHash` 与 `replaceSlots[{day,slot}]`，slot 为 morning/afternoon/evening/flexible。服务器读取同 owner/Trip/version 的已接纳底稿，核对内容 hash 和当前已采用航班，要求指定槽位原本存在。输入 days 仅允许修改这些槽位的 items；越界槽位和重写受保护活动文字直接拒绝。其余活动、顺序、日城市/kind/theme/notes、辅助证据及对应接纳文字从底稿恢复，不使用模型提供的替代元数据；新保存结果还逐项比较受保护活动，意外变化不得发布。因此“仅修改第二天下午”不会靠 prompt 保护第一天和第二天上午。日期/预算/航班继续从当前权威 Trip/workspace 生成，旧攻略保持原样，修改产生新的攻略 Artifact/content hash。

同一次 IPC 重放/请求级幂等由执行器提供；该工具声明 state/非并行。领域写入与 publication 是分阶段提交，取消或文字失败可留下隐藏草稿与材料，但不会覆盖底稿或将 blocked 文字公开，也不自动回退调用其他引擎。

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

## 回滚与边界

本增量不迁移数据、不改公开 schema、不增加前端要求。保留 legacy `finalizeGuide`、`GuideFinalizer` 和已有本地化入口。回滚 DSH 调用方至 legacy 即可；已保存 FinalVariant 沿用 publication v1，仍可被现有读取路径投影。数据库的 owner/Trip/航班/hash/revision/signal 校验未被弱化。
