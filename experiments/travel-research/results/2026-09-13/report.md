# 研究组件评测：协议分组汇总

生成时间：2026-09-12T19:06:35.669Z。共 106 条样本（含可用性探测、失败和旧协议），覆盖 16/16 个案例。

这些是运行和数据契约诊断，不是人工质量总分，也不是完整 Planner / 保存恢复 / UI 的验收。旧协议、并发与模型参数变化分别分组，不合并成模型榜单。

结构通过率是一个明确的技术评分：合规输出数÷该组全部实际尝试数×100。API 错误也留在分母；直接文本没有 JSON 合同，记 N/A。证据是否真实仍须逐条核验。

## research-v1; concurrency=1

| 模型 / 方案 / 搜索 | n | 返回内容 | 结构通过率 | 错误或超时 | p50 秒，含失败 | 已知调用美元 | 未知回执 | SerpApi次数 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| deepseek/deepseek-v4-flash-0731 / thin-web / exa | 2 | 1 | 0% (0/2) | 1 | 22.25 | 0.014389 | 1 | 0 |
| openai/gpt-5.6-luna / direct-web / exa | 1 | 0 | N/A | 1 | 0.07 | 0.000000 | 1 | 0 |
| deepseek/deepseek-v4-flash-0731 / direct-web / exa | 1 | 1 | N/A | 0 | 74.68 | 0.014354 | 0 | 0 |

### thin-web 离线机械归一化消融

| 模型 / 搜索 | n，含失败超时 | 原始契约通过率 | 机械归一化通过率 | 仅归一化后通过 | 无 content | 失败或超时 | 离线处理毫秒合计 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| deepseek/deepseek-v4-flash-0731 / exa | 2 | 0.0% (0/2) | 0.0% (0/2) | 0 | 1 | 1 | 1.689 |

原始契约与归一化结果分别由同一个 parseResearch 验证；原始失败不会被覆盖。失败和超时保留在 n 中，缺少 content 的样本不可修复。只处理 thin-web，不处理 direct-web。
允许的机械操作只有提取唯一尾部 JSON fence、提取无分隔符前言后的单一 JSON object，以及删除未知顶层/候选字段；不补字段，不改内容、URL、日期或类别。
离线处理耗时包含本次解析和投影，未计入或替换原 live 延迟；没有额外模型调用，也没有验证事实。逐样本原始通过状态、归一化通过状态、转换路径及结果见 normalization-results.json。

## research-v2-explicit-contract; concurrency=1

| 模型 / 方案 / 搜索 | n | 返回内容 | 结构通过率 | 错误或超时 | p50 秒，含失败 | 已知调用美元 | 未知回执 | SerpApi次数 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| deepseek/deepseek-v4-flash-0731 / probe / exa | 1 | 1 | N/A | 0 | 1.06 | 0.000000 | 0 | 0 |
| qwen/qwen3.8-flash / probe / exa | 1 | 1 | N/A | 0 | 0.86 | 0.000003 | 0 | 0 |
| minimax/minimax-m3 / probe / exa | 1 | 0 | N/A | 1 | 0.07 | 0.000000 | 1 | 0 |
| z-ai/glm-5.3-flash / probe / exa | 2 | 1 | N/A | 1 | 0.06 | 0.000002 | 1 | 0 |
| moonshotai/kimi-k2.6 / probe / exa | 1 | 1 | N/A | 0 | 0.48 | 0.000009 | 0 | 0 |
| qwen/qwen3.8-flash / thin-web / exa | 1 | 1 | 100% (1/1) | 0 | 19.34 | 0.016015 | 0 | 0 |
| deepseek/deepseek-v4-flash-0731 / current-system / serpapi | 1 | 1 | 100% (1/1) | 0 | 34.69 | 0.000047 | 0 | 2 |
| deepseek/deepseek-v4-flash-0731 / thin-web / exa | 1 | 1 | 0% (0/1) | 0 | 71.32 | 0.014632 | 0 | 0 |
| deepseek/deepseek-v4-flash-0731 / direct-web / exa | 1 | 1 | N/A | 0 | 19.21 | 0.014299 | 0 | 0 |
| z-ai/glm-5.3-flash / thin-web / exa | 1 | 0 | 0% (0/1) | 1 | 5.68 | 0.000000 | 1 | 0 |

### thin-web 离线机械归一化消融

