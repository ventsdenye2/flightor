# ADR 0023：正文快照与原文声明绑定

2026-09-21。当前实现；测试与真实执行结果见 [progress](../design/budget-travel-agent/progress.md)。G1 不因源码完成而放行。

## 读取和权威边界

原 SerpApi Research 只有摘要，且东京 curated 查询仅包含旅游门户，不能据此纠正运营方的最新事实。本次在现有 ProductionResearchAgent 的搜索与综合之间注入 PublicResearchSourceReader，最多读取 4 页、并发 2；不增加搜索或模型轮次。优先官方场馆/运营方，其次公共旅游，再次其余结果。非官方来源也可作为明确标注的参考正文，读取不改变其权威分类。读取失败或达到上限显式 warning，未知不补造。

服务端 curated 数据新增 `tokyometro.jp`、`meijijingu.or.jp`，保持统一策略接口，不增加城市名匹配或票价替换规则。2026-09-21 核对 [地铁运营方](https://www.tokyometro.jp/en/ticket/1day/index.html) 和 [场馆访问页](https://www.meijijingu.or.jp/en/visit/)，仅精确主机（兼容 www）取得 official_organizer/official_venue 身份。来源声明、标题里的 official 和未知子域不能取得身份。注册表不是全球官方目录。

安全读取见 [reader 说明](../design/budget-travel-agent/SOURCE_READER.md)：公开 IPv4、DNS 固定、HTTPS/443、拒绝重定向和压缩、256 KiB/12k 文本、8 秒全阶段期限、父取消；不执行 HTML，不携带业务凭据。正文是模型输入数据，不能指示工具动作。搜索服务返回的 page 会被 normalizeSource 丢弃，只有 server reader 的已校验结果才能成为正文快照。

## 原文证据合同

Research source 可选 `page={text,retrievedAt,contentHash}`；哈希为规范化文本的 SHA-256。finding 可选 `claimEvidence`，每项包含 kind（price/opening_hours/transit_duration）、subject（产品、客群、条件）、原文 value、sourceUrl、quote、retrievedAt、contentHash、固定 `status=source_observed`。最多 8 项。模型仅选择 sourceIndex 与原文，服务器检查索引属于该 finding 已选来源、quote 连续包含于实际正文、value 在 quote 内、时间/哈希与快照一致。

这证明出处和抄录，不证明 subject 的语义、价格当前有效、未来出行日有效或覆盖所有正文事实。没有有效期时仍保持未知；不提供模型自报 verified。模型 prompt 要求没有正文就不要在摘要复述具体价格/营业时间/交通时长；最终自由文本的完全遵循仍须真实验收。

同一 finding 内，相同 kind+规范化 subject 出现不同 value 时保留两份证据并标记冲突；不静默挑选。攻略保存和 durable validator 共用规则，拒绝未解决冲突、被拒绝的声明或丢失/篡改的原文证据。不同拼写、同义单位或跨 finding 的语义冲突尚不自动检测；因此不能宣称通用事实校验完成。

已核对的官方场馆/运营方只有附带有效正文快照时才进入部分核验资格，仍不产生 verified；旅游门户的原部分核验规则保持。攻略 item/supportingEvidence 原样携带 claimEvidence，sourceApplicability 继续 reference_only。正文读取及工具 schema 对 Planner 可见，并保留逐项 warnings。

## 接入、兼容与观测

当前默认 Cloud Planner 的 SerpApi Research 注入 reader；NativeResearchAgent、其他独立 discovery 调用和未注入 reader 的构造保持原行为。无数据库迁移、依赖或模型/环境配置改动。Research v2、Guide v1 为可选 JSON 扩展，旧记录可读；旧 strict reader 不保证接受新字段，回滚须先处理含新增字段的记录。

每页 HTTP 记录 research-source-read span，嵌入原 research_destination 阶段，不与父耗时相加。读取公开网页不占 SerpApi 搜索次数，亦不是新的模型调用；仍有 4 页硬上限。原 US$2 累计账本不清零。

验收 runner 新增 `G1_CASE=self-ticket|selected-flight`，只选择既定输入，不改变其文本或额度；省略仍跑两例。单例通过不能冒充完整两例 G1。HTTP 403 或其他失败明确记录，不能用 Codex web 工具代替应用 reader 成功。

## 真实复验暴露的未封闭路径

[9月21日单例](../design/budget-travel-agent/G1_SOURCE_RETEST_2026-09-21.md) 仍在无claimEvidence时输出具体票价。当前可选字段合同只校验已声明证据，不证明散文不存在未声明事实；预算文字也未受结构合计约束。G1因此不放行，后续需结构化用户事实输出，不能把此ADR称为完整事实核验。
