# 活动研究实验：来源抽查记录

记录日期：2026-09-13（Asia/Shanghai）。执行者：Codex AI。范围：旧 `pilot-02` 与 `research-screen-v2` 中已经发现的少量主张，以及文末单独记录的 v3 固定案例抽查。各协议的记录独立保留。

本记录采用人工逐条阅读、对照来源的方式，由 AI 执行。它不是两名人类独立盲评，也不是全量、随机或预先固定样本的质量评分。执行者能看到模型及架构名称，样本选择含问题导向，因此不计算总分、错误率、模型排名或胜率。

读取内容包括保存的原始回答、检索引文片段、规范化结果与 current-system 原始 artifact。必要时只读访问官方页面核对特定主张，未新增付费模型调用。下列“官方页面”是在本次抽查日访问的页面；“样本片段”是运行当时实际保存的证据。两者不能互换：审核时能看到完整页面，不代表生成时模型看到了同样内容。未来日期的票额、排班与临时关闭没有据此获得确认。

## 判定口径与协议边界

| 判定 | 本记录中的含义 |
| --- | --- |
| 与官方信息冲突 | 被抽查的具体主张与所列官方页面不一致；不延伸为整条回答全错。 |
| 证据不足／概括过度 | 保存的片段无法支撑该精度、日期或范围的主张；不等于已证明外部事实为假。 |
| 部分支持 | 指定事实有来源支持，同时列出尚未覆盖的限制。 |
| 正面行为 | 保留未知项、承认部分结果等可观察行为；不是该模型的综合质量分。 |

`pilot-02` 早于 v2 显式合同修正；`research-screen-v2` 使用 `research-v2-explicit-contract`。旧 pilot/v2 的错误不得并入 v3 后算作某模型的质量成绩，也不得用后来的修正覆盖旧样本。跨协议差异可能同时来自提示、schema、路由及检索结果。所有结论只针对列出的样本和主张，且限于研究组件，不代表完整 Planner、持久化或用户交付验收。

## QC-01：观鲸船“11 月 30 日全年最后一班”与运营方信息冲突

- 样本：[research-screen-v2/sample-008.json](../../experiments/travel-research/results/2026-09-13/runs/research-screen-v2/sample-008.json)
- 案例／模型／架构：`activity-16`；`deepseek/deepseek-v4-flash-0731`；`thin-web`。
- 请求窗口：2026-11-23 至 2026-11-25，先核实“蓝月鲸鱼节”，再研究文化或极光候选。
- 定位：`trace[0].response.message.content` 中第二个 finding；该回答含英文过程文本和 Markdown JSON 围栏，样本记录为 `invalid_json`，这里仍对其可读内容进行独立抽查。

**具体主张。** 标题称“雷克雅未克观鲸船（11月30日为全年最后一班）”；正文进一步断言 2026-11-30 后停至春季。

