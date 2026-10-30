import { media } from './media'

export type ExploreCategory = string
export interface ExploreItem {
  id: string
  title: string
  subtitle: string
  photo: string
  photoDescription: string
  destination: string
  featured?: { title: string; subtitle: string; badge: string }
  rhythmTitle?: string
  arrival?: { label: string; route: { code: string; label: string }[]; note: string; checks: { title: string; description: string }[]; prompt: string }
  category: ExploreCategory
  source: string | null
  sourceName: string
  photoSource: string | null
  credit: string
  eyebrow: string
  duration: string
  summary: string
  keywords: string
  highlights: { title: string; description: string }[]
  rhythm: { label: string; title: string; description: string }[]
  practical: string[]
  prompt: string
}

export const exploreItems: ExploreItem[] = [
  {
    featured: { title: '把日子，交给里斯本。', subtitle: '老城慢走、河岸午后，和一场值得等待的日落。', badge: '本期目的地 · 葡萄牙' },
    rhythmTitle: '7 天，可以这样展开',
    arrival: {
      label: 'LIS · 航线示意与抵达准备',
      route: [{ code: 'PVG', label: '上海' }, { code: 'DOH', label: '多哈' }, { code: 'LIS', label: '里斯本' }],
      note: '航线仅作界面示例，并非已查询的可售结果。',
      checks: [
        { title: '先确认航班', description: '出发日期、航段、行李和中转衔接，需结合真实报价与票规核验。' },
        { title: '再衔接住宿', description: '根据落地时刻、住宿位置与同行需求选择接驳；当前不预填未经核验的时间或费用。' },
        { title: '抵达日留一些空白', description: '安顿与休息放在前面，首日活动随航班和体力调整。' }
      ],
      prompt: '我想从上海出发，去里斯本旅行 7 天，2 人同行。喜欢老城漫步、河岸和观景，节奏轻松，每天留一些自由时间。请把抵达机场到住宿的交通也纳入规划，并清楚列出尚待确认的信息。'
    },
    id: 'explore-lisbon', title: '里斯本', subtitle: '老城、河岸，和不用赶路的日子', photo: media.hero, photoDescription: '里斯本城市与河岸 · 氛围参考', destination: '里斯本', category: '目的地',
    source: 'https://www.visitlisboa.com/', sourceName: 'Visit Lisboa',
    photoSource: 'https://unsplash.com/photos/es7bSg9VPP0', credit: 'Aswin / Unsplash',
    eyebrow: 'PORTUGAL · LISBON', duration: '7 天灵感', keywords: '葡萄牙 lisbon lisboa lis 城市 海边 河岸 老城',
    summary: '从一段老城漫步开始，把河岸留给午后，再给城市的高处一点时间。这份灵感将停留之间的空白，也放进了旅行里。',
    highlights: [
      { title: '把老城拆成两次走', description: '不必在同一天走完所有街巷。先选一个片区，在喜欢的地方多停一会儿。' },
      { title: '一天，只留一个重心', description: '城堡、河岸与观景分别安排，让每天的节奏都能轻一些。' },
      { title: '把最后一天留白', description: '重访喜欢的角落，也给收拾行李和返程衔接留下余量。' }
    ],
    rhythm: [
      { label: 'D1–2', title: '抵达，熟悉这座城', description: '首日安顿，次日从阿尔法玛与城堡展开。' },
      { label: 'D3–5', title: '老城之外，慢慢延伸', description: '在街区漫步、河岸散步与城市观景中选择，每天保留自由时间。' },
      { label: 'D6–7', title: '留白，然后从容离开', description: '为喜欢的地方再留半天；返程交通随实际航班确认。' }
    ],
    practical: ['此页是固定的旅行灵感，尚未核验门票、开放时间、天气与活动可用性。', '实际日期、出发地、预算与同行人确定后，再核对航班、住宿和每天的衔接。'],
    prompt: '我想从上海出发，去里斯本旅行 7 天，2 人同行。喜欢老城漫步、河岸和观景，节奏轻松，每天留一些自由时间。'
  },
  {
    id: 'explore-alfama', title: '走进阿尔法玛的小巷', subtitle: '不赶路的老城半日', photo: media.alfama, photoDescription: '阿尔法玛街区', destination: '里斯本', category: '城市漫步',
    source: 'https://www.visitlisboa.com/', sourceName: 'Visit Lisboa',
    photoSource: 'https://unsplash.com/photos/JejHeHnfb0E', credit: 'Dmitry Voronov / Unsplash',
    eyebrow: 'ALFAMA · CITY WALK', duration: '半日灵感', keywords: '里斯本 lisbon 老城 街区 咖啡 街巷 alfama',
    summary: '选一段街巷，用步行的速度认识里斯本。遇见喜欢的街角就停下来，让散步、拍照和休息自然连在一起。',
    highlights: [
      { title: '沿街发现细节', description: '留意建筑立面、街巷转角与生活气息，给拍照留出从容的时间。' },
      { title: '休息也算安排', description: '途中找一个愿意停下来的地方，不将每一段空闲塞进新的目的地。' }
    ],
    rhythm: [
      { label: '开始', title: '选定一个街区入口', description: '先按住宿位置确认交通，避免为固定起点反复折返。' },
      { label: '途中', title: '散步与自由停留', description: '当天按体力调整路线，喜欢的街角可以多留一点时间。' },
      { label: '收尾', title: '一段不必赶的休息', description: '午餐或咖啡自行选择，再决定是否继续下一处。' }
    ],
    practical: ['步行距离、坡度和无障碍通行尚未核验；有行动需求时，需先确认适合的路段。', '餐饮店与预约尚未选择，开放时间与消费以店铺实际信息为准。'],
    prompt: '请在里斯本行程中留出半天，慢慢走阿尔法玛街区。想看街巷和建筑，中间安排休息，不要把行程排太满。'
  },
  {
    id: 'explore-riverside', title: '把午后留给河岸', subtitle: '一段散步，一点留白', photo: media.hero, photoDescription: '里斯本城市与河岸 · 氛围参考', destination: '里斯本', category: '慢游',
    source: 'https://www.visitlisboa.com/', sourceName: 'Visit Lisboa',
    photoSource: 'https://unsplash.com/photos/es7bSg9VPP0', credit: 'Aswin / Unsplash',
    eyebrow: 'TAGUS · SLOW AFTERNOON', duration: '半日灵感', keywords: '里斯本 lisbon 特茹河 风景 散步 河畔 轻松',
    summary: '不用把一个午后填满。以河岸散步为重心，把观景、休息与吃饭的时间放宽，给旅行留一段可以随时改变主意的时光。',
    highlights: [
      { title: '路线围绕一段河岸', description: '根据住宿和当天出发点，选择连续的步行段，减少跨区往返。' },
      { title: '随状态缩短或延长', description: '天气、体力和临时发现都可以改变安排，不追求走到某个终点。' }
    ],
    rhythm: [
      { label: '午后', title: '从方便抵达的地方开始', description: '具体河岸入口和交通方式，待住宿位置确定后再选。' },
      { label: '途中', title: '散步，看风景，休息', description: '把步行分成几段，途中留足停留时间。' },
      { label: '之后', title: '把剩余时间交还给自己', description: '可以继续走，也可以结束当天的主要安排。' }
    ],
    practical: ['首图为里斯本城市与河岸氛围参考，不代表已确定的散步起点或路线。', '步道通行、天气、返程交通和餐饮选择尚未核验，生成实际行程时需确认。'],
    prompt: '我想在里斯本旅行中安排一个轻松的河岸午后，以散步、看风景和休息为主。请按住宿位置选择方便的路段，不要安排太多跨区交通。'
  },
  {
    id: 'explore-viewpoints', title: '等一场城市日落', subtitle: '换个角度，看屋顶与远方', photo: media.sunset, photoDescription: '里斯本城市日落 · 氛围参考', destination: '里斯本', category: '看风景',
    source: 'https://www.visitlisboa.com/', sourceName: 'Visit Lisboa',
    photoSource: 'https://unsplash.com/photos/i5j0kB6FcA', credit: 'Timur Seyfelmlyukov / Unsplash · 来源待复核',
    eyebrow: 'LISBON · GOLDEN HOUR', duration: '傍晚灵感', keywords: '里斯本 lisbon 观景台 屋顶 夕阳 风景',
    summary: '一天的尾声，找个适合停下来的角度看城市。观景地点和抵达时间应随当天的天气、日落与交通调整，不用提前把风景变成打卡任务。',
    highlights: [
      { title: '只选一个观景点', description: '结合当天所在街区，选一处顺路的地方，避免为追逐多个视角来回奔走。' },
      { title: '给等待一点时间', description: '把抵达、休息与返程一并考虑，保留天气变化时可调整的余地。' }
    ],
    rhythm: [
      { label: '出发前', title: '确认天气与日落时间', description: '以实际出行日期查询；当前样例不提供未核验的时刻。' },
      { label: '傍晚', title: '提早抵达，安静停留', description: '根据当天的路线与体力选择观景地点。' },
      { label: '天黑后', title: '按已确认的方式返程', description: '出发前了解返程交通，再决定停留时长。' }
    ],
    practical: ['照片为里斯本城市日落氛围，不代表特定观景台或保证可见的景色；图片来源信息仍待复核。', '具体观景点、开放限制、天气和返程交通尚未核验，实际规划时再确认。'],
    prompt: '请在里斯本行程中加入一次轻松的日落观景，优先选择和当天路线顺路的地点，并核对日期、天气、开放条件与返程交通。'
  },
  {
    id: 'explore-castle', title: '在城堡，看一眼里斯本', subtitle: '给城市的高处一点时间', photo: media.castle, photoDescription: '圣乔治城堡景观', destination: '里斯本', category: '看风景',
    source: 'https://castelodesaojorge.pt/en/', sourceName: 'Castelo de São Jorge',
    photoSource: 'https://unsplash.com/photos/jabczusxopU', credit: 'Pamela Hallam / Unsplash',
    eyebrow: 'SÃO JORGE · CITY VIEW', duration: '半日灵感', keywords: '里斯本 lisbon 圣乔治 历史 观景城堡',
    summary: '用城堡作为半天的重心，把参观与城市观景放在一起。前后都留一些空白，让这一站可以随着你的兴趣慢慢展开。',
    highlights: [
      { title: '参观与观景一起安排', description: '为建筑与城市景观留出完整的停留，不把参观压缩成短暂的一站。' },
      { title: '和老城形成一天的节奏', description: '若体力和开放安排允许，可以与同日街区漫步衔接；具体路线待确认。' }
    ],
    rhythm: [
      { label: '出发前', title: '核对门票与开放安排', description: '前往官方页面查看当日规则，当前样例未包含预约。' },
      { label: '参观中', title: '按兴趣自由停留', description: '先安排主要参观，再给观景和休息留下时间。' },
      { label: '结束后', title: '轻松衔接下一段', description: '根据当天体力决定继续老城漫步，或回到住宿休息。' }
    ],
    practical: ['门票价格、预约、开放时间与无障碍条件尚未核验，以官方信息为准。', '照片展示城堡景观，不用于承诺具体参观路线或当日现场条件。'],
    prompt: '请把圣乔治城堡加入里斯本行程，留出半天从容参观和观景；核对门票、开放与预约条件，再安排周边衔接。'
  }
]

