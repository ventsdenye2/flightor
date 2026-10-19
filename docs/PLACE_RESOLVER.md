# 景点数据索引与统一解析

适用分支：`backend-mvp`。不修改聊天、规划、审核三个 Agent 的职责，不调用 LLM 匹配地点。

## 第一阶段：可重建离线索引

数据来自 [Wikimedia 官方 Hugging Face 数据集](https://huggingface.co/datasets/wikimedia/linked-openstreetmap-wikidata-wikipedia-wikivoyage)，快照日期 2026-09-15。只下载 `links.parquet`、`wikidata.parquet`、`wikidata_locations.parquet`，三者按官方说明均为 [CC0](https://creativecommons.org/publicdomain/zero/1.0/)。未下载 ODbL 的 OSM 几何数据，也未下载 Wikipedia/Wikivoyage 正文。Commons 文件各有独立许可，不能套用 CC0。

原始文件、SHA-256 清单、上游 README、DuckDB 分析和 SQLite 索引均放在忽略的 `backend/data/wikimedia-geo/`。源码和构建脚本提交，数据不提交。执行：

```powershell
python -m pip install --target backend/data/wikimedia-geo/python duckdb==1.5.6
python backend/scripts/download-geo.py
python backend/scripts/analyze-geo.py
python backend/scripts/build-geo-index.py
node backend/scripts/query-geo.mjs '{"name":"Charles Bridge","city":"Prague"}'
node backend/scripts/query-geo.mjs '{"qid":"Q204871"}'
node backend/scripts/query-geo.mjs '{"nearby":true,"latitude":50.0865,"longitude":14.4118,"radiusKm":1}'
```

下载支持续传、长度及官方 LFS SHA-256 校验；重建前再次校验原始文件。DuckDB 只用于离线分析/构建，运行时 Node 22.21 自带 `node:sqlite` 只读访问，按名称/QID/纬度索引查询，不启动 Python 或扫描 Parquet。Node 22 的 SQLite 仍会提示 experimental warning。

实际字段是 `instance_of`，不是数据卡文字中的 `instance_id`；没有城市字段，标签/描述只有英文。坐标表包含关联实体的位置，`qualifier_property` 为墓地、总部等时不能代表主体；只索引无关联 qualifier 的坐标。同一 QID 的坐标跨度超过 0.002 度不收录；保留原始坐标，不计算平均中心。排除人物、消歧义页、绘画及明确非地球描述。原表没有 globe/rank，因此离线筛选不能替代全部 Wikidata 语义核验；精度粗于 0.01 度时解析器不发布景点坐标。

城市仅作过滤依据，不补造城市字段：有本地同名城市实体时按 50km 地理邻域验证，否则要求描述的完整城市词组；无法证明关系就留空。本地同名候选不能按热度任取第一；QID 也遵守传入的城市/坐标约束。城市名称歧义及远郊景点可能降低覆盖，需要在线行政关系补充。中文/别名不在原始数据里，未经真实来源补全时离线无法匹配。经纬度 nearby 返回实际候选列表，不把附近任意地点自动当作请求景点。

实际读取：links 23,824,223 行、Wikidata 12,569,011 行、locations 12,829,958 行；生成 11,969,264 条具名地理实体，SQLite 2,586,206,208 字节，构建 487.53 秒。这是地理实体总量，不等于景点分类数量或全部景点覆盖率。索引包含名称、QID、原始坐标/精度、类型、热度、文章页 ID、OSM 关联数量；没有复制正文或 OSM 几何。SQLite 比压缩 Parquet 大，但运行时仅需 Node 内置模块和小范围索引读取。

第一阶段已有后端回归 28/28、`npm test`、文档与 diff 检查通过，含真实对话/规划代码的假 Agent 回归；不是重新调用真实模型的结果。`node backend/scripts/verify-geo.mjs` 可复核真实索引名称+城市、QID 和附近查询。后续阶段保留 `/api/place-locations`、`/api/place-media` 的现有返回结构。
