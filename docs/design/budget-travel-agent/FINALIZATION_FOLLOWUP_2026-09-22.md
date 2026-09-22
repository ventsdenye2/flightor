# 终稿模块三项收尾

基线 `main@a67ed77`。仅修复失败语言缓存、practical 一刀切与可见文本检查；不重构 Planner、不换模型/研究 Provider、不进入下一项概览与景点卡片。既有用户/其他任务改动保留，不纳入本次提交。

## 测试先行与实现

- 后端先新增回归并运行：23项中7失败、16通过，分别复现交通日误拒、活动名称4种禁止表达漏检、部分占位被接纳、英文超时后无法重试。前端先补回归，首次运行在 blocked POST 长期缓存断言失败。
- 复审补充“活动名称含长段英文正文”：26项中该1项失败，随后把既有 duplicated_or_foreign_prose 检查也覆盖 name；正常原文地名用例继续保留。
- 服务只复用 accepted；技术失败需显式 retryRevision，最多2次重试，普通刷新/请求不自动重试。存储 revision 比较更新，原失败和费用留在 history；accepted 不能被旧结果替换。中文、英文独立合并，内容hash、活动ID、Trip/航班版本不变。
- practical 预检复用 day.kind 与 item.category；正常交通事项交给已有语义检查，主景点错绑 practical 来源仍有具体问题。没有引入分类框架。
- name 加入禁止表达检查，地名原文仍允许。占位逐活动检查，一次格式修复后仍占位则 missing_material + activityId，不能把部分空壳发布。

## 下一任务接口与边界

权威字段见 [ADR 0025](../../adr/0025-bounded-guide-finalization.md)。现有 text 字段、来源关系、稳定 activityId、guideContentHash 和 guideEnrichmentKey 全部沿用。新增 public publication.failureKind/revision/canRetry；内部 variant.history 仅审计，不公开原模型文本/费用。

下一项可以从 `status=preparing|blocked|accepted` 与 issues 展示当前语言状态。用户显式重试通过 `localizeArtifact(id, {locale, retryRevision: publication.revision})`；不能将其挂到轮询/渲染的自动失败循环。缺失语言首次生成仍须已有 accepted 底稿，localization API 不承担重新研究、规划或完整首稿审核；完整终稿函数只在调用方持有原始需求/材料时接受显式重试。没有底稿时保持原状态。

GET/重复accepted请求无模型调用；技术重试每次共用90秒与最多一次表达修复，全部尝试观测可从当前observation与history汇总。达到3次尝试后canRetry=false，不能刷新额度。旧v1结果无revision时按1兼容，无history时按空兼容；无需数据库迁移。回滚到a67ed77前须注意旧严格schema不认识新增字段，不能把新记录误当旧版已接纳内容。

前端只有accepted结果进入长期缓存，blocked/preparing重新读取服务器但不自动重新生成；POST合并同语言同重试版本，旧同语言请求返回superseded错误，不污染缓存；不同语言与owner/session隔离保持。下一任务负责实际按钮/状态/卡片呈现和模拟器验收，本批不声称其已完成。

## 本轮验证

| 检查 | 实际结果 |
| --- | --- |
| 首次后端红测 | 7失败/16通过，确认三个缺陷 |
| 首次前端红测 | blocked POST 缓存断言失败 |
| 后端定向验证 | `npm test -- src/travel-guides/finalization.test.ts src/routes/agent-cloud.test.ts src/agent/cloud/finalization.test.ts src/artifacts src/travel-guides/publication-history.test.ts`：8文件63项通过（11.84秒）；随后名称长段正文补充红测修复，定向重跑见下方 |
| 最后表达检查复验 | `npm test -- src/travel-guides/finalization.test.ts`：26项全部通过（1.59秒）；最后修改仅扩展既有表达检查至name |
| TypeScript | backend `npm run check` 最终通过 |
| 前端 Artifact | `npm run test:artifacts`：25项 + 8组终稿缓存检查通过 |
| 前端既有展示适配 | `npm run test:production-presentation`：28项展示、6项回复、7项资料库检查通过；这是离线回归，不是下一项UI验收 |
| PostgreSQL | 既有localhost:5432的postgres随机schema，两例通过；双连接竞争仅一份revision=2接纳，迟到revision=1拒绝，保留失败费用17微美元，独立重读双语言、owner/Trip/hash/航班保护仍通过；测试schema已清理 |
| 未执行 | 真实模型/研究Provider、G1全量、模拟器、地图/图片。无新增费用，未改旧账本，未重启Docker或业务服务 |
| 文档/空白 | `node scripts/check-docs.cjs`：90份Markdown、405个相对链接与同批docs检查通过；`git diff --check`通过。暂存检查另在提交前执行 |

跨进程调用去重仍不支持；数据库只保证写入比较版本，不承诺跨实例付费去重。被拒绝的迟到调用保留独立观测，只有成功提交的尝试进入variant.history。
