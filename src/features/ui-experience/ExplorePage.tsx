import { Fragment, useEffect, useState } from 'react'
import { View, Text, Button, Input } from '@tarojs/components'
import { PageHeader, SectionHeading, EmptyState, DemoNote, Sheet } from './SharedUI'
import { Icon, Photo } from './VisualMedia'
import { exploreItems, filterExploreItems } from './exploreSamples'
import type { ExploreItem } from './exploreSamples'
import './explore.scss'

export interface ExplorePageProps {
  items?: ExploreItem[]
  onPlan: (prompt: string) => void
  savedIds: string[]
  onToggleSave: (id: string) => void
  onOpenSource?: (url: string) => void
  initialItemId?: string
  onBack?: () => void
}

export function ExplorePage({ onPlan, savedIds, onToggleSave, onOpenSource, initialItemId, onBack, items = exploreItems }: ExplorePageProps) {
  const [query, setQuery] = useState('')
  const [theme, setTheme] = useState<string>('全部')
  const [selectedId, setSelectedId] = useState(initialItemId)
  const [showArrival, setShowArrival] = useState(false)
  useEffect(() => { setSelectedId(initialItemId); setShowArrival(false) }, [initialItemId])
  useEffect(() => { setQuery(''); setTheme('全部'); setShowArrival(false) }, [items])
  const selected = items.find(item => item.id === selectedId)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const isBrowsing = !normalizedQuery && theme === '全部'
  const featured = items.find(item => item.featured) || items.find(item => item.category === '目的地')
  const themes = ['全部', ...Array.from(new Set(items.map(item => item.category).filter(category => category !== '目的地')))]
  const results = filterExploreItems(items, query, theme, featured?.id)
  const reset = () => { setQuery(''); setTheme('全部') }
  const open = (id: string) => { setSelectedId(id); setShowArrival(false) }

  if (selectedId && !selected) return <><PageHeader title='旅行灵感' onBack={onBack || (() => setSelectedId(undefined))} /><EmptyState title='这份灵感暂不可用' description='当前数据集中没有这份内容，收藏记录不会被当作新的目的地。' actionLabel='返回探索' onAction={onBack || (() => setSelectedId(undefined))} /></>

  if (selected) {
    const saved = savedIds.includes(selected.id)
    return <>
      <PageHeader title={selected.category === '目的地' ? '目的地指南' : '旅行灵感'} onBack={onBack || (() => setSelectedId(undefined))} action={<Button className={`ux-icon-button ${saved ? 'is-saved' : ''}`} ariaLabel={saved ? '取消收藏这份灵感' : '收藏这份灵感'} aria-pressed={saved} onClick={() => onToggleSave(selected.id)}><Icon name={saved ? 'bookmark-filled' : 'bookmark'} /></Button>} />
      <View className='ux-scroll ux-explore-detail' key={selected.id}>
        <Photo src={selected.photo} description={selected.photoDescription} forceError={!selected.photo} retry={!!selected.photo} className='ux-explore-detail-photo' />
        <View className='ux-explore-detail-body'>
          <Text className='ux-explore-kicker'>{selected.eyebrow}</Text>
          <Text className='ux-title ux-explore-detail-title'>{selected.title}</Text>
          <Text className='ux-explore-subtitle'>{selected.subtitle}</Text>
          <View className='ux-explore-detail-tags'><Text>{selected.category}</Text><Text>{selected.duration}</Text><Text>{selected.destination}</Text></View>
          <Text className='ux-explore-introduction'>{selected.summary}</Text>
          <SectionHeading title='值得留在行程里的' caption='让停留有重心，也有余地' />
          <View className='ux-explore-highlights'>{selected.highlights.map((highlight, index) => <View className='ux-explore-highlight' key={highlight.title}><Text className='ux-explore-index'>{`0${index + 1}`}</Text><View><Text className='ux-explore-highlight-title'>{highlight.title}</Text><Text className='ux-muted'>{highlight.description}</Text></View></View>)}</View>
          <SectionHeading title={selected.rhythmTitle || '给这段时间一个节奏'} caption='安排示意，实际时间在规划时确认' />
          <View className='ux-explore-rhythm'>{selected.rhythm.map(stop => <View className='ux-explore-rhythm-row' key={stop.label}><Text className='ux-explore-rhythm-label'>{stop.label}</Text><View><Text className='ux-explore-highlight-title'>{stop.title}</Text><Text className='ux-muted'>{stop.description}</Text></View></View>)}</View>
          {selected.arrival ? <Button className='ux-explore-arrival' onClick={() => setShowArrival(true)}><View className='ux-explore-arrival-icon'><Icon name='plane' /></View><View><Text className='ux-explore-highlight-title'>从出发，到住下来</Text><Text className='ux-muted'>{selected.arrival.label}</Text></View><Icon name='chevron-right' /></Button> : null}
          <View className='ux-explore-practical'><View className='ux-explore-practical-title'><Icon name='info' /><Text>带着这些问题再出发</Text></View>{selected.practical.map(item => <Text className='ux-explore-practical-copy' key={item}>{item}</Text>)}</View>
          <Button className='ux-source' disabled={!selected.source || !onOpenSource} onClick={() => selected.source && onOpenSource?.(selected.source)}><Icon name='external' /><Text>{selected.source ? '参考' : '来源待提供'} · {selected.sourceName}</Text><Icon name='arrow-right' /></Button>
          <Button className='ux-explore-credit' disabled={!selected.photoSource || !onOpenSource} onClick={() => selected.photoSource && onOpenSource?.(selected.photoSource)}><Text>{selected.photoDescription}<Text className='ux-explore-credit-author'>{selected.credit}</Text></Text><Icon name='external' /></Button>
          <DemoNote text='灵感与节奏为固定示例，尚未生成或保存为正式行程。' />
        </View>
      </View>
      <View className='ux-explore-detail-action'><Button className='ux-primary' onClick={() => onPlan(selected.prompt)}>以这份灵感开始规划<Icon name='arrow-right' /></Button></View>
      {showArrival && selected.arrival ? <Sheet title='从出发，到住下来' onClose={() => setShowArrival(false)}>
        <Text className='ux-explore-sheet-copy'>把航班与落地之后的第一段路，一起放进计划里。</Text>
        <View className='ux-explore-hub-route'>{selected.arrival.route.map((place, index) => <Fragment key={`${place.code}-${index}`}>{index > 0 ? <Icon name='arrow-right' /> : null}<View><Text>{place.code}</Text><Text>{place.label}</Text></View></Fragment>)}</View>
        <Text className='ux-caption'>{selected.arrival.note}</Text>
        <View className='ux-explore-arrival-checks'>{selected.arrival.checks.map((check, index) => <View className='ux-explore-highlight' key={check.title}><Text className='ux-explore-index'>{`0${index + 1}`}</Text><View><Text className='ux-explore-highlight-title'>{check.title}</Text><Text className='ux-muted'>{check.description}</Text></View></View>)}</View>
        <Button className='ux-primary' onClick={() => { setShowArrival(false); onPlan(selected.arrival!.prompt) }}>把抵达安排一起规划</Button>
      </Sheet> : null}
    </>
  }

  return <>
    <PageHeader title='探索' />
    <View className='ux-scroll ux-explore-page'>
      <View className='ux-explore-opening'><Text className='ux-title'>下一程，去哪里？</Text><Text className='ux-explore-subtitle'>先遇见喜欢的风景，再慢慢计划。</Text></View>
      <View className='ux-explore-search'><Icon name='compass' /><Input className='ux-explore-input' ariaLabel='搜索目的地或旅行灵感' placeholder='搜索目的地、街区或灵感' value={query} onInput={event => setQuery(event.detail.value)} confirmType='search' />{query ? <Button className='ux-icon-button' ariaLabel='清空探索搜索' onClick={() => setQuery('')}><Icon name='close' /></Button> : null}</View>
      <View className='ux-explore-themes' ariaLabel='探索主题'>{themes.map(value => <Button key={value} className={`ux-explore-theme ${theme === value ? 'is-active' : ''}`} aria-pressed={theme === value} onClick={() => setTheme(value)}>{value}</Button>)}</View>
      {isBrowsing && featured ? <View className='ux-explore-spotlight'>
        <Button className='ux-explore-spotlight-open' onClick={() => open(featured.id)} ariaLabel={`探索${featured.title}目的地指南`}><View className='ux-explore-spotlight-image'><Photo src={featured.photo} description={featured.photoDescription} forceError={!featured.photo} className='ux-explore-featured-photo' retry={false} /><Text className='ux-explore-photo-badge'>{featured.featured?.badge || featured.category}</Text></View><View className='ux-explore-spotlight-copy'><Text className='ux-explore-featured-title'>{featured.featured?.title || featured.title}</Text><Text className='ux-muted'>{featured.featured?.subtitle || featured.subtitle}</Text><View className='ux-explore-spotlight-link'><Text>看看这座城</Text><Icon name='arrow-right' /></View></View></Button>
        <Button className='ux-icon-button ux-explore-save' ariaLabel={`${savedIds.includes(featured.id) ? '取消收藏' : '收藏'}${featured.title}`} aria-pressed={savedIds.includes(featured.id)} onClick={() => onToggleSave(featured.id)}><Icon name={savedIds.includes(featured.id) ? 'bookmark-filled' : 'bookmark'} /></Button>
      </View> : null}
      {results.length > 0 || !isBrowsing || !featured ? <View className='ux-explore-results'><SectionHeading title={isBrowsing ? '有些地方，适合慢慢来' : '找到这些旅行灵感'} caption={isBrowsing ? '从一个喜欢的片刻开始' : `${results.length} 份示例灵感${theme !== '全部' ? ` · ${theme}` : ''}`} />
        {results.length ? <View className='ux-explore-grid'>{results.map(item => <View className='ux-explore-card' key={item.id}><Button className='ux-explore-card-open' onClick={() => open(item.id)}><Photo src={item.photo} description={item.photoDescription} forceError={!item.photo} className='ux-explore-card-photo' retry={false} /><View className='ux-explore-card-copy'><Text className='ux-explore-card-category'>{item.category} · {item.duration}</Text><Text className='ux-explore-card-title'>{item.title}</Text><Text className='ux-muted'>{item.subtitle}</Text></View></Button><Button className='ux-icon-button ux-explore-save' ariaLabel={`${savedIds.includes(item.id) ? '取消收藏' : '收藏'}${item.title}`} aria-pressed={savedIds.includes(item.id)} onClick={() => onToggleSave(item.id)}><Icon name={savedIds.includes(item.id) ? 'bookmark-filled' : 'bookmark'} /></Button></View>)}</View> : <EmptyState title={items.length ? '这次还没有找到灵感' : '暂时还没有旅行灵感'} description={items.length ? '试试其他目的地或关键词，也可以清除筛选重新看看。' : '当前没有可展示的内容，后续接入数据后会在这里出现。'} actionLabel={query || theme !== '全部' ? '清除搜索与筛选' : undefined} onAction={reset} icon='compass' />}
        {!isBrowsing && results.length ? <Button className='ux-text-button ux-explore-reset' onClick={reset}>查看全部灵感<Icon name='arrow-right' /></Button> : null}
      </View> : null}
      <DemoNote text='灵感内容与图片来源逐条标注，实际安排仍需核验。' />
    </View>
  </>
}

export default ExplorePage