| 模型 / 搜索 | n，含失败超时 | 原始契约通过率 | 机械归一化通过率 | 仅归一化后通过 | 无 content | 失败或超时 | 离线处理毫秒合计 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| qwen/qwen3.8-flash / exa | 1 | 100.0% (1/1) | 100.0% (1/1) | 0 | 0 | 0 | 0.127 |
| deepseek/deepseek-v4-flash-0731 / exa | 1 | 0.0% (0/1) | 0.0% (0/1) | 0 | 0 | 0 | 0.119 |
| z-ai/glm-5.3-flash / exa | 1 | 0.0% (0/1) | 0.0% (0/1) | 0 | 1 | 1 | 0.095 |

原始契约与归一化结果分别由同一个 parseResearch 验证；原始失败不会被覆盖。失败和超时保留在 n 中，缺少 content 的样本不可修复。只处理 thin-web，不处理 direct-web。
允许的机械操作只有提取唯一尾部 JSON fence、提取无分隔符前言后的单一 JSON object，以及删除未知顶层/候选字段；不补字段，不改内容、URL、日期或类别。
离线处理耗时包含本次解析和投影，未计入或替换原 live 延迟；没有额外模型调用，也没有验证事实。逐样本原始通过状态、归一化通过状态、转换路径及结果见 normalization-results.json。

## research-v2-explicit-contract; concurrency=2

| 模型 / 方案 / 搜索 | n | 返回内容 | 结构通过率 | 错误或超时 | p50 秒，含失败 | 已知调用美元 | 未知回执 | SerpApi次数 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| qwen/qwen3.8-flash / thin-web / exa | 2 | 2 | 50% (1/2) | 0 | 17.48 | 0.032115 | 0 | 0 |
| moonshotai/kimi-k2.6 / thin-web / exa | 2 | 2 | 50% (1/2) | 0 | 26.16 | 0.041295 | 0 | 0 |
| deepseek/deepseek-v4-flash-0731 / direct-web / exa | 1 | 1 | N/A | 0 | 17.13 | 0.014301 | 0 | 0 |
| deepseek/deepseek-v4-flash-0731 / current-system / serpapi | 1 | 1 | 100% (1/1) | 0 | 22.49 | 0.000040 | 0 | 1 |
| z-ai/glm-5.3-flash / thin-web / exa | 1 | 1 | 100% (1/1) | 0 | 74.19 | 0.014839 | 0 | 0 |
| deepseek/deepseek-v4-flash-0731 / thin-web / exa | 2 | 1 | 0% (0/2) | 1 | 8.17 | 0.014294 | 1 | 0 |

### thin-web 离线机械归一化消融

| 模型 / 搜索 | n，含失败超时 | 原始契约通过率 | 机械归一化通过率 | 仅归一化后通过 | 无 content | 失败或超时 | 离线处理毫秒合计 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| qwen/qwen3.8-flash / exa | 2 | 50.0% (1/2) | 50.0% (1/2) | 0 | 0 | 0 | 0.825 |
| moonshotai/kimi-k2.6 / exa | 2 | 50.0% (1/2) | 100.0% (2/2) | 1 | 0 | 0 | 0.494 |
| z-ai/glm-5.3-flash / exa | 1 | 100.0% (1/1) | 100.0% (1/1) | 0 | 0 | 0 | 0.197 |
| deepseek/deepseek-v4-flash-0731 / exa | 2 | 0.0% (0/2) | 50.0% (1/2) | 1 | 1 | 1 | 0.426 |

原始契约与归一化结果分别由同一个 parseResearch 验证；原始失败不会被覆盖。失败和超时保留在 n 中，缺少 content 的样本不可修复。只处理 thin-web，不处理 direct-web。
允许的机械操作只有提取唯一尾部 JSON fence、提取无分隔符前言后的单一 JSON object，以及删除未知顶层/候选字段；不补字段，不改内容、URL、日期或类别。
离线处理耗时包含本次解析和投影，未计入或替换原 live 延迟；没有额外模型调用，也没有验证事实。逐样本原始通过状态、归一化通过状态、转换路径及结果见 normalization-results.json。

## research-v3-aligned-contract-routing; concurrency=2

