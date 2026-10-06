# ADR 0029：DSH 准备快照与紧凑提交

2026-10-06；Accepted for D6 implementation，验证见 [冻结验收](../design/budget-travel-agent/DSH_D6_ACCEPTANCE.md)，尚非全量真实验收通过。

## 决策

保留官方单主 AgentLoop、公开 API、原 Goal/Run、Artifact、candidate/evidence 和 publication。DSH 首次模型调用前绑定已鉴权 Trip 快照、selected flight revision、同会话当前版本 accepted guide 的确切 id/content hash。复用 planning-context 已读取的 records，不为绑定额外读取最新数据库值。

模型可见 commit 输入中每个 `days[].items[]` 包含自己的 `text`，无需复制活动键；服务端统一生成关联键，重复候选仍按原规则拒绝。引用字段保持不同语义：新候选只从本轮 `sourceRefs` 取来源，每次活动用 `candidateKey` 绑定本次候选；既有持久候选用当前快照或本轮 `read_artifact` 返回的 `candidateRef`。补充的新候选用 `supportingCandidateKeys`，补充的持久候选用 `supportingRefs`；source URL 不能充作任一 locator。模型仅给 `replaceSlots` 与替换内容，服务端从准备快照绑定 accepted `baseGuideId/hash`。legacy 工具合同和公开前端 API 不变。

首个持久操作必须提供与当前明确用户目标一致的新语义 `intent`。普通 raw-web reference-only 材料不能独立核实事实；用它提交普通攻略时，首个 `travel_guide` Goal 必须显式含 `allowPartial=true`，该标记保留来源不确定性，不豁免日程、类别、publication 或其他约束。用户明确要求独立核实事实时，不能以该路径满足要求或弱化其 Goal，应说明限制并澄清。Goal 接受前的参数/前置纠正仍须提供初始 intent；首次 Goal 接受后的内容修复省略 `intent/goalRef` 并复用不可变 Goal。若显式 Trip setter 返回持久 `satisfied` 且 version 推进，其 Goal 完成并结束绑定；后续新持久目标需新的匹配 intent。失败、pending、空 patch、普通攻略修复不推进 Goal。

所有领域工作区和首次 Goal 接受使用该准备 Trip 版本；外部变化明确 context conflict，不在 commit 时填最新值。显式 update_trip_context 以准备版本执行现有 CAS，只有确认版本推进后才受控更新快照，丢弃旧 raw evidence/candidate aliases/编辑基底；空patch等无版本变化的更新保留原准备、引用映射及基底，不能重置相同scope的序号使旧alias改指另一记录；模型得到新版本条件，须重新准备，不能把旧证据重贴版本。

同轮显式 setter 携带语义 `trip_context_update` intent、确实推进版本且已有持久 `satisfied` 完成回执时，保存该 setter 的交付结果，再结束其活动绑定并开始独立的准备后尝试。新尝试的请求身份由原可信 owner/Trip/conversation/generation identity 加当前已确认准备版本派生；generation、会话、谱系和费用计量连续保留，原Goal不可复活或修改。后续攻略仍需新的真实 `travel_guide` intent；DSH工具说明、persona与snapshot同时说明这一准备尝试边界，legacy的同一Goal协议保持不变。同轮攻略内容修复继续复用原不可变Goal，不执行这一setter边界；失败、pending或外部版本变化不获自动推进。

短 source 引用映射本轮原始 UUID 与内容 hash，不改变持久证据格式或 scope 检查。短 C 引用映射已校验持久候选，恢复完整 locator 后仍经过原 owner/Trip/version/过期验证。唯一已选择的 Trip city 可补省略 cityId/locationId，机场或多城市不猜；它不执行 POI、Provider 或目的地变更。

同准备尝试精确请求URL的成功正文可通过内存索引复用原始source receipt/hash/retrievedAt；索引只读取当前scope记录并复核正文hash，不跨generation/version、不缓存失败、不将redirect等同于另一请求URL。取消检查保持生效。模型逐候选核对实际正文支持是语义责任，通用目录页、域名权威及引用存在都不是具体地点的事实证明；不加入另一LLM或地名字符串猜测。observer记录脱敏cacheHit以区分工具请求和真正HTTP，细则见[D6证据合同](../design/budget-travel-agent/DSH_D6_EVIDENCE_AND_LOCATIONS.md)。

局部编辑的 publication-only 最终合并使用现有短事务，Trip 行独占锁串行化 Trip、航班选择及并发发布；同 owner/Trip/conversation/version 的最新 accepted 基底必须仍为准备 id/hash/locale，否则拒绝发布。新隐藏草稿可留审计，不能覆盖/显示成正式成果；accepted 语言仍不可覆写。网络与模型在事务外，无新增表或迁移。

事务中的原始行以内部 conversation_id 定位；比较领域基底前必须在同一 owner-scoped 锁查询取得公开 conversationId，与普通 repository 投影保持一致。不能混用两类ID产生伪冲突，也不能为规避冲突删除会话范围校验。

## 兼容与回滚

一个 DSH-only 输入适配边界兼容内部 fixture/domain 的原 days+text.activities 输入；模型只看到紧凑合同。共享 context 可选字段、saveFinalVariant 可选基底条件由 DSH 显式提供，legacy 未提供时保持既有行为。回滚本地 D6 提交或关闭 DSH opt-in；已有 UUID证据、publication v1、Goal 与来源记录不需数据改写。

## 表达与错误

日程覆盖拒绝仍由原领域校验决定。DSH 在 `guide_day_coverage` 反馈中从准备 Trip 派生预期天数、提交日序与研究日期窗口，不从模型文本猜日期。修复必须完整提交 `days` 和 `text`，休息或交通日计入同一范围，不追加第三天、不自动截断日程；正文精确事实问题同时反馈，复用当前有效候选与同一不可变 Goal。该反馈不额外读取数据库或调用模型。

精确且匹配结构化 Trip 的全程预算目标可确认，不能据此承诺费用足够。结构化航班字段仍在对应 UI 展示，自由散文不获万能精确事实豁免。固定安全错误按 provider/output_limit/location/evidence/context_conflict/commit/publication/UI_restore 区分；不增加公开 response 字段、不泄露原错误正文。细则见 [公开合同](../design/budget-travel-agent/DSH_D6_PUBLIC_ERRORS.md) 和 [引用/地点](../design/budget-travel-agent/DSH_D6_EVIDENCE_AND_LOCATIONS.md)。

## 验证要求

版本冲突、Goal省略/首次意图、跨代短引用、重复候选、slot保护、真实PostgreSQL原子条件与重启、D5恢复/计量、真实UI均按冻结v1执行。离线通过不认证真实页面、Provider或微信；完整分母和失败保留于验收报告。

D6 最新基底选择先按 createdAt/public ID 选择同 Trip/conversation/context version 的最新任一语言 accepted 攻略，再检查当前语言的 accepted text 和已选航班 revision。最新攻略缺当前语言或航班不符时不退回旧攻略；局部编辑准备为空，需先完成当前基底的合法语言/上下文准备。发布 CAS 仍检查最新任一语言 accepted 基底，防止跨语言并发的新攻略被旧编辑覆盖。此调整不放宽发布校验。
