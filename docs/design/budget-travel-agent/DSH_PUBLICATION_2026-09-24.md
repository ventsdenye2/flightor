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

执行器最多接受两次组合提交（一次修复）。失败回复只有在本轮确实写入攻略 Artifact 后才能称草稿已保存；在意图/参数/来源检查前失败则只报告未能发布。解释回合保留当前问题的模型回答，不套用保存确认。最终返回引用同时核对当前 Trip version、接纳语言和 flight revision，取消后不追加成功回复。

局部修改必须提供 `baseGuideId`、`expectedContentHash` 与 `replaceSlots[{day,slot}]`，slot 为 morning/afternoon/evening/flexible。服务器读取同 owner/Trip/version 的已接纳底稿，核对内容 hash 和当前已采用航班，要求指定槽位原本存在。输入 days 仅允许修改这些槽位的 items；越界槽位和重写受保护活动文字直接拒绝。其余活动、顺序、日城市/kind/theme/notes、辅助证据及对应接纳文字从底稿恢复，不使用模型提供的替代元数据；新保存结果还逐项比较受保护活动，意外变化不得发布。因此“仅修改第二天下午”不会靠 prompt 保护第一天和第二天上午。日期/预算/航班继续从当前权威 Trip/workspace 生成，旧攻略保持原样，修改产生新的攻略 Artifact/content hash。

同一次 IPC 重放/请求级幂等由执行器提供；该工具声明 state/非并行。领域写入与 publication 是分阶段提交，取消或文字失败可留下隐藏草稿与材料，但不会覆盖底稿或将 blocked 文字公开，也不自动回退调用其他引擎。

## 验证

- `npm run check`：通过。
- `npm test -- src/travel-guides/finalization.test.ts src/agent/cloud/finalization.test.ts`：44/44，通过，Vitest 3.33 秒。其中新增 17 项覆盖中英集成发布、零独立模型调用、幂等、隐藏错误语言/来源/活动身份/无依据价格与耗时/占位/schema、材料缺失/practical/字符预算/omitted、已取消和保存前取消、Trip/航班回调变更、内容 hash 和 owner 范围、要求隐藏草稿。其余为 legacy 回归。
- 组合工具接续：`npm test -- src/agent/dsh/commit-guide.test.ts src/travel-guides/finalization.test.ts src/agent/cloud/finalization.test.ts`，56/56，通过，4.57 秒。新增 12 项执行真实领域保存与共享 completion（内存仓库），验证 publication 后才 satisfied、研究只保存一次、无独立研究、失败保持 pending、复用候选零新增研究、第二天下午局部修改保护、hash/越界 slot/受保护文字拒绝、错误证据/地点、取消、过期执行、真实 Trip 版本变化及航班守卫。
- 初次运行在沙箱内因 esbuild 子进程 `spawn EPERM` 未启动；授权同一离线命令后，首次 43/44（变更 hash 测试误加非法 summary 字段）失败，修正 fixture 后以上 44/44 通过。没有压低断言或绕过发布校验。

以上均为离线内存仓库及确定性模型 fixture，不代表新的 PostgreSQL/真实模型/搜索验证；费用为本子任务无外部调用。集成 variant 的调用数为 0 只计本程序阶段，实际主 Agent 成本必须保留于其独立观测。

## 回滚与边界

本增量不迁移数据、不改公开 schema、不增加前端要求。保留 legacy `finalizeGuide`、`GuideFinalizer` 和已有本地化入口。回滚 DSH 调用方至 legacy 即可；已保存 FinalVariant 沿用 publication v1，仍可被现有读取路径投影。数据库的 owner/Trip/航班/hash/revision/signal 校验未被弱化。
