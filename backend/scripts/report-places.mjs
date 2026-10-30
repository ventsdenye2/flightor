import fs from 'node:fs/promises'
import path from 'node:path'
import { dataRoot, repo } from '../src/paths.mjs'

const directory = path.join(dataRoot, 'wikimedia-geo', 'benchmark')
const modes = ['offline-cold-final', 'online-cold-final', 'online-warm-final', 'offline-warm-final']
const reports = Object.fromEntries(await Promise.all(modes.map(async mode => {
  const report = JSON.parse(await fs.readFile(path.join(directory, mode + '.json'), 'utf8'))
  if (report.rows.length !== 36 || !report.groups) throw Error('Incomplete benchmark: ' + mode)
  return [mode, report]
})))
const labels = { 'offline-cold-final': '纯快照离线', 'online-cold-final': '首次在线（独立空缓存）', 'online-warm-final': '在线复用缓存', 'offline-warm-final': '禁用网络，复用元数据' }
const percent = value => value == null ? '不适用' : (value * 100).toFixed(1) + '%'
const ms = value => Number(value).toFixed(1)
const warm = reports['online-warm-final']
let text = `# PlaceResolver 实际验收

分支：backend-mvp。离线索引提交：\`abcbc94\`；统一解析与 Enterprise 优先提交：\`983397e\`；本报告随第三阶段验收提交。

## 数据与方法

下载并校验三个官方文件共 1,566,037,974 字节（十进制约 1.57GB）；索引含 11,969,264 条具名地理实体，SQLite 为 2,586,206,208 字节。它不是纯景点分类库，原表无完整城市字段和中文名。许可、哈希、重建及 API 合同见 [PlaceResolver](PLACE_RESOLVER.md)。数据、索引、凭证、HTTP 原始缓存均被 Git 忽略。

固定 36 个地点：中文 10、英文 10、同名 5、小众 11。参考由独立 Wikipedia API 冻结，解析器只接收名称与城市，不传预期 QID。位置符合率以参考点 500m 内计算；严格一致率额外要求 QID 一致。参考与目标同属 Wikimedia 生态，属于来源一致性核对，不能当作独立测绘真值。Loreta 初始参考误指消歧义页，已依据实际文章修为 Loreta (Prague)，初始参考保留在忽略目录，不修改解析输入。中文卢浮宫与英文 Louvre 的不同条目范围保持为不一致，不调整参考凑通过。

耗时是顺序定位加配图的合计，包括必要网络等待；不是前端并行两接口的单个请求时延。四轮分开记录，冷启动目录为空时才能运行。原始 JSON、各次失败和日志位于 \`backend/data/wikimedia-geo/benchmark/\`。

## 批测结果

| 模式 | 坐标覆盖 | 500m 内/已返回 | 严格 QID+位置一致 | 图片覆盖 | 图片 QID 一致/已返回 | 平均耗时 | P95 | 网络请求 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
`
for (const mode of modes) {
  const { summary: s, http } = reports[mode]
  text += `| ${labels[mode]} | ${s.coordinates}/36 (${percent(s.coordinateCoverage)}) | ${s.coordinatePositionCorrect}/${s.coordinates} | ${s.coordinateCorrect}/${s.coordinates} (${percent(s.coordinatePrecision)}) | ${s.images}/36 (${percent(s.imageCoverage)}) | ${s.images ? percent(s.imageEntityAgreement) : '不适用'} | ${ms(s.meanMs)}ms | ${ms(s.p95Ms)}ms | ${http.network} |\n`
}
text += `
图片 QID 一致率不是人工视觉准确率，也不证明主体占比、照片时效或任意返回图片都适合封面。图片只缓存元数据，离线模式下已有远程 URL 不等于图片二进制可离线加载。

| 分组（在线复用） | 坐标 | 严格匹配 | 图片 | 图片实体一致率 |
| --- | --- | --- | --- | --- |
`
for (const [group, s] of Object.entries(warm.groups)) text += `| ${group} | ${s.coordinates}/${s.total} | ${s.coordinateCorrect}/${s.coordinates} | ${s.images}/${s.total} | ${percent(s.imageEntityAgreement)} |\n`
text += `
## 逐景点结果（在线复用）

| 名称 | 城市 | 参考 QID | 返回 QID | 位置距离 | 图片与来源路径 |
| --- | --- | --- | --- | --- | --- |
`
for (const row of warm.rows) text += `| ${row.input.name} | ${row.input.city} | [${row.reference.qid}](${row.reference.source}) | ${row.qid || '空缺'} | ${row.offsetM == null ? '不适用' : ms(row.offsetM) + 'm'} | ${row.media ? row.evidence?.method || '有图' : '空缺'} |\n`
text += `
## 接口、回归与界面

- 后端 44/44：包含聊天、规划/审核、取消、对话恢复、航班选择、来源与缓存；新增真实 HTTP 路由、离线禁止联网、Enterprise 适配、token 刷新和同名城市隔离回归。Agent 使用现有假执行器验证，未调用模型或机票供应商。HTTP 测试在没有大索引的机器也能运行，真实覆盖数字来自上述实际数据批测。
- \`npm test\`、\`npm run check\`、\`npm run build\` 通过；H5/微信构建完成，保留原有包体和分包建议。文档与 diff 检查通过。
- Browser plugin not available；使用已有 Playwright 1.62.1 和独立 Chrome。浏览器为 \`http://127.0.0.1:4179/\`，API 为隔离的 3003 端口，页面 API 原样转发到实际后端，没有伪造地点响应。真实保存的布拉格行程 D3 → 每日地图 → 查理大桥详情：坐标返回、标记可见、照片成功解码、作者/许可展示，关闭仍留在 D3。
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

复现命令见 [第三阶段说明](PLACE_RESOLVER.md#第三阶段实际界面与批量验收)。本报告可用 \`node backend/scripts/report-places.mjs\` 从完整的实际 JSON 重建。
`
await fs.writeFile(path.join(repo, 'docs', 'PLACE_RESOLVER_ACCEPTANCE.md'), text)
console.log('Wrote docs/PLACE_RESOLVER_ACCEPTANCE.md from four complete 36-place runs')
