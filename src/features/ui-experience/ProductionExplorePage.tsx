import { useState } from 'react'
import { Button, Input, ScrollView, Text, View } from '@tarojs/components'
import type { ExploreTemplate } from '../../services/exploreService'
import { EmptyState, PageHeader, SectionHeading } from './SharedUI'
import { Icon, Photo } from './VisualMedia'
import './experience.scss'
import './explore.scss'

const categories: Record<string, string> = { event: '活动', seasonal: '应季', theme: '主题', stopover: '中转体验', deal: '旅行机会' }
export function filterProductionExploreItems(items: ExploreTemplate[], query: string): ExploreTemplate[] {
  const term = query.trim().toLocaleLowerCase()
  return term ? items.filter(({ template }) => [template.title, template.summary, template.routeConcept,
    ...template.anchorDestinations.map(place => place.name), ...template.interests, ...template.experienceGoals,
    categories[template.category] || template.category].join(' ').toLocaleLowerCase().includes(term)) : items
}
export function exploreSourceUrl(value: string): string | null {
  // Mini-program runtimes do not all expose the browser URL constructor.
  const match = value.match(/^https?:\/\/([^/?#\s\\]+)(?:[/?#][^\u0000-\u0020\\]*)?$/i)
  return match && !match[1].includes('@') ? value : null
}
const destinations = (item: ExploreTemplate) => item.template.anchorDestinations.map(place => place.name).join(' · ')

interface ProductionExplorePageProps {
  items: ExploreTemplate[]
  category: string
  onCategoryChange: (category: string) => void
  loading: boolean
  error: string
  onRetry: () => void
  hasMore: boolean
  onLoadMore: () => void
  busy: boolean
  startError: string
  onStart: (item: ExploreTemplate) => void
  onOpenSource: (url: string) => void
}

/** Reuses the approved Explore layout with server templates only. */
export default function ProductionExplorePage({ items, category, onCategoryChange, loading, error, onRetry, hasMore, onLoadMore, busy, startError, onStart, onOpenSource }: ProductionExplorePageProps) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string>()
  const selected = items.find(item => item.id === selectedId)
  const results = filterProductionExploreItems(items, query)
  const featured = query.trim() ? undefined : results[0]
  const remaining = featured ? results.slice(1) : results
  const openSource = (value: string) => { const url = exploreSourceUrl(value); if (url) onOpenSource(url) }

  if (selected) {
    const { template } = selected
    return <>
      <PageHeader title='旅行灵感' onBack={() => setSelectedId(undefined)} />
      <View className='ux-scroll ux-explore-detail' key={selected.id}>
        <Photo description={`${destinations(selected) || '目的地'} · 图片暂未提供`} className='ux-explore-detail-photo' retry={false} />
        <View className='ux-explore-detail-body'>
          <Text className='ux-explore-kicker'>{destinations(selected)}</Text>
          <Text className='ux-title ux-explore-detail-title'>{template.title}</Text>
          <Text className='ux-explore-subtitle'>{template.summary}</Text>
          <View className='ux-explore-detail-tags'><Text>{categories[template.category] || template.category}</Text><Text>{`约 ${template.suggestedDays} 天`}</Text></View>
          <Text className='ux-explore-introduction'>{template.routeConcept}</Text>
          {template.experienceGoals.length > 0 && <><SectionHeading title='值得留在行程里的' caption='让停留有重心，也有余地' /><View className='ux-explore-highlights'>{template.experienceGoals.map((goal, index) => <View className='ux-explore-highlight' key={`${index}-${goal}`}><Text className='ux-explore-index'>{String(index + 1).padStart(2, '0')}</Text><View><Text className='ux-explore-highlight-title'>{goal}</Text></View></View>)}</View></>}
          <View className='ux-explore-practical'><View className='ux-explore-practical-title'><Icon name='calendar' /><Text>什么时候出发</Text></View><Text className='ux-explore-practical-copy'>{`${template.validFrom} — ${template.validTo}`}</Text><Text className='ux-explore-practical-copy'>这是灵感适用的时间范围，实际日期、航班与预算会在规划中继续确认。</Text></View>
          <SectionHeading title='来源与参考' caption={`资料有效至 ${template.verification.expiresAt?.slice(0, 10) || '待确认'}`} />
          <View className='ux-explore-highlights'>{template.sourceFacts.map((fact, index) => <View className='ux-explore-highlight' key={fact.id}><Text className='ux-explore-index'>{String(index + 1).padStart(2, '0')}</Text><View><Text className='ux-explore-highlight-title'>{fact.statement}</Text>{fact.sourceUrls.map((url, sourceIndex) => exploreSourceUrl(url) ? <Button key={`${sourceIndex}-${url}`} className='ux-source explore-production__source' onClick={() => openSource(url)}><Icon name='external' /><Text>{`参考来源 ${sourceIndex + 1}`}</Text><Icon name='arrow-right' /></Button> : <Text className='ux-muted' key={`${sourceIndex}-${url}`}>来源链接暂不可用</Text>)}</View></View>)}</View>
          <Text className='ui-demo-note'>把喜欢的灵感带进规划，再按你的出发地、日期和旅行节奏调整。航班、报价与每天的衔接仍需确认。</Text>
          {startError && <View className='explore-production__notice is-error' role='alert'><Text>{startError}</Text></View>}
        </View>
      </View>
      <View className='ux-explore-detail-action'><Button className='ux-primary' disabled={busy} onClick={() => onStart(selected)}>{busy ? '正在打开规划…' : '以这份灵感开始规划'}<Icon name='arrow-right' /></Button></View>
    </>
  }

  return <>
    <PageHeader title='探索' />
    <View className='ux-scroll ux-explore-page'>
      <View className='ux-explore-opening'><Text className='ux-title'>下一程，去哪里？</Text><Text className='ux-explore-subtitle'>先遇见喜欢的风景，再慢慢计划。</Text></View>
      <View className='ux-explore-search'><Icon name='compass' /><Input className='ux-explore-input' ariaLabel='搜索已加载的旅行灵感' placeholder='搜索目的地、活动或灵感' value={query} onInput={event => setQuery(event.detail.value)} confirmType='search' />{query && <Button className='ux-icon-button' ariaLabel='清空探索搜索' onClick={() => setQuery('')}><Icon name='close' /></Button>}</View>
      <ScrollView className='ux-explore-themes' scrollX enhanced showScrollbar={false} ariaLabel='探索主题'><View className='ux-explore-themes-track'>{[['', '全部'], ...Object.entries(categories)].map(([id, title]) => <Button key={id} className={`ux-explore-theme ${category === id ? 'is-active' : ''}`} aria-pressed={category === id} onClick={() => { setSelectedId(undefined); onCategoryChange(id) }}>{title}</Button>)}</View></ScrollView>
      {error && <View className='explore-production__notice is-error' role='alert'><Text>{error}</Text><Button className='ux-text-button' onClick={onRetry} disabled={loading}>重新加载<Icon name='arrow-right' /></Button></View>}
      {loading && !error && items.length === 0 && <View className='ux-explore-loading' role='status' ariaLabel='正在寻找旅行灵感'>
        <Text className='ux-explore-loading-label'>正在寻找旅行灵感…</Text>
        <View className='ux-explore-loading-spotlight'><View className='ux-explore-loading-photo' /><View className='ux-explore-loading-copy'><View /><View /><View /></View></View>
        <View className='ux-explore-loading-grid'>{[0, 1].map(index => <View className='ux-explore-loading-card' key={index}><View className='ux-explore-loading-photo' /><View className='ux-explore-loading-copy'><View /><View /><View /></View></View>)}</View>
      </View>}
      {startError && <View className='explore-production__notice is-error' role='alert'><Text>{startError}</Text></View>}
      {featured && <View className='ux-explore-spotlight'><Button className='ux-explore-spotlight-open' onClick={() => setSelectedId(featured.id)}><View className='ux-explore-spotlight-image'><Photo description={`${destinations(featured) || '目的地'} · 图片暂未提供`} className='ux-explore-featured-photo' retry={false} /><Text className='ux-explore-photo-badge'>{categories[featured.template.category] || featured.template.category}</Text></View><View className='ux-explore-spotlight-copy'><Text className='ux-explore-featured-title'>{featured.template.title}</Text><Text className='ux-muted'>{featured.template.summary}</Text><View className='ux-explore-spotlight-link'><Text>看看这份灵感</Text><Icon name='arrow-right' /></View></View></Button></View>}
      <View className='ux-explore-results'>
        {remaining.length > 0 && <><SectionHeading title={query.trim() ? '找到这些旅行灵感' : '有些地方，适合慢慢来'} caption={query.trim() ? `${results.length} 份旅行灵感` : '从一个喜欢的片刻开始'} /><View className='ux-explore-grid'>{remaining.map(item => <View className='ux-explore-card' key={item.id}><Button className='ux-explore-card-open' onClick={() => setSelectedId(item.id)}><Photo description={`${destinations(item) || '目的地'} · 图片暂未提供`} className='ux-explore-card-photo' retry={false} /><View className='ux-explore-card-copy'><Text className='ux-explore-card-category'>{`${categories[item.template.category] || item.template.category} · 约 ${item.template.suggestedDays} 天`}</Text><Text className='ux-explore-card-title'>{item.template.title}</Text><Text className='ux-muted'>{item.template.summary}</Text></View></Button></View>)}</View></>}
        {!loading && !error && results.length === 0 && <EmptyState title={query.trim() ? '这次还没有找到灵感' : '暂时还没有旅行灵感'} description={query.trim() ? hasMore ? '可继续加载更多灵感，或试试其他目的地与关键词。' : '试试其他目的地或关键词，也可以清除搜索重新看看。' : '当前没有可用的旅行灵感，可以稍后再来看看。'} actionLabel={query.trim() ? '清除搜索' : '重新加载'} onAction={query.trim() ? () => setQuery('') : onRetry} />}
        {hasMore && <Button className='ux-text-button ux-explore-reset' disabled={loading} onClick={onLoadMore}>{loading ? '正在加载…' : '加载更多灵感'}<Icon name='arrow-right' /></Button>}
        {query.trim() && hasMore && <Text className='ui-demo-note'>搜索范围为当前已加载的灵感。</Text>}
      </View>
    </View>
  </>
}