| 模型 / 方案 / 搜索 | n | 返回内容 | 结构通过率 | 错误或超时 | p50 秒，含失败 | 已知调用美元 | 未知回执 | SerpApi次数 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| qwen/qwen3.8-flash / thin-web / exa | 16 | 16 | 63% (10/16) | 0 | 20.25 | 0.249591 | 0 | 0 |
| moonshotai/kimi-k2.6 / thin-web / exa | 16 | 16 | 25% (4/16) | 0 | 19.28 | 0.269594 | 0 | 0 |
| deepseek/deepseek-v4-flash-0731 / direct-web / exa | 16 | 14 | N/A | 2 | 22.72 | 0.186590 | 2 | 0 |
| deepseek/deepseek-v4-flash-0731 / current-system / serpapi | 16 | 16 | 100% (16/16) | 0 | 30.02 | 0.000639 | 0 | 23 |
| z-ai/glm-5.3-flash / thin-web / exa | 16 | 16 | 81% (13/16) | 0 | 25.31 | 0.213742 | 0 | 0 |
| deepseek/deepseek-v4-flash-0731 / thin-web / exa | 2 | 1 | 0% (0/2) | 1 | 79.54 | 0.014526 | 1 | 0 |

### thin-web 离线机械归一化消融

| 模型 / 搜索 | n，含失败超时 | 原始契约通过率 | 机械归一化通过率 | 仅归一化后通过 | 无 content | 失败或超时 | 离线处理毫秒合计 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| qwen/qwen3.8-flash / exa | 16 | 62.5% (10/16) | 93.8% (15/16) | 5 | 0 | 0 | 1.681 |
| moonshotai/kimi-k2.6 / exa | 16 | 25.0% (4/16) | 62.5% (10/16) | 6 | 0 | 0 | 1.537 |
| z-ai/glm-5.3-flash / exa | 16 | 81.3% (13/16) | 93.8% (15/16) | 2 | 0 | 0 | 1.857 |
| deepseek/deepseek-v4-flash-0731 / exa | 2 | 0.0% (0/2) | 50.0% (1/2) | 1 | 1 | 1 | 0.312 |

原始契约与归一化结果分别由同一个 parseResearch 验证；原始失败不会被覆盖。失败和超时保留在 n 中，缺少 content 的样本不可修复。只处理 thin-web，不处理 direct-web。
允许的机械操作只有提取唯一尾部 JSON fence、提取无分隔符前言后的单一 JSON object，以及删除未知顶层/候选字段；不补字段，不改内容、URL、日期或类别。
离线处理耗时包含本次解析和投影，未计入或替换原 live 延迟；没有额外模型调用，也没有验证事实。逐样本原始通过状态、归一化通过状态、转换路径及结果见 normalization-results.json。

已知调用美元仅累加样本 usage.cost，不包含后来核对的未知请求费用；共享 [budget-ledger.json](receipts/budget-ledger.json) 才是准入账本。SerpApi 套餐成本未知。快速报错会拉低 p50，因此不能据此宣称模型更快。

## 完成覆盖

| 协议 / 模型 / 方案 | 不同案例 / 16 |
| --- | ---: |
| research-v1 / deepseek/deepseek-v4-flash-0731 / thin-web | 1/16 |
| research-v1 / openai/gpt-5.6-luna / direct-web | 1/16 |
| research-v1 / deepseek/deepseek-v4-flash-0731 / direct-web | 1/16 |
| research-v2-explicit-contract / qwen/qwen3.8-flash / thin-web | 3/16 |
| research-v2-explicit-contract / moonshotai/kimi-k2.6 / thin-web | 2/16 |
| research-v2-explicit-contract / deepseek/deepseek-v4-flash-0731 / direct-web | 2/16 |
| research-v2-explicit-contract / deepseek/deepseek-v4-flash-0731 / current-system | 2/16 |
| research-v2-explicit-contract / z-ai/glm-5.3-flash / thin-web | 2/16 |
| research-v2-explicit-contract / deepseek/deepseek-v4-flash-0731 / thin-web | 3/16 |
| research-v3-aligned-contract-routing / qwen/qwen3.8-flash / thin-web | 16/16 |
| research-v3-aligned-contract-routing / moonshotai/kimi-k2.6 / thin-web | 16/16 |
| research-v3-aligned-contract-routing / deepseek/deepseek-v4-flash-0731 / direct-web | 16/16 |
| research-v3-aligned-contract-routing / deepseek/deepseek-v4-flash-0731 / current-system | 16/16 |
| research-v3-aligned-contract-routing / z-ai/glm-5.3-flash / thin-web | 16/16 |
| research-v3-aligned-contract-routing / deepseek/deepseek-v4-flash-0731 / thin-web | 2/16 |
