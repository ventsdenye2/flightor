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

## 第二阶段：统一 PlaceResolver

两条现有 HTTP 路由共用 `PlaceResolver`：先查本地英文标签、QID 及经真实来源验证缓存的多语言标签/别名，再用城市邻域、完整城市描述或 P131 行政关系消歧；多候选留空。在线优先 Enterprise Free：精确名称查 `/v2/articles/{name}` 确定 QID，详情查 `/v2/wikidata/items/{QID}`；缺城市时也先查同语言精确文章。官方明确 On-demand 不提供模糊搜索，必要时才回退 Wikidata `zh`/`en` 搜索。实体必须真实名称/别名/同名文章匹配，地球 P625 有效且无冲突，排除人物、画作、物种、论文及消歧义页。公开实体及别名写入 `enrichment.sqlite`，快照只读，城市中心不能代替景点。

“北京/北京市”仅在城市上下文做完整名称变体匹配，避免只认海外同名城市。国家/州限定先约束城市候选，不能让泛称 Paris 越过地理约束。近城范围并非行政边界；多个同城候选再核对最多四层 P131，仍不明确就留空。QID 可选，同时传城市/坐标时仍需符合约束。裸世界遗产条目须有匹配文章身份再发布，避免用列表实体的位置代替实体景点。

图片顺序：QID 的 P18 Commons 文件 → 同 QID Wikipedia 主图（有凭证先查 Enterprise Structured Contents）→ Commons 搜索。P18 文件名不必等于景点英文名，其关联来自已匹配 QID；主图须返回同一 `main_entity.identifier` / `wikibase_item`，Enterprise 还需站点符合；搜索须同时符合名称并具有同 QID 的结构化 `P180 depicts`。所有路径最终读取 Commons 作者、许可、来源、格式和尺寸，缺失或不适合复用时留空。实体关联证明不等于视觉人工验收。

成功字段/状态与前端兼容，地图与图片组件无需修改。缓存放在 `place-locations-v2/`、`place-media-v2/`，不读旧名称搜索缓存；成功缓存分别 30/7 天，确定空缺 15 分钟，网络失败不缓存。同接口同输入合并，缓存写失败不隐藏成功数据。

`WikimediaHttp` 使用现有环境代理，每站串行、完成后约间隔 1 秒，主机独立冷却；缓存成功原始 JSON。单次传输 8 秒，地点/图片各自总预算 17 秒。网络/500/502/503/504/maxlag 有限重试，429/503 遵守 Retry-After（秒/HTTP 日期）；冷却超预算立即返回 unavailable，避免忙重试。取消包含排队阶段，Wikidata 限流不阻断 Commons。

### Enterprise 后端配置

已读取官方[认证](https://enterprise.wikimedia.com/docs/authentication/)、[On-demand](https://enterprise.wikimedia.com/docs/on-demand/)及[Structured Contents](https://enterprise.wikimedia.com/api/structured-contents/)说明。`backend/.env.example` 无凭证，实际 `backend/.env` 被忽略：

```dotenv
WIKIMEDIA_ENTERPRISE_ACCESS_TOKEN=your_access_token
```

填登录响应的 `access_token`；`id_token` 不用于 API Bearer。用户要求同时保存三个 token，实际后端文件另保存 `WIKIMEDIA_ENTERPRISE_ID_TOKEN`、`WIKIMEDIA_ENTERPRISE_REFRESH_TOKEN`、`WIKIMEDIA_ENTERPRISE_USERNAME`。不保存密码，不写长期记忆。`EnterpriseTokens` 在 access token 距到期不足两分钟时按需调用官方 `/v1/token-refresh`，合并并发刷新，保留响应未重发的 refresh token，原子更新后端环境文件并保留其他设置。refresh token 过期/撤销后需用户重新登录；没有 API 请求时不启动后台定时任务。

`npm run backend:start` 用 Node `--env-file-if-exists=.env` 加载后端环境；独立脚本用 `node --env-file-if-exists=backend/.env ...`。不读取前端环境变量，token 不进 URL、HTTP 缓存或日志，认证响应明确禁用缓存。无凭证或 Enterprise 失败仍可尝试公开 Wikipedia / Commons。Wikidata 实体还可从 Enterprise `/v2/wikidata/items/QID` 获取，转换实际 `identifier`、字符串标签及 `statements` 模型后复用同一校验；不能把它直接当成 MediaWiki `claims`。

第二阶段已有后端 40/40 和 `npm test` 通过。真实查理大桥按本地 QID 定位并返回 Commons 图片、作者 Uoaei1、CC BY-SA 4.0 及文件页。真实 refresh-token 交换成功，Enterprise Structured Contents 返回同 QID `Q204871`、enwiki 文章及 Commons 主图；Wikidata item endpoint 也返回同 QID 的真实标签/P625/P18。测试输出只保留认证是否成功及过期时间，不保留凭证。

## 第三阶段：实际界面与批量验收

36 个真实地点的中英文、同名和小众测试见 [验收报告](PLACE_RESOLVER_ACCEPTANCE.md)。脚本先从独立 Wikipedia API 冻结参考 QID/坐标，再只向解析器传景点名与城市；参考点 500 米内及严格 QID 一致分别统计，不把同来源的一致性当作测绘真值。首次无缓存、在线复用和完全禁用网络三种运行分开记录。原始失败与后续修复结果都保存在忽略的数据目录。

`FLIGHTOR_PLACES_OFFLINE=1` 强制仅使用本地索引、实体与 HTTP 元数据缓存；缓存缺失立即留空，网络调用为零。它不下载离线照片文件，客户端显示远程图片仍需网络。缓存中经验证的带城市文章名优先于超过 200 个同名候选，使同名教堂的历史解析能离线恢复。

图片元数据兼容真实 Commons 的地区版本许可（如 `CC BY-SA 3.0 de`），旧 HTTP CC0 许可链接仅在明确的 Wikimedia/Creative Commons 主机升级为 HTTPS。保留作者、许可文本和来源，不放宽外部图片主机/未知许可。Enterprise 未知 precision 字符串按缺失精度处理，不把它变成零坐标。

用户明确允许当前出现“卢浮宫返回巴黎全景”这类远景构图问题；保留 QID/P180 与名称元数据关系，不新增“文件名必须完整包含景点”或前景构图限制。自动实体关联与图片视觉准确性仍分开报告，中文“卢浮宫”指宫殿、英文参考指博物馆的 QID 差异不修改参考以凑通过率。

批量复测：

```powershell
node backend/scripts/benchmark-places.mjs references
node backend/scripts/benchmark-places.mjs offline-cold-final
# 为新的首次冷启动验收选择尚不存在的目录；同一个目录用于后面两轮
$env:FLIGHTOR_BENCHMARK_RUN='acceptance-new'
node --env-file-if-exists=backend/.env backend/scripts/benchmark-places.mjs online-cold-final
node --env-file-if-exists=backend/.env backend/scripts/benchmark-places.mjs online-warm-final
node --env-file-if-exists=backend/.env backend/scripts/benchmark-places.mjs offline-warm-final
node backend/scripts/report-places.mjs
```

新冷启动目录若已含 enrichment 会拒绝重跑，避免把命中旧缓存伪称冷启动。批测遵守上游冷却时间；生成的 raw JSON/日志和数据库不提交 Git，报告只提交指标、合同和复现说明。
