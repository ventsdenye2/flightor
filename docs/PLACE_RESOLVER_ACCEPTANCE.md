# PlaceResolver 实际验收

分支：backend-mvp。离线索引提交：`abcbc94`；统一解析与 Enterprise 优先提交：`983397e`；本报告随第三阶段验收提交。

## 数据与方法

下载并校验三个官方文件共 1,566,037,974 字节（十进制约 1.57GB）；索引含 11,969,264 条具名地理实体，SQLite 为 2,586,206,208 字节。它不是纯景点分类库，原表无完整城市字段和中文名。许可、哈希、重建及 API 合同见 [PlaceResolver](PLACE_RESOLVER.md)。数据、索引、凭证、HTTP 原始缓存均被 Git 忽略。

固定 36 个地点：中文 10、英文 10、同名 5、小众 11。参考由独立 Wikipedia API 冻结，解析器只接收名称与城市，不传预期 QID。位置符合率以参考点 500m 内计算；严格一致率额外要求 QID 一致。参考与目标同属 Wikimedia 生态，属于来源一致性核对，不能当作独立测绘真值。Loreta 初始参考误指消歧义页，已依据实际文章修为 Loreta (Prague)，初始参考保留在忽略目录，不修改解析输入。中文卢浮宫与英文 Louvre 的不同条目范围保持为不一致，不调整参考凑通过。

耗时是顺序定位加配图的合计，包括必要网络等待；不是前端并行两接口的单个请求时延。四轮分开记录，冷启动目录为空时才能运行。原始 JSON、各次失败和日志位于 `backend/data/wikimedia-geo/benchmark/`。

## 批测结果

| 模式 | 坐标覆盖 | 500m 内/已返回 | 严格 QID+位置一致 | 图片覆盖 | 图片 QID 一致/已返回 | 平均耗时 | P95 | 网络请求 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 纯快照离线 | 18/36 (50.0%) | 18/18 | 18/18 (100.0%) | 0/36 (0.0%) | 不适用 | 2.0ms | 5.4ms | 0 |
| 首次在线（独立空缓存） | 35/36 (97.2%) | 35/35 | 34/35 (97.1%) | 35/36 (97.2%) | 97.1% | 3637.9ms | 9891.9ms | 142 |
| 在线复用缓存 | 35/36 (97.2%) | 35/35 | 34/35 (97.1%) | 35/36 (97.2%) | 97.1% | 189.7ms | 26.2ms | 5 |
| 禁用网络，复用元数据 | 35/36 (97.2%) | 35/35 | 34/35 (97.1%) | 35/36 (97.2%) | 97.1% | 12.0ms | 26.3ms | 0 |

图片 QID 一致率不是人工视觉准确率，也不证明主体占比、照片时效或任意返回图片都适合封面。图片只缓存元数据，离线模式下已有远程 URL 不等于图片二进制可离线加载。

| 分组（在线复用） | 坐标 | 严格匹配 | 图片 | 图片实体一致率 |
| --- | --- | --- | --- | --- |
| zh | 10/10 | 9/10 | 10/10 | 90.0% |
| en | 10/10 | 10/10 | 10/10 | 100.0% |
| same-name | 5/5 | 5/5 | 5/5 | 100.0% |
| lesser-known | 10/11 | 10/10 | 10/11 | 100.0% |

## 逐景点结果（在线复用）

