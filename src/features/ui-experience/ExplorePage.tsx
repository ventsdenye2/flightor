import { useEffect, useState } from 'react'
import { View, Text, Button, Input } from '@tarojs/components'
import { PageHeader, SectionHeading, EmptyState, DemoNote, Sheet } from './SharedUI'
import { Icon, Photo } from './VisualMedia'
import { media, photoDescriptions } from './media'
import './explore.scss'

type ExploreCategory = '目的地' | '城市漫步' | '慢游' | '看风景'
export interface ExploreItem {
  id: string
  title: string
  subtitle: string
  photo: keyof typeof media
  category: ExploreCategory
  source: string
  sourceName: string
  photoSource: string
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
    id: 'explore-lisbon', title: '里斯本', subtitle: '老城、河岸，和不用赶路的日子', photo: 'hero', category: '目的地',
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
    id: 'explore-alfama', title: '走进阿尔法玛的小巷', subtitle: '不赶路的老城半日', photo: 'alfama', category: '城市漫步',
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
    id: 'explore-riverside', title: '把午后留给河岸', subtitle: '一段散步，一点留白', photo: 'hero', category: '慢游',
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
    id: 'explore-viewpoints', title: '等一场城市日落', subtitle: '换个角度，看屋顶与远方', photo: 'sunset', category: '看风景',
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
    id: 'explore-castle', title: '在城堡，看一眼里斯本', subtitle: '给城市的高处一点时间', photo: 'castle', category: '看风景',
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

export interface ExplorePageProps {
  onPlan: (prompt: string) => void
  savedIds: string[]
  onToggleSave: (id: string) => void
  onOpenSource?: (url: string) => void
  initialItemId?: string
  onBack?: () => void
}

const themes = ['全部', '城市漫步', '慢游', '看风景'] as const

export function ExplorePage({ onPlan, savedIds, onToggleSave, onOpenSource, initialItemId, onBack }: ExplorePageProps) {
  const [query, setQuery] = useState('')
  const [theme, setTheme] = useState<string>('全部')
  const [selectedId, setSelectedId] = useState(initialItemId)
  const [showArrival, setShowArrival] = useState(false)
  useEffect(() => { setSelectedId(initialItemId); setShowArrival(false) }, [initialItemId])
  const selected = exploreItems.find(item => item.id === selectedId)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const isBrowsing = !normalizedQuery && theme === '全部'
  const results = exploreItems.filter(item =>
    (theme === '全部' || item.category === theme) &&
    (!isBrowsing || item.category !== '目的地') &&
    (!normalizedQuery || `${item.title} ${item.subtitle} ${item.keywords} ${item.category}`.toLocaleLowerCase().includes(normalizedQuery))
  )
  const reset = () => { setQuery(''); setTheme('全部') }
  const open = (id: string) => { setSelectedId(id); setShowArrival(false) }

  if (selected) {
    const saved = savedIds.includes(selected.id)
    return <>
      <PageHeader title={selected.category === '目的地' ? '目的地指南' : '旅行灵感'} onBack={onBack || (() => setSelectedId(undefined))} action={<Button className={`ux-icon-button ${saved ? 'is-saved' : ''}`} ariaLabel={saved ? '取消收藏这份灵感' : '收藏这份灵感'} aria-pressed={saved} onClick={() => onToggleSave(selected.id)}><Icon name={saved ? 'bookmark-filled' : 'bookmark'} /></Button>} />
      <View className='ux-scroll ux-explore-detail' key={selected.id}>
        <Photo src={media[selected.photo]} description={photoDescriptions[selected.photo]} className='ux-explore-detail-photo' />
        <View className='ux-explore-detail-body'>
          <Text className='ux-explore-kicker'>{selected.eyebrow}</Text>
          <Text className='ux-title ux-explore-detail-title'>{selected.title}</Text>
          <Text className='ux-explore-subtitle'>{selected.subtitle}</Text>
          <View className='ux-explore-detail-tags'><Text>{selected.category}</Text><Text>{selected.duration}</Text><Text>里斯本</Text></View>
          <Text className='ux-explore-introduction'>{selected.summary}</Text>
          <SectionHeading title='值得留在行程里的' caption='让停留有重心，也有余地' />
          <View className='ux-explore-highlights'>{selected.highlights.map((highlight, index) => <View className='ux-explore-highlight' key={highlight.title}><Text className='ux-explore-index'>{`0${index + 1}`}</Text><View><Text className='ux-explore-highlight-title'>{highlight.title}</Text><Text className='ux-muted'>{highlight.description}</Text></View></View>)}</View>
          <SectionHeading title={selected.category === '目的地' ? '7 天，可以这样展开' : '给这段时间一个节奏'} caption='安排示意，实际时间在规划时确认' />
          <View className='ux-explore-rhythm'>{selected.rhythm.map(stop => <View className='ux-explore-rhythm-row' key={stop.label}><Text className='ux-explore-rhythm-label'>{stop.label}</Text><View><Text className='ux-explore-highlight-title'>{stop.title}</Text><Text className='ux-muted'>{stop.description}</Text></View></View>)}</View>
          {selected.category === '目的地' ? <Button className='ux-explore-arrival' onClick={() => setShowArrival(true)}><View className='ux-explore-arrival-icon'><Icon name='plane' /></View><View><Text className='ux-explore-highlight-title'>从出发，到住下来</Text><Text className='ux-muted'>LIS · 航线示意与抵达准备</Text></View><Icon name='chevron-right' /></Button> : null}
          <View className='ux-explore-practical'><View className='ux-explore-practical-title'><Icon name='info' /><Text>带着这些问题再出发</Text></View>{selected.practical.map(item => <Text className='ux-explore-practical-copy' key={item}>{item}</Text>)}</View>
          <Button className='ux-source' onClick={() => onOpenSource?.(selected.source)}><Icon name='external' /><Text>参考 · {selected.sourceName}</Text><Icon name='arrow-right' /></Button>
          <Button className='ux-explore-credit' onClick={() => onOpenSource?.(selected.photoSource)}><Text>{photoDescriptions[selected.photo]}<Text className='ux-explore-credit-author'>{selected.credit}</Text></Text><Icon name='external' /></Button>
          <DemoNote text='灵感与节奏为固定示例，尚未生成或保存为正式行程。' />
        </View>
      </View>
      <View className='ux-explore-detail-action'><Button className='ux-primary' onClick={() => onPlan(selected.prompt)}>以这份灵感开始规划<Icon name='arrow-right' /></Button></View>
      {showArrival ? <Sheet title='从出发，到住下来' onClose={() => setShowArrival(false)}>
        <Text className='ux-explore-sheet-copy'>把航班与落地之后的第一段路，一起放进计划里。</Text>
        <View className='ux-explore-hub-route'><View><Text>PVG</Text><Text>上海</Text></View><Icon name='arrow-right' /><View><Text>DOH</Text><Text>多哈</Text></View><Icon name='arrow-right' /><View><Text>LIS</Text><Text>里斯本</Text></View></View>
        <Text className='ux-caption'>航线仅作界面示例，并非已查询的可售结果。</Text>
        <View className='ux-explore-arrival-checks'>{[
          ['先确认航班', '出发日期、航段、行李和中转衔接，需结合真实报价与票规核验。'],
          ['再衔接住宿', '根据落地时刻、住宿位置与同行需求选择接驳；当前不预填未经核验的时间或费用。'],
          ['抵达日留一些空白', '安顿与休息放在前面，首日活动随航班和体力调整。']
        ].map(([title, copy], index) => <View className='ux-explore-highlight' key={title}><Text className='ux-explore-index'>{`0${index + 1}`}</Text><View><Text className='ux-explore-highlight-title'>{title}</Text><Text className='ux-muted'>{copy}</Text></View></View>)}</View>
        <Button className='ux-primary' onClick={() => { setShowArrival(false); onPlan(exploreItems[0].prompt + ' 请把抵达机场到住宿的交通也纳入规划，并清楚列出尚待确认的信息。') }}>把抵达安排一起规划</Button>
      </Sheet> : null}
    </>
  }

  return <>
    <PageHeader title='探索' />
    <View className='ux-scroll ux-explore-page'>
      <View className='ux-explore-opening'><Text className='ux-title'>下一程，去哪里？</Text><Text className='ux-explore-subtitle'>先遇见喜欢的风景，再慢慢计划。</Text></View>
      <View className='ux-explore-search'><Icon name='compass' /><Input className='ux-explore-input' ariaLabel='搜索目的地或旅行灵感' placeholder='搜索目的地、街区或灵感' value={query} onInput={event => setQuery(event.detail.value)} confirmType='search' />{query ? <Button className='ux-icon-button' ariaLabel='清空探索搜索' onClick={() => setQuery('')}><Icon name='close' /></Button> : null}</View>
      <View className='ux-explore-themes' ariaLabel='探索主题'>{themes.map(value => <Button key={value} className={`ux-explore-theme ${theme === value ? 'is-active' : ''}`} aria-pressed={theme === value} onClick={() => setTheme(value)}>{value}</Button>)}</View>
      {isBrowsing ? <View className='ux-explore-spotlight'>
        <Button className='ux-explore-spotlight-open' onClick={() => open('explore-lisbon')} ariaLabel='探索里斯本目的地指南'><View className='ux-explore-spotlight-image'><Photo src={media.hero} description={photoDescriptions.hero} className='ux-explore-featured-photo' retry={false} /><Text className='ux-explore-photo-badge'>本期目的地 · 葡萄牙</Text></View><View className='ux-explore-spotlight-copy'><Text className='ux-explore-featured-title'>把日子，交给里斯本。</Text><Text className='ux-muted'>老城慢走、河岸午后，和一场值得等待的日落。</Text><View className='ux-explore-spotlight-link'><Text>看看这座城</Text><Icon name='arrow-right' /></View></View></Button>
        <Button className='ux-icon-button ux-explore-save' ariaLabel={savedIds.includes('explore-lisbon') ? '取消收藏里斯本' : '收藏里斯本'} aria-pressed={savedIds.includes('explore-lisbon')} onClick={() => onToggleSave('explore-lisbon')}><Icon name={savedIds.includes('explore-lisbon') ? 'bookmark-filled' : 'bookmark'} /></Button>
      </View> : null}
      <View className='ux-explore-results'><SectionHeading title={isBrowsing ? '有些地方，适合慢慢来' : '找到这些旅行灵感'} caption={isBrowsing ? '里斯本 · 从一个喜欢的片刻开始' : `${results.length} 份示例灵感${theme !== '全部' ? ` · ${theme}` : ''}`} />
        {results.length ? <View className='ux-explore-grid'>{results.map(item => <View className='ux-explore-card' key={item.id}><Button className='ux-explore-card-open' onClick={() => open(item.id)}><Photo src={media[item.photo]} description={photoDescriptions[item.photo]} className='ux-explore-card-photo' retry={false} /><View className='ux-explore-card-copy'><Text className='ux-explore-card-category'>{item.category} · {item.duration}</Text><Text className='ux-explore-card-title'>{item.title}</Text><Text className='ux-muted'>{item.subtitle}</Text></View></Button><Button className='ux-icon-button ux-explore-save' ariaLabel={`${savedIds.includes(item.id) ? '取消收藏' : '收藏'}${item.title}`} aria-pressed={savedIds.includes(item.id)} onClick={() => onToggleSave(item.id)}><Icon name={savedIds.includes(item.id) ? 'bookmark-filled' : 'bookmark'} /></Button></View>)}</View> : <EmptyState title='这次还没有找到灵感' description='当前收录里斯本示例。试试“老城”“河岸”或“日落”，也可以清除筛选重新看看。' actionLabel='清除搜索与筛选' onAction={reset} icon='compass' />}
        {!isBrowsing && results.length ? <Button className='ux-text-button ux-explore-reset' onClick={reset}>查看全部灵感<Icon name='arrow-right' /></Button> : null}
      </View>
      <DemoNote text='本期为里斯本灵感示例；图片为当地实景或已标注的氛围参考。' />
    </View>
  </>
}

export default ExplorePage