**样本已有证据。** 非运营方旅游文章 [Best Iceland Tours 的 11 月指南](https://best-iceland-tours.com/iceland-in-november) 的保存片段确实给出这一说法。回答同时引用了 Whale Safari 的 Classic Whale Watching 页面，但该页面在样本中的片段只有活动概述，没有全年运营信息。因此这不是无来源凭空生成；问题在于采信了概括性二手主张并把另一链接并列为支持。

**官方核对与限制。** 被回答引用的 [Whale Safari：Reykjavík Classic Whale Watching](https://whalesafari.is/activity/reykjavik-classic-whale-watching) 明确说明该产品全年提供；同页说明可能因天气临时取消，野生动物出现也无法保证。全年提供不等于 2026-11-23 至 25 每个班次已确认，更不证明所有观鲸产品全年运营。

**判定。** “11 月 30 日后雷克雅未克没有观鲸船直至春季”的概括与所引官方产品页面冲突。应限定到具体运营方和产品，删去未经核实的全城停航结论，保留日期、天气及班次待确认。回答把节庆标为未证实、没有保证极光可见，是另一个可观察的正面行为；此次没有穷尽检索，不能据此证明节庆绝不存在。

## QC-02：深川江户资料馆闭馆规律被过度概括

- 样本：[pilot-02/sample-001.json](../../experiments/travel-research/results/2026-09-13/runs/pilot-02/sample-001.json)
- 案例／模型／架构：`activity-01`；`deepseek/deepseek-v4-flash-0731`；`thin-web`，旧 pilot。
- 请求窗口：2026-10-14 至 2026-10-16。
- 定位：`trace[0].response.message.content` 中“清澄白河街区散步与深川江户资料馆”的 `bookingRequirements`。旧输出使用 `description`、`rationale` 等字段并含围栏，不符合后来统一的 finding 合同。

**具体主张。** 回答要求确认闭馆日，同时补充“通常周一休馆”。它引用的两篇旅游内容保存片段介绍街区历史和展示空间，没有给出该闭馆规则。

**官方核对与限制。** [深川江户资料馆：馆的概要](https://www.kcf.or.jp/fukagawa/outline/) 指定每月第二、第四个星期一闭馆，遇节假日则开馆，另有年末年始和临时闭馆规则。不能将其简化为每周一闭馆。

**判定。** 闭馆规律概括不准确；“需核实”的提示不能替代正确的规律表述。该旅行窗口为周三至周五，因此本问题没有直接证明请求中的三天无法参观；是否存在临时关闭仍未核实。本文也未核实该候选的全部历史描述、时长和票务信息。

## QC-03：根津美术馆的名称被写成不清晰的地理方向

- 样本：[research-screen-v2/sample-002.json](../../experiments/travel-research/results/2026-09-13/runs/research-screen-v2/sample-002.json)
- 案例／模型／架构：`activity-01`；`moonshotai/kimi-k2.6`；`thin-web`。
- 请求窗口：2026-10-14 至 2026-10-16。
- 定位：`result.findings` 中“表参道至根津美术馆 建筑街区漫游”的 `summary`，并对照原始回答。

**具体主张。** 回答称“向根津方向延伸可至根津美术馆”，并描述其为“竹林环绕的地下建筑”。同一回答还推荐了谷中、根津、千驮木街区，容易让读者把“根津方向”理解成根津街区。

**样本已有证据。** 该 finding 唯一引用的 [JeePe 表参道指南](https://www.jeepe.jp/zh/articles/omotesando-area-guide-1547) 保存片段写的是向御幸通方向延伸，并提到可向原宿或青山拓展；并非向根津街区延伸。

**官方核对与限制。** [根津美术馆官方参观指南](https://www.nezu-muse.or.jp/en/visit/) 给出地址为港区南青山 6-5-1，从表参道站 A5 出口步行约 8 分钟。该信息支持“表参道—南青山—根津美术馆”的路线关系。

**判定。** 地理表述发生名称与区域的混淆风险，应改成南青山／御幸通方向，并明确目的地是根津美术馆。“地下建筑”在保存片段中没有依据，此项记为证据不足；本次没有完成建筑结构专项核查，不给出整座建筑是否含地下空间的结论。参观日展览、门票及预约可用性也没有全面核实。

## QC-04：current-system 京都结果主要是资料入口，片段不足以确立具体活动

- 样本：[research-screen-v2/sample-006.json](../../experiments/travel-research/results/2026-09-13/runs/research-screen-v2/sample-006.json)
- 案例／模型／架构：`activity-07`；`deepseek/deepseek-v4-flash-0731`；`current-system`。
- 请求窗口：2026-11-03 至 2026-11-05，研究红叶及夜间特别开放，区分往年规律和当年公告。
- 定位：`currentSystem.artifact.findings` 的原始 `summary`、`sources[].snippet`、`verification`、`warnings`，以及规范化的 `result`。

这里主要审查“输出是否被当次可见证据支持”，没有重新穷尽京都各场所的 2026 年公告。

| 具体输出主张／候选 | 保存的来源及证据限制 | 判定 |
| --- | --- | --- |
| “11 月 3—5 日是往年的最佳观赏时期；当年的预测尚未公布” | [Weathernews 京都红叶日历](https://weathernews.jp/koyo/area/kyoto/calendar.html) 的片段只说日历基于 2004—2025 年数据，并请到名所页面查看 2026 年预测。片段没有给出 11 月 3—5 日为最佳期，也不能证明预测尚未公布。 | 两项精确断言均超出保存片段；记为证据不足，不据此判定实际物候或公告状态。 |
| “2026-10-31 至 12-06 有特别开放，并包含灯光活动，适合请求窗口” | [京都观光官方站“红叶便り”](https://ja.kyoto.travel/flower/momiji) 的保存片段是被截断的目录文本，先有特别开放日期，后接另一个特别开放／灯光字样；没有完整场所、日期与活动的对应关系。 | 无法确认日期适用于哪一处夜间活动；输出虽然承认缺少地点和时间，仍不足以成为具体候选。原始 finding 已标 `event_date_is_snippet_only`。 |
| “京都红叶信息（现场报告）”“避开拥挤的红叶名所／小众景点”被标为 `activity` | [JR 东海“そうだ 京都、行こう”红叶信息](https://souda-kyoto.jp/guide/season/koyo/index.html) 的片段说有约 75 处色彩信息；[JR 东海京都秋游页面](https://travel.jr-central.co.jp/plan/area/kyoto/autumn) 的片段介绍名所、交通与旅游方案。二者支持作为继续研究的资料入口，没有在输出中落实具体场所和行动。 | 目录摘要有检索价值，但候选具体性不足。这里没有认定来源目录本身错误。 |

**保留的原始限制。** 五个 finding 的 `verification.status` 均为 `unverified`，均有 `evidence_unverified`；活动日期条目另有 `event_date_is_snippet_only`。这说明领域 artifact 保留了未核实边界，不能将其报告成五个已核实活动。

**报告表示的风险。** 该旧样本规范化后为 `disposition: recommend`、`uncertainties: []`，且 `status: responded`。这些字段没有完整表达上述逐条警告。抽查必须读取原始 artifact；“返回成功”和“引用 URL 可关联”都不等于候选事实成立。输出主要为日文；current 生产提示与 thin 的中文要求不同，本记录不把语言差异归因为模型能力差异。

## QC-05：Qwen 轮椅案例的部分结果是正面例，同时仍需保留细节限制

- 样本：[research-screen-v2/sample-004.json](../../experiments/travel-research/results/2026-09-13/runs/research-screen-v2/sample-004.json)
- 案例／模型／架构：`activity-03`；`qwen/qwen3.8-flash`；`thin-web`。
- 定位：`result.disposition`、`result.findings`、`result.uncertainties`，并对照原始回答和引文片段。

**正面行为。** 返回两项候选，并明确 `disposition: partial`；说明检索次数限制下未取得其他候选的详细无障碍证据，还保留轮椅库存、室外遮阴和接驳运营状态待确认。最多六项不是必须凑足六项；减少数量并说明限制，在本次样本中是合理行为。

| 具体主张 | 官方核对与限制 | 判定 |
| --- | --- | --- |
| 国家美术馆展览空间可供轮椅使用、各层有电梯、可借用轮椅；部分通往电梯大堂的门较重 | [新加坡国家美术馆无障碍指南](https://www.nationalgallery.sg/sg/en/visit/guides/accessibility.html) 支持这些事实。重型手动门提示位于停车场前往电梯大堂的说明中；轮椅免费借用按先到先得。网页还推荐 Coleman Street 无台阶入口，不能将“重门”泛化成所有入口均需推重门。 | 关键无障碍事实有官方支持，且回答提醒可能需要家人协助；完整到达路线和全部设施未完成核实。 |
| 滨海湾花园提供轮椅租赁，轮椅使用者可免费乘接驳服务 | [滨海湾花园官方设施与服务](https://www.gardensbythebay.com.sg/en/plan-your-visit/amenities-and-services.html) 支持轮椅租赁与轮椅乘客免费接驳。官方同时要求照护者购票，并限制轮椅折叠方式、尺寸和重量；运行可能临时调整。 | 核心事实部分支持，但输出遗漏照护者收费及轮椅适配条件。前者已在样本片段出现，后者本次从完整官方页补核；不能假定模型当时看到了后者。 |

样本还描述空调、平坦路径、室外遮阴及座椅；本文没有逐一全面复核这些主张，也没有核实出行日每条路线的实时可用性。因此此条是“有来源的部分回答与不确定性表达”的正面例，不是无障碍方案验收通过。旧报告里的 `responded` 也不能掩盖模型实际给出的 `partial`。

## 后续使用方式

这些记录可用于检查通用研究合同：候选应有具体对象与适用日期；来源链接须支持相应主张；官方限制和逐条未核实警告应保留到呈现层；部分结果可以独立成立。它们不支持增加城市专用规则或针对单个模型修补提示。

如果后续对 v3 重复样本做抽查，应另记 run、sample、协议与主张，采用相同判定口径。若要发布质量成绩，需要先确定统一抽样与评审方法，再完成覆盖范围内的事实复核；不能把本文的定向发现直接换算为旧协议或新协议的模型分数。

## V3：三个固定案例、三个模型的独立抽查

追加日期：2026-09-13。固定集为 `activity-03`（全程手动轮椅）、`activity-14`（旅行窗口与不可改期预约冲突）、`activity-16`（未证实节庆），各检查 Qwen、GLM、Kimi 一份输出，共九份。样本来自 `research-screen-v3` 和 `candidate-screen-v3`，两者 manifest 均记为 `research-v3-aligned-contract-routing`；本节全部为 `thin-web`。模型分别是 `qwen/qwen3.8-flash`、`z-ai/glm-5.3-flash`、`moonshotai/kimi-k2.6`。GLM 使用其要求的 low reasoning 配置，该差异不能在模型比较中隐去。

本节只核对保存的请求、`trace[0].response.message.content`、`annotations[].url_citation` 与 `result`，未新增网页查询或付费模型调用。即使 parser 失败，也阅读原文，但不修复文件、不把原文中的可识别对象记为结构通过。每项观察均由 AI 按人工阅读方式完成，执行者可见模型名；这仍不是两名人类盲评或全量成绩。固定案例改善了本次范围的可复查性，不使它成为随机代表性样本，也不支持跨协议排名。

### V3 样本索引

| 记录 ID | 案例／模型 | 原始样本路径 | 保存的结构结果 |
| --- | --- | --- | --- |
| V3-03-Q | activity-03／Qwen | [research-screen-v3/sample-004.json](../../experiments/travel-research/results/2026-09-13/runs/research-screen-v3/sample-004.json) | `valid: true`，`disposition: partial` |
| V3-03-G | activity-03／GLM | [candidate-screen-v3/sample-004.json](../../experiments/travel-research/results/2026-09-13/runs/candidate-screen-v3/sample-004.json) | `valid: true`，`disposition: partial` |
| V3-03-K | activity-03／Kimi | [candidate-screen-v3/sample-013.json](../../experiments/travel-research/results/2026-09-13/runs/candidate-screen-v3/sample-013.json) | `valid: true`，`disposition: recommend` |
| V3-14-Q | activity-14／Qwen | [candidate-screen-v3/sample-024.json](../../experiments/travel-research/results/2026-09-13/runs/candidate-screen-v3/sample-024.json) | `invalid_finding:0`；仍提取到 `disposition: clarify` |
| V3-14-G | activity-14／GLM | [candidate-screen-v3/sample-003.json](../../experiments/travel-research/results/2026-09-13/runs/candidate-screen-v3/sample-003.json) | `valid: true`，`disposition: clarify` |
| V3-14-K | activity-14／Kimi | [candidate-screen-v3/sample-001.json](../../experiments/travel-research/results/2026-09-13/runs/candidate-screen-v3/sample-001.json) | `invalid_envelope` |
| V3-16-Q | activity-16／Qwen | [candidate-screen-v3/sample-033.json](../../experiments/travel-research/results/2026-09-13/runs/candidate-screen-v3/sample-033.json) | `invalid_json` |
| V3-16-G | activity-16／GLM | [candidate-screen-v3/sample-023.json](../../experiments/travel-research/results/2026-09-13/runs/candidate-screen-v3/sample-023.json) | `invalid_envelope` |
| V3-16-K | activity-16／Kimi | [candidate-screen-v3/sample-037.json](../../experiments/travel-research/results/2026-09-13/runs/candidate-screen-v3/sample-037.json) | `invalid_json` |

表中仅转录逐份结构结果，不将其换算为质量总分。下文使用这些记录 ID 定位原始样本。

### Activity-03：是否把轮椅约束落实到具体障碍

请求是 2026-11-05 至 07 带 72 岁父亲游览新加坡，全程手动轮椅、家人推行，不接受必须走台阶的路线；优先避热、休息，并说明入口、电梯或通道依据。

| 样本 | 可观察的约束处理与具体主张 | 保存证据对应关系／限制 | 判定 |
| --- | --- | --- | --- |
| V3-03-Q | 两个场所加两条配套实用信息，明确为 `partial`。保留国家美术馆重门、轮椅先到先得；滨海湾花园陪同者须购接驳票，升降平台操作与重量限制待确认；出行日时间、票价、库存仍未知。 | 美术馆和花园官方引文片段支持重门、借椅、费用与接驳时段。升降平台的描述来自另一条第三方 [Chair Went There](https://www.chairwentthere.com.au/singapores-gardens-by-the-bay-in-a-wheelchair/) 已保存片段，但对应 finding 的 `sourceUrls` 只列官方设施页和 Hovicare；主张与逐项引用未完全对齐。外部到达全路径未建立。 | 具体障碍与未知项保留较明确，没有凑满六个活动或保证未来设备可用。平台信息应保持第三方、未验证属性，并关联实际支持片段；不能据此验收整条路线无台阶。 |
| V3-03-G | 两个场所，`partial`；注明折叠轮椅、接驳尺寸、陪同者购票、工作人员协助、恶劣天气停运；明确冷室内部替代台阶的坡道／电梯尚未逐项确认。 | 花园官方保存片段确含这些限制。美术馆停车场至 B 电梯厅重门也有支持。但输出将 Coleman Street 入口举例写成“周三至周五 10:00–15:00”；保存的官方 [Visitor Information](https://www.nationalgallery.sg/sg/en/visit/visitor-information.html) 片段实际为 `Wed–Fri, 10am – 3am`。 | 保留了关键障碍和未来日期限制；入口时刻存在明确的片段转述错误，把凌晨 3 点改成下午 3 点。此处只判定转述不一致，不替用户确认未来入口运营时间。 |
| V3-03-K | 五条活动加一条动物园实用信息，`recommend`。明确美术馆重门、接驳陪同者收费，并指出动物园导览车有 0.38 米台阶，未确认无台阶替代；各场所保留未来开放与维护未知项。 | 美术馆、花园、动物园及 Reflections at Bukit Chandu 有官方保存片段支持相应设施描述。国家博物馆无台阶入口、植物园特定步道、花园 Skyway 等主要依赖第三方片段；没有逐项建立抵达场馆的完整路径。花园摘要称“轮椅可全程通行”，但 `uncertainties` 又说云雾林内部是否完全无台阶未确认。 | 导览车台阶被明确作为障碍记录，没有宣称已解决；但花园“全程通行”的肯定表述与自身未知项张力明显，应限定已知可达区域。总体 `recommend` 不能覆盖各条未验证条件。 |

三份均不能当成无障碍路线验收。表内肯定只针对观察到的约束表达与对应片段；未核实整个场馆、交通接驳、休息设施及出行日临时变化。

### Activity-14：是否先解决日期冲突再研究附近活动

请求同时保留 2026-10-10 至 12 的巴黎旅行窗口和只能 10-17 使用、不可改期的预约，并明确要求先指出冲突、询问以哪个时间条件为准，不自行改写日期。该判断来自请求自身，不需要外部检索。

| 样本 | 原文中的澄清行为 | 可观察问题与判定 |
| --- | --- | --- |
| V3-14-Q | 明确指出两个条件不重叠，声明不移动日期，询问优先条件和预约地点；原文 `disposition` 为 `clarify`。 | 首个澄清 finding 缺少合同要求的 `sourceUrls`，导致 `invalid_finding:0`。随后已研究 Le Large、蒙马特美术馆、Jeu de Paume、奥赛四个条件性文化候选，并扩展到 10-20 后停留的假设，超出当前只需解决冲突的澄清任务。并未声称用户已经修改日期，但“先澄清再研究”的行为边界没有守住。保存的 Jeu de Paume 片段确给出 10-20 开展，因此也无法支持原旅行窗口。此处不全面核实这些展览。 |
| V3-14-G | 正确指出旅行窗口不包含 10-17，返回 `clarify` 和空 findings；说明未澄清前不改日期、不推荐活动。 | 结构和核心澄清行为可观察成立，但进一步追问预约场馆、时段、新日期和处理方式，增加当前非必要信息负担；末尾又提出“尝试转让或改期——尽管您说明其不可改期”。这是与已知硬约束不一致的建议，不是已经执行改期。 |
| V3-14-K | 可读原文明确指出冲突，比较维持旅行窗口与围绕预约两种条件，询问用户选择；无活动推荐、无地点编造、无静默改日。 | 原文把实例字段放进 schema 风格的 `properties` 对象，外层还有 `type`、`required`、`additionalProperties`，因此 `invalid_envelope`。内容上的核心澄清成立，数据合同仍失败；不能因为读者能理解就把它记成调用成功。 |

`clarify` 标签本身不足以证明行为符合要求：应同时看是否继续作出依赖尚未解决条件的推荐，以及是否重复打开用户已排除的选项。

### Activity-16：节庆是否保持“未证实”，日期与天气限制是否保留

请求窗口为 2026-11-23 至 25。用户只提供无链接帖子中的“11-24 蓝月鲸鱼节”，明确要求查不到可信公告就标未证实，且不能保证极光可见。正确边界是拒绝把未经证实的线索当事实，不能把未检索到等同于已经证明节庆不存在。

| 样本 | 原文中的节庆与天气处理 | 保存证据对应关系／限制及判定 |
| --- | --- | --- |
| V3-16-Q | 标为 `partial`，节庆“尚未证实”，保留名称误传等可能性，没有断言绝对不存在；明确极光不可保证，具体班次、票价、场馆开放未知。 | 英文过程文本位于 JSON 前，导致 `invalid_json`。仍转述二手资料“全年最后一班观鲸船 11-30”，但实际观鲸候选注明公司季节不同、日期未确认，没有像旧样本那样明确断言全城停至春季。文化候选用市政主页作引用，其保存片段是主页碎片，无法支持具体博物馆和街区描述；此项仅记证据不足。 |
| V3-16-G | 节庆“未证实”，建议不据此排行程；说明极光依赖天气与太阳活动；明确音乐节 11-05 至 07 不在请求窗口，并保留班次与场馆开放未知项。 | 顶层额外输出 `type`、`additionalProperties`，导致 `invalid_envelope`。同一回答既推测节庆可能误传自“11-30 年末最后一次观鲸”，又给出经典观鲸全年运营；前者只是未经证实的解释，应避免增加新的猜测。保存的运营方片段支持全年经典观鲸及 9 月至 4 月组合产品，但不能把常规季节表提升为已确认的“11 月每日发班”。该每日断言和后续班次待确认之间不够一致。 |
| V3-16-K | 可读原文将节庆标为尚未证实，没有编造主办方或节目表；明确 11-23 至 25 不能保证极光可见，并指出 Airwaves 音乐节不在请求窗口。 | 原文含 schema 外壳且结尾没有闭合外层对象，保存结果为 `invalid_json`；内层仍写 `disposition: recommend`。末条明确断言 11-30 是雷克雅未克常规观鲸季终点，但同份保存的 [Whale Safari 组合产品](https://whalesafari.is/activity/reykjavik-whales-northern-lights) 引文列有 12 月至次年 4 月的观鲸与极光时段，因此是同份证据内未解决的冲突。音乐节标题写“已结束”只能理解为相对 11 月旅行窗口，不能当成相对本次 9 月研究日期已结束。 |

三份原文都保留了节庆未证实和极光不可保证的边界；这只是指定主张的内容观察。搜索返回的目录或二手文章没有出现节庆名称，不构成其不存在的证明。本节不计算结构成功率、事实正确率或综合分，也没有完整核查全部文化候选、物种描述、重游条款及票务信息。

### 固定九份之外：v3 DeepSeek 附注

[research-screen-v3/sample-008.json](../../experiments/travel-research/results/2026-09-13/runs/research-screen-v3/sample-008.json) 是 DeepSeek 的 `activity-16`，不属于上述九份固定集。原文同样标节庆未证实、极光不可保证，但 JSON 前含英文过程文本而记录为 `invalid_json`；仍将 11-30 写成当年最后一班观鲸船。另提及截至 2026-04-15 的极光中心免费入场政策，同时把之后是否延续列为未知：旧日期不能支持 11 月仍享有该权益。此附注只保留该样本的可观察内容，不与旧 v2 合并，也不并入三模型固定集的任何统计。
