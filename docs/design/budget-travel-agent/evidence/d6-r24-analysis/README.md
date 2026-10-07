# r24 真实 H5 分析材料

状态：用户要求在 B01–B12 后暂停；E01–E04 不测，D6 未 PASS。全部 13 次原 attempt 保留，9 场 runner FAIL、3 场 observed；B07/B08 独立公开语义 FAIL，B05 仅部分流程子项通过。不能据此宣称完整通过率。

[完整分析与续作](../../DSH_D6_R24_H5_ANALYSIS_2026-10-07.md) · [判定矩阵](matrix.json) · [全量 JSON](analysis.json) · [诊断](diagnostics.json) · [供应商与持久对照](provider-and-drain-review.json) · [关闭/指纹/费用](audit-summary.json) · [投影核验](projection-audit.json) · [凭据扫描](secret-scan.json)

全量 JSON 约 3.6 MB，GitHub 可用 Raw 下载；下面的逐场文件方便单独分析。每个 action 的 index 从 0 开始。naturalInputs 包含原定义全部消息，执行与否由 actions.status 决定。`observed` 表示脚本完成，不是内容 PASS。预算/金额未知预留不是实付；未给未经逐条对账的单场金额。

| 场景 | 原 attempt / runner 完整秒数 | blocked 步数 | 原截图 | 独立结果 |
| --- | --- | --- | --- | --- |
| [B01](B01.json) | 1: failed / 59.613 | 5 | 4 | FAIL |
| [B02](B02.json) | 1: failed / 2.748<br>2: failed / 127.903 | 8 / 8 | 2 | FAIL |
| [B03](B03.json) | 1: failed / 25.458 | 8 | 1 | FAIL |
| [B04](B04.json) | 1: failed / 25.269 | 8 | 1 | FAIL |
| [B05](B05.json) | 1: observed / 272.642 | 0 | 8 | LIMITED_SUBCHECKS_PASSED |
| [B06](B06.json) | 1: failed / 254.517 | 5 | 1 | FAIL |
| [B07](B07.json) | 1: observed / 24.378 | 0 | 8 | FAIL |
| [B08](B08.json) | 1: observed / 24.517 | 0 | 6 | FAIL |
| [B09](B09.json) | 1: failed / 32.780 | 5 | 2 | FAIL |
| [B10](B10.json) | 1: failed / 32.769 | 6 | 2 | FAIL |
| [B11](B11.json) | 1: failed / 233.060 | 5 | 17 | FAIL |
| [B12](B12.json) | 1: failed / 11.031 | 19 | 1 | FAIL |

全部 [53 张截图](screenshots/) 保留原字节，具体文件与 SHA 在各场 JSON 的 screenshots 字段。原报告/observer/PG 读取 SHA 在全量 JSON 的 sources。B09/B10 初始与执行结束后 PG 分开保留；observer 按 Trip 过滤，浏览器终点后的原执行另列 executionContinuation，不能混入下一场。

公开材料是白名单投影：实际公开回复、活动详情、候选/草稿的公开业务字段、受控错误原因和关联公共 ID。诊断中的拒绝稿明确标记未发布，不与可见 UI 混称。未上传密钥、完整会话、transport、headers、原始数据库或费用账本；原件保留在本地忽略目录，原工程日志也仍留本地。来源 URL 的 query/hash 去除，不代表其正文/时间/实价已全部核实。首次 B01 工程/关闭快照保留历史，不由后续恢复重写。

本批无产品修复/重跑，微信页面和4探索未验收；后续修复须新冻结完整验证。