| 名称 | 城市 | 参考 QID | 返回 QID | 位置距离 | 图片与来源路径 |
| --- | --- | --- | --- | --- | --- |
| 查理大桥 | Prague | [Q204871](https://en.wikipedia.org/wiki/Charles_Bridge) | Q204871 | 0.0m | Commons depicts |
| 埃菲尔铁塔 | 巴黎 | [Q243](https://en.wikipedia.org/wiki/Eiffel_Tower) | Q243 | 8.3m | P18 |
| 卢浮宫 | 巴黎 | [Q19675](https://en.wikipedia.org/wiki/Louvre) | Q1075988 | 10.2m | P18 |
| 故宫 | 北京 | [Q80290](https://en.wikipedia.org/wiki/Forbidden_City) | Q80290 | 0.0m | P18 |
| 天坛 | 北京 | [Q125445](https://en.wikipedia.org/wiki/Temple_of_Heaven) | Q125445 | 0.0m | P18 |
| 颐和园 | 北京 | [Q4132](https://en.wikipedia.org/wiki/Summer_Palace) | Q4132 | 0.0m | P18 |
| 泰姬陵 | 阿格拉 | [Q9141](https://en.wikipedia.org/wiki/Taj_Mahal) | Q9141 | 4.4m | P18 |
| 悉尼歌剧院 | 悉尼 | [Q45178](https://en.wikipedia.org/wiki/Sydney_Opera_House) | Q45178 | 35.6m | P18 |
| 自由女神像 | 纽约 | [Q9202](https://en.wikipedia.org/wiki/Statue_of_Liberty) | Q9202 | 5.0m | P18 |
| 圣家堂 | 巴塞罗那 | [Q48435](https://en.wikipedia.org/wiki/Sagrada_Fam%C3%ADlia) | Q48435 | 0.0m | P18 |
| Colosseum | Rome | [Q10285](https://en.wikipedia.org/wiki/Colosseum) | Q10285 | 3.1m | Commons depicts |
| Acropolis of Athens | Athens | [Q131013](https://en.wikipedia.org/wiki/Acropolis_of_Athens) | Q131013 | 0.0m | P18 |
| Stonehenge | Salisbury | [Q39671](https://en.wikipedia.org/wiki/Stonehenge) | Q39671 | 0.0m | P18 |
| Machu Picchu | Aguas Calientes | [Q676203](https://en.wikipedia.org/wiki/Machu_Picchu) | Q676203 | 0.0m | P18 |
| Christ the Redeemer | Rio de Janeiro | [Q79961](https://en.wikipedia.org/wiki/Christ_the_Redeemer_(statue)) | Q79961 | 9.9m | P18 |
| Burj Khalifa | Dubai | [Q12495](https://en.wikipedia.org/wiki/Burj_Khalifa) | Q12495 | 4.2m | P18 |
| Kinkaku-ji | Kyoto | [Q270983](https://en.wikipedia.org/wiki/Kinkaku-ji) | Q270983 | 0.0m | P18 |
| Fushimi Inari-taisha | Kyoto | [Q714828](https://en.wikipedia.org/wiki/Fushimi_Inari-taisha) | Q714828 | 55.5m | P18 |
| Angkor Wat | Siem Reap | [Q43473](https://en.wikipedia.org/wiki/Angkor_Wat) | Q43473 | 0.0m | Wikipedia main image |
| Hagia Sophia | Istanbul | [Q12506](https://en.wikipedia.org/wiki/Hagia_Sophia) | Q12506 | 0.0m | P18 |
| Eiffel Tower | Paris, Texas | [Q25223034](https://en.wikipedia.org/wiki/Eiffel_Tower_(Paris%2C_Texas)) | Q25223034 | 0.0m | P18 |
| Panthéon | Paris, France | [Q188856](https://en.wikipedia.org/wiki/Panth%C3%A9on) | Q188856 | 22.1m | P18 |
| Pantheon | Rome | [Q99309](https://en.wikipedia.org/wiki/Pantheon%2C_Rome) | Q99309 | 12.0m | P18 |
| St. Mary's Church | Lübeck | [Q695065](https://en.wikipedia.org/wiki/St._Mary's_Church%2C_L%C3%BCbeck) | Q695065 | 0.0m | P18 |
| St. Mary's Church | Gdańsk | [Q933903](https://en.wikipedia.org/wiki/St._Mary's_Church%2C_Gda%C5%84sk) | Q933903 | 16.3m | P18 |
| Loreta | Prague | [Q1064659](https://en.wikipedia.org/wiki/Loreta_(Prague)) | Q1064659 | 0.0m | P18 |
| Vyšehrad | Prague | [Q616334](https://en.wikipedia.org/wiki/Vy%C5%A1ehrad) | Q616334 | 131.7m | P18 |
| Sedlec Ossuary | Kutná Hora | [Q513821](https://en.wikipedia.org/wiki/Sedlec_Ossuary) | Q513821 | 3.2m | P18 |
| Rila Monastery | Rila | [Q207945](https://en.wikipedia.org/wiki/Rila_Monastery) | Q207945 | 0.0m | P18 |
| Quinta da Regaleira | Sintra | [Q2630165](https://en.wikipedia.org/wiki/Quinta_da_Regaleira) | Q2630165 | 17.2m | P18 |
| Roussanou Monastery | Kalambaka | [Q2337128](https://en.wikipedia.org/wiki/Monastery_of_Rousanou) | 空缺 | 不适用 | 空缺 |
| Borgund Stave Church | Lærdal | [Q755010](https://en.wikipedia.org/wiki/Borgund_Stave_Church) | Q755010 | 4.9m | P18 |
| Katskhi pillar | Chiatura | [Q2344182](https://en.wikipedia.org/wiki/Katskhi_Pillar) | Q2344182 | 17.9m | P18 |
| Leshan Giant Buddha | Leshan | [Q205131](https://en.wikipedia.org/wiki/Leshan_Giant_Buddha) | Q205131 | 465.9m | P18 |
| Minack Theatre | Porthcurno | [Q1752774](https://en.wikipedia.org/wiki/Minack_Theatre) | Q1752774 | 0.0m | P18 |
| Wat Rong Khun | Chiang Rai | [Q496543](https://en.wikipedia.org/wiki/Wat_Rong_Khun) | Q496543 | 47.7m | P18 |

## 接口、回归与界面

- 后端 44/44：包含聊天、规划/审核、取消、对话恢复、航班选择、来源与缓存；新增真实 HTTP 路由、离线禁止联网、Enterprise 适配、token 刷新和同名城市隔离回归。Agent 使用现有假执行器验证，未调用模型或机票供应商。HTTP 测试在没有大索引的机器也能运行，真实覆盖数字来自上述实际数据批测。
- `npm test`、`npm run check`、`npm run build` 通过；H5/微信构建完成，保留原有包体和分包建议。文档与 diff 检查通过。
- Browser plugin not available；使用已有 Playwright 1.62.1 和独立 Chrome。浏览器为 `http://127.0.0.1:4179/`，API 为隔离的 3003 端口，页面 API 原样转发到实际后端，没有伪造地点响应。真实保存的布拉格行程 D3 → 每日地图 → 查理大桥详情：坐标返回、标记可见、照片成功解码、作者/许可展示，关闭仍留在 D3。
- 页面标题 FlightOR · 界面预览；非空、无 Vite 错误遮罩、应用控制台错误/警告为 0；1440×1000、390×844、320×844 截图检查，移动端无横向溢出。该单场景不是历史行程全部景点覆盖验收。测试后关闭自己启动的服务，不替换原有 3000 服务。
- 批量照片以实际 API URL 在浏览器解码并生成三张核对拼图。查看过全组构图，发现过卢浮宫全景主体不突出；用户明确允许此类问题，不新增前景/文件名限制。作者、许可和图片源链接继续保留。图片视觉审阅不作为逐地实拍认证。
- 没有修改地图、图片组件或 DSH 三 Agent 架构；地点不是新增 Agent tool，仍由前端异步调用现有两个接口。

## 已知边界

1. 中文“卢浮宫”解析为宫殿 Q1075988，英文参考 Louvre 为博物馆 Q19675；位置相近、条目范围不同，严格指标记为不一致。需要明确博物馆时可提供明确检索名，不在测试中偷换输入。主体不突出的全景图片按用户要求暂时允许。
2. Roussanou Monastery / Kalambaka 这一输入仍未取得足够明确的候选，坐标和图片保留空缺。不会因要求全覆盖而任取附近修道院。
3. 原始离线英文快照不能独立覆盖中文名称；线上补全后才能离线复用这些别名。50km 城市邻域不是行政边界，超过范围的远郊景点可能漏匹配。
4. 首次查询需联网；Enterprise On-demand 只有精确名称/QID，模糊候选仍需 Wikidata。Commons/Wikidata 曾实际返回 429，已遵守 Retry-After、独立冷却，失败不会存成确定空缺。
5. access/id token 自动更新只在需要 API 时触发，refresh token 到期或撤销需要用户重新登录。凭证仅在本机 backend/.env，不进入代码、报告或长期记忆。
6. 未做微信模拟器/真机验收，未重新调用付费模型；新增代码需重启现有后端进程后加载。没有自动推送或发布。

复现命令见 [第三阶段说明](PLACE_RESOLVER.md#第三阶段实际界面与批量验收)。本报告可用 `node backend/scripts/report-places.mjs` 从完整的实际 JSON 重建。