/** Presentation filtering; arbitrary injected places and categories are supported. */
export function filterExploreItems(items: ExploreItem[], query: string, theme: string, featuredId?: string): ExploreItem[] {
  const normalized = query.trim().toLocaleLowerCase()
  const isBrowsing = !normalized && theme === '全部'
  return items.filter(item => (theme === '全部' || item.category === theme) &&
    (!isBrowsing || item.id !== featuredId) &&
    (!normalized || `${item.title} ${item.subtitle} ${item.keywords} ${item.category} ${item.destination}`.toLocaleLowerCase().includes(normalized)))
}

export const kyotoExploreItems: ExploreItem[] = [{
  id: 'explore-kyoto', title: '京都', subtitle: '庭园、街巷，留一点安静', category: '目的地', destination: '京都',
  photo: '', photoDescription: '京都图片暂未提供', source: 'https://kyoto.travel/', sourceName: 'Kyoto City Official Travel Guide', photoSource: null, credit: '暂无图片来源',
  eyebrow: 'JAPAN · KYOTO', duration: '3 天灵感', keywords: 'kyoto 京都 庭园 日本', summary: '在庭园、街巷与休息之间留出余地。具体地点和开放安排需要在出发前核验。',
  featured: { title: '在京都，留一点安静。', subtitle: '庭园、街巷，与不必赶路的片刻。', badge: '目的地 · 日本' },
  highlights: [{ title: '每天一个重心', description: '按住宿与实际交通安排街区，避免跨城赶路。' }],
  rhythmTitle: '3 天，慢慢展开', rhythm: [{ label: 'D1', title: '抵达和安顿', description: '关西机场至京都交通待核验。' }, { label: 'D2', title: '庭园与街区', description: '具体开放时段及预约待确认。' }, { label: 'D3', title: '从容返程', description: '根据实际航班安排返程。' }],
  practical: ['当前为京都固定展示样例，图片、住宿、预约与价格尚未提供。'], prompt: '2026年11月3日至5日，从上海去京都旅行3天，1人出行，想看庭园和街巷，节奏轻松。',
  arrival: { label: 'KIX · 关西机场抵达准备', route: [{ code: 'PVG', label: '上海' }, { code: 'KIX', label: '大阪关西' }], note: '直飞航线示意；机场到京都的交通未核验。', checks: [{ title: '先确认机场接驳', description: '根据航班抵达时刻和住宿位置核验前往京都的交通。' }], prompt: '2026年11月3日至5日，从上海去京都3天，1人出行。请核验关西机场往返京都的交通和时刻。' }
}]
