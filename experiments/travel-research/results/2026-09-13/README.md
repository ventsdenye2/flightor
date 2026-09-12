# 2026-09-13 首轮活动研究评测证据归档

本目录保存 10 个真实运行批次的 **106 条样本**，其中 **82 条属于 v3 协议**。包含可用性探测、失败、超时和旧协议；没有挑选成功结果。无需本机忽略目录即可阅读。

- [协议分组报告](report.md)：运行、费用和结构诊断，不是人工质量总分。
- [全部紧凑结果](all-results.json)：106 条记录及配置；逐个原始样本位于 runs/<run>/<sample>.json。
- [盲评材料](blind-review.json)与[人工评分规则](inputs/rubric.md)：保留来源、未验证状态和逐项限制。
- [归一化消融](normalization-results.json)：复用已完成的离线分析，原始失败与归一化后结果并存。
- [架构指标](architecture-metrics.json)、[预算账本](receipts/budget-ledger.json)及 receipts/ 下的脱敏核对回执。
- [45 项离线测试记录](verification/offline-tests.json)、[v3 完整性检查](verification/v3-integrity-check.json)与[归档审计](verification/archive-audit.json)。
- [来源及导出文件 SHA-256 索引](sha256-index.json)、[归档说明](archive-manifest.json)、[用例](inputs/cases.json)和[模型目录](inputs/models.json)。

| 批次 | 协议 | 并发 | 实际样本 |
| --- | --- | ---: | ---: |
| pilot-02 | research-v1 | 1 | 2 |
| pilot-03 | research-v1 | 1 | 2 |
| china-model-probe | research-v2-explicit-contract | 1 | 5 |
| glm-probe | research-v2-explicit-contract | 1 | 1 |
| research-screen-v2 | research-v2-explicit-contract | 2 | 9 |
| research-screen-v2-cont1 | research-v2-explicit-contract | 1 | 5 |
| research-screen-v3 | research-v3-aligned-contract-routing | 2 | 11 |
| candidate-screen-v3 | research-v3-aligned-contract-routing | 2 | 42 |
| architecture-baseline-v3 | research-v3-aligned-contract-routing | 2 | 11 |
| architecture-baseline-v3-cont1 | research-v3-aligned-contract-routing | 2 | 18 |

## 保存内容

原始样本保留用户可见输出、引用、usage、finish reason、provider、错误与执行时间；当前组件还保留原始 research artifact 和搜索/合成时序。请求只保留模型、推理、联网工具和输出合同等配置，省略重复提示词及消息。未复制鉴权头、环境配置、后端源码树或依赖目录。baseline-manifest.json 仅保存源代码和依赖锁文件的哈希。

原始 run/sample 的 result 保留当时快照；all-results.json 和盲评材料复用已完成的评审投影，所以旧样本投影中的状态问题不会被静默回写。归一化来自既有 aggregate-final 输出，离线耗时也按原分析保留，没有追加模型调用。

## 来源与限制

归档选择以最终聚合清单为准，并逐项与实际 run/sample 文件核对。sourceId 是原始证据标识，archivedAs 是本目录内文件；本机绝对路径已替换。索引同时给出脱敏前源文件和脱敏后归档文件的哈希，二者不要求相同；索引不对自身计算哈希。原始忽略目录未修改。

这是一轮活动候选研究实验，不能证明完整 Planner、持久化、保存恢复或微信 UI 端到端完成。引用链接存在不代表事实真实。探测/旧协议/v3 按协议与并发分别统计；后续离线修复没有被冒充为新一轮付费实测。

账本含未知费用预留，provider 回执才是最终计费依据；SerpApi 次数与套餐价格独立保留。45 项测试记录是已有验证证据，本次导出只做读取、内容核对、脱敏与文件完整性检查，并未重新请求 API 或重跑这 45 项。
