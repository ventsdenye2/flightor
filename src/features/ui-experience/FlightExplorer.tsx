import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Text, View } from '@tarojs/components'
import { DemoNote, EmptyState, PageHeader, SectionHeading, Sheet } from './SharedUI'
import { Icon } from './VisualMedia'
import './flights.scss'

import {
  defaultFlightDataset, DEFAULT_FLIGHT_FILTERS as DEFAULT_FILTERS, initialFlightSearch,
  canonicalAirport, matchesFlightDataset, selectFlightResults, validFlightDate,
  knownAmount, formatFlightAmount as money, formatFlightDuration as duration, formatFlightStops as stopsLabel
} from './flightSamples'
import type { FlightSearchDataset, FlightSearchItem as Flight, FlightSearchInput as Search, FlightFilters as Filters } from './flightSamples'

export function FlightExplorer({ onBack, onOpenTrip, onCreateAlert, searchDataset = defaultFlightDataset }: {
  searchDataset?: FlightSearchDataset
  onBack: () => void
  onOpenTrip: () => void
  onCreateAlert: (alert: { route: string; targetPrice: number; date: string }) => void
}) {
  const [form, setForm] = useState<Search>(() => initialFlightSearch(searchDataset))
  const [search, setSearch] = useState<Search>(() => initialFlightSearch(searchDataset))
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [sort, setSort] = useState<'recommended' | 'price' | 'duration'>('recommended')
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [draftFilters, setDraftFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [sheet, setSheet] = useState<'filter' | 'compare' | 'alert' | null>(null)
  const [detail, setDetail] = useState<Flight | null>(null)
  const [compared, setCompared] = useState<string[]>([])
  const [targetPrice, setTargetPrice] = useState('')
  const [alertError, setAlertError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const initial = initialFlightSearch(searchDataset)
    setForm(initial); setSearch(initial); setStatus('idle'); setFilters(DEFAULT_FILTERS); setDraftFilters(DEFAULT_FILTERS)
    setDetail(null); setSheet(null); setCompared([]); setFormError(''); setAlertError(''); setNotice('')
  }, [searchDataset])
  const supported = matchesFlightDataset(search, searchDataset)
  const originLabel = searchDataset.originName || searchDataset.origin
  const destinationLabel = searchDataset.destinationName || searchDataset.destination
  const hasKnownQuote = searchDataset.flights.some(flight => knownAmount(flight.price))
  const datasetNote = searchDataset.sourceNote || '注入的展示数据，票价、余位与中转条件尚未核验。'
  const airportName = (value: string) => canonicalAirport(value, searchDataset) === searchDataset.origin.toUpperCase() ? originLabel : canonicalAirport(value, searchDataset) === searchDataset.destination.toUpperCase() ? destinationLabel : '机场代码 / 城市'
  const filterCount = Number(filters.price > 0) + Number(filters.oneStop) + Number(filters.protectedOnly)
  const results = useMemo(() => selectFlightResults(searchDataset, search, filters, sort), [searchDataset, search, filters, sort])
  useEffect(() => {
    // A comparison always refers to the visible result set. Filtering away a
    // selected flight must also remove it from the comparison dock.
    setCompared(selected => {
      const next = selected.filter(id => results.some(flight => flight.id === id))
      return next.length === selected.length ? selected : next
    })
  }, [results])
  const compareFlights = searchDataset.flights.filter(flight => compared.includes(flight.id))
  const beginSearch = (simulateFailure = false, value = form) => {
    if (timer.current) clearTimeout(timer.current)
    const normalized = { ...value, from: canonicalAirport(value.from, searchDataset), to: canonicalAirport(value.to, searchDataset) }
    if (!normalized.from || !normalized.to) { setFormError('请填写出发地和目的地。'); return }
    if (normalized.from === normalized.to) { setFormError('出发地和目的地不能相同。'); return }
    if (!validFlightDate(normalized.date)) { setFormError(`请输入有效日期，例如 ${searchDataset.date}。`); return }
    setForm(normalized); setSearch(normalized); setFormError(''); setNotice(''); setStatus('loading'); setCompared([])
    timer.current = setTimeout(() => { setStatus(simulateFailure ? 'error' : 'ready'); timer.current = null }, 750)
  }
  const cancelSearch = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null; setStatus('idle'); setNotice('已取消本次搜索，可以继续调整条件。')
  }
  const toggleCompare = (id: string) => {
    if (compared.includes(id)) { setCompared(compared.filter(value => value !== id)); setNotice(''); return }
    if (compared.length === 2) { setNotice('一次可以比较 2 个航班，请先移除一个。'); return }
    setCompared([...compared, id]); setNotice('')
  }
  const openAlert = (price?: number | null) => { setDetail(null); setTargetPrice(knownAmount(price) ? String(Math.max(1, Math.floor(price - 500))) : ''); setAlertError(''); setSheet('alert') }
  const saveAlert = () => {
    const amount = Number(targetPrice)
    if (!/^\d+$/.test(targetPrice) || amount < 1 || amount > 999999) { setAlertError('请输入 1 至 999,999 元之间的整数。'); return }
    onCreateAlert({ route: `${search.from} → ${search.to}`, targetPrice: amount, date: search.date })
    setSheet(null); setNotice('价格提醒已加入「我的」。当前为本地演示，不会自动查询或发送通知。')
  }
  return <>
    <PageHeader title='找一张合适的机票' onBack={onBack} />
    <View className='ux-scroll fl-page'>
      <View className='fl-intro'><Text className='fl-title'>让出发，刚刚好。</Text><Text className='fl-subtitle'>在价格、时间与中转之间，找到你的平衡。</Text></View>
      <View className='fl-search-box'>
        <View className='fl-search-top'><Text className='fl-tag'>单程</Text><Text className='fl-secondary-text'>经济舱 · 人民币</Text></View>
        <View className='fl-airports'>
          <View className='fl-field'><Text className='fl-field-label'>从哪里出发</Text><Input className='fl-airport-input' ariaLabel='出发地机场代码或城市' value={form.from} placeholder='城市或机场代码' maxlength={30} disabled={status === 'loading'} onInput={event => setForm({ ...form, from: event.detail.value })} /><Text className='fl-small'>{airportName(form.from)}</Text></View>
          <Button className='fl-swap' ariaLabel='交换出发地和目的地' disabled={status === 'loading'} onClick={() => setForm({ ...form, from: form.to, to: form.from })}><Icon name='swap' /></Button>
          <View className='fl-field'><Text className='fl-field-label'>想去哪里</Text><Input className='fl-airport-input' ariaLabel='目的地机场代码或城市' value={form.to} placeholder='城市或机场代码' maxlength={30} disabled={status === 'loading'} onInput={event => setForm({ ...form, to: event.detail.value })} /><Text className='fl-small'>{airportName(form.to)}</Text></View>
        </View>
        <View className='fl-search-bottom'>
          <View className='fl-date-field'><Text className='fl-field-label'>出发日期</Text><View className='fl-date-input-row'><Icon name='calendar' /><Input className='fl-date-input' ariaLabel='出发日期，格式年-月-日' value={form.date} maxlength={10} disabled={status === 'loading'} onInput={event => setForm({ ...form, date: event.detail.value })} /></View></View>
          <View className='fl-passengers'><Text className='fl-field-label'>成人</Text><View className='fl-stepper'><Button ariaLabel='减少乘机人数' disabled={form.travelers === 1 || status === 'loading'} onClick={() => setForm({ ...form, travelers: form.travelers - 1 })}><Icon name='minus' /></Button><Text>{form.travelers}</Text><Button ariaLabel='增加乘机人数' disabled={form.travelers === 4 || status === 'loading'} onClick={() => setForm({ ...form, travelers: form.travelers + 1 })}><Icon name='plus' /></Button></View></View>
        </View>
        {formError ? <View className='fl-form-error' ariaRole='alert'>{formError}</View> : null}
        <Button className='ux-primary fl-search-button' disabled={status === 'loading'} onClick={() => beginSearch()}><Icon name='plane' />{status === 'loading' ? '正在查找样例…' : '搜索航班'}</Button>
        <Text className='fl-search-note'>当前数据：{searchDataset.date} · {searchDataset.origin} → {searchDataset.destination}。</Text>
      </View>

      {notice ? <View className='fl-notice' ariaRole='status'><Icon name='info' /><Text>{notice}</Text><Button ariaLabel='关闭提示' onClick={() => setNotice('')}><Icon name='close' /></Button></View> : null}
      {status === 'idle' ? <View className='fl-idle-note'><View className='fl-line-icon'><Icon name='plane' /></View><Text className='fl-idle-title'>先选好去处，再慢慢比较。</Text><Text className='fl-subtitle'>所有时刻与价格都清楚列出，中转风险也不藏起来。</Text><DemoNote text={datasetNote} /></View> : null}
      {status === 'loading' ? <View className='fl-loading' ariaRole='status'><View className='fl-loading-line' /><Text className='fl-idle-title'>正在整理航班样例</Text><Text className='fl-subtitle'>把总价、用时与中转放在一起。</Text><Button className='ux-text-button' onClick={cancelSearch}>取消搜索</Button></View> : null}
      {status === 'error' ? <EmptyState title='搜索暂时没能完成' description='你正在查看模拟失败状态。搜索条件已保留，可以重试。' icon='plane' actionLabel='重试搜索' onAction={() => beginSearch(false, search)} /> : null}
      {status === 'ready' ? <>
        <View className='fl-result-heading'><SectionHeading title='出发，有几种可能' caption={`${search.date} · ${search.travelers} 位成人 · 单程`} /><Text className='fl-count'>{results.length} 个样例</Text></View>
        {supported ? <>
          <View className='fl-toolbar'>
            <View className='fl-sort-options'>{([{ id: 'recommended', label: '均衡' }, { id: 'price', label: '低价' }, { id: 'duration', label: '省时' }] as const).map(option => <Button key={option.id} className={`fl-sort ${sort === option.id ? 'is-active' : ''}`} ariaLabel={`按${option.label}排序`} onClick={() => setSort(option.id)}>{option.label}</Button>)}</View>
            <Button className={`fl-filter-button ${filterCount ? 'is-active' : ''}`} onClick={() => { setDraftFilters(filters); setSheet('filter') }}>筛选{filterCount ? ` · ${filterCount}` : ''}<Icon name='chevron-right' /></Button>
          </View>
          {filterCount ? <View className='fl-applied-filters'><Text>{[filters.price ? `¥${money(filters.price)} 以内` : '', filters.oneStop ? '最多 1 次中转' : '', filters.protectedOnly ? '排除自行中转' : ''].filter(Boolean).join(' · ')}</Text><Button onClick={() => setFilters(DEFAULT_FILTERS)}>清除</Button></View> : null}
          {results.length ? <View className='fl-results'>{results.map(flight => <View className='fl-flight-card' key={flight.id}>
            <View className='fl-card-top'><View className={`fl-carrier-mark fl-carrier-${flight.id}`}>{flight.monogram}</View><Text className='fl-airline-name'>{flight.airline}</Text><Text className={`fl-badge ${flight.selfTransfer ? 'fl-badge-warm' : ''}`}>{flight.badge}</Text></View>
            <View className='fl-times'><View><Text className='fl-time'>{flight.departure || '待核验'}</Text><Text className='fl-airport-name'>{originLabel} {searchDataset.origin}</Text></View><View className='fl-time-bridge'><Text>{duration(flight.minutes)}</Text><View className='fl-route-line'><View /><Icon name='plane' /></View><Text>{stopsLabel(flight.stops)}</Text></View><View className='fl-arrival'><View className='fl-arrival-time'><Text className='fl-time'>{flight.arrival || '待核验'}</Text>{flight.nextDay ? <Text className='fl-plus-day'>+1</Text> : null}</View><Text className='fl-airport-name'>{destinationLabel} {searchDataset.destination}</Text></View></View>
            <View className='fl-flight-meta'><Text>{flight.via ? `经 ${flight.via}` : stopsLabel(flight.stops)}</Text><Text>{flight.selfTransfer === true ? '自行中转 · 行李需再托运' : flight.selfTransfer === null ? '中转方式待核验' : '行李与联程保障待核验'}</Text></View>
            <View className='fl-card-bottom'><View><Text className='fl-fare'>{knownAmount(flight.price) ? <Text className='fl-currency'>¥</Text> : null}{money(flight.price)}<Text className='fl-per'> / 人</Text></Text><Text className='fl-small'>示例含税总价 · 非实时报价</Text></View><Button className='fl-detail-button' onClick={() => setDetail(flight)}>航班详情<Icon name='chevron-right' /></Button></View>
            <View className='fl-compare-row'><Button className={`fl-compare-choice ${compared.includes(flight.id) ? 'is-active' : ''}`} ariaLabel={`${compared.includes(flight.id) ? '移除比较' : '加入比较'}${flight.airline}`} onClick={() => toggleCompare(flight.id)}><View className='fl-check-box'>{compared.includes(flight.id) ? <Icon name='check' /> : null}</View>{compared.includes(flight.id) ? '已加入比较' : '加入比较'}</Button><Text className='fl-small'>当地时刻{flight.nextDay ? ' · +1 为次日到达' : ''}</Text></View>
          </View>)}</View> : <EmptyState title={searchDataset.flights.length ? '没有符合筛选的航班' : '暂时没有航班结果'} description={searchDataset.flights.length ? `试着放宽价格或中转条件，重新看看这 ${searchDataset.flights.length} 个样例。未知价格不会当作低价。` : '当前数据集没有航班，票价和航段不会自动补造。'} actionLabel={filterCount ? '清除筛选' : undefined} onAction={() => setFilters(DEFAULT_FILTERS)} />}
          <View className='fl-alert-card'><View><Text className='fl-alert-title'>{hasKnownQuote ? '等一个更合适的价格' : '先记下你的目标价'}</Text><Text className='fl-small'>设定心理价位，保存到本地提醒列表。</Text></View><Button className='fl-outline-button' onClick={() => openAlert()}>设提醒</Button></View>
        </> : <EmptyState title='这条路线还没有演示数据' description={`当前注入数据为 ${searchDataset.date} ${originLabel} 至 ${destinationLabel}。其他查询条件尚无对应数据。`} icon='plane' actionLabel='使用当前数据条件' onAction={() => { setFilters(DEFAULT_FILTERS); beginSearch(false, initialFlightSearch(searchDataset)) }} />}
        <DemoNote text={datasetNote} />
        <Button className='fl-demo-error' onClick={() => beginSearch(true, search)}>体验搜索失败与重试</Button>
      </> : null}
    </View>

    {status === 'ready' && compared.length > 0 ? <View className='fl-compare-dock'><View><Text className='fl-dock-title'>已选 {compared.length} / 2 个航班</Text><Button className='fl-clear-compare' onClick={() => setCompared([])}>清空选择</Button></View><Button className='ux-primary' disabled={compared.length < 2} onClick={() => setSheet('compare')}>{compared.length < 2 ? '再选一个比较' : '开始比较'}</Button></View> : null}
    {detail ? <Sheet title='航班详情' onClose={() => setDetail(null)}>
      <View className='fl-detail-intro'><Text className='fl-detail-title'>{originLabel} → {destinationLabel}</Text><Text className='fl-subtitle'>{search.date} · {duration(detail.minutes)} · {stopsLabel(detail.stops)}</Text><Text className='fl-detail-price'>{knownAmount(detail.price) ? '¥' : ''}{money(detail.price)}<Text> / 人 · 示例含税总价</Text></Text><Text className='fl-small'>{knownAmount(detail.price) ? `${search.travelers} 位成人合计约 ¥${money(detail.price * search.travelers)}，未核验余位。` : '每人及多人总价均待核验。'}</Text></View>
      <Text className='fl-section-label'>航段 · 均为当地时刻</Text>
      {detail.legs.map((leg, index) => <View key={`${detail.id}-${index}`}>
        <View className='fl-leg'><View className='fl-leg-stop'><Text className='fl-leg-time'>{leg.depart || '待核验'}</Text><View className='fl-leg-dot' /><Text>{leg.from}</Text></View><View className='fl-leg-caption'><Text>{leg.carrier}</Text><Text>{leg.duration ? `飞行 ${leg.duration}` : '飞行用时待核验'} · 示例</Text></View><View className='fl-leg-stop'><Text className='fl-leg-time'>{leg.arrive || '待核验'}{leg.nextDay ? <Text className='fl-leg-nextday'>+1</Text> : null}</Text><View className='fl-leg-dot' /><Text>{leg.to}</Text></View></View>
        {leg.transfer ? <View className={`fl-transfer ${leg.transfer.includes('自行') ? 'fl-transfer-caution' : ''}`}><Icon name='info' /><Text>{leg.transfer}</Text></View> : null}
      </View>)}
      {!detail.legs.length ? <Text className='fl-small'>尚无可展示航段，等待完整信息。</Text> : null}
      {detail.selfTransfer ? <View className='fl-warning'>分开出票样例：需提取行李并重新托运。入境资格、航站楼转换及错过后续航班的保障均未核验。</View> : <View className='fl-info-panel'>{detail.stops === 0 ? '直飞样例的承运班次、行李额度与退改规则仍需核验。' : '中转机场、行李直挂和联程保障需要向出票方核验。当前样例不构成可行中转承诺。'}</View>}
      <View className='fl-fare-rules'><Text className='fl-section-label'>购票前还需要确认</Text>{['托运行李额度', '退改签费用', '税费拆分与余位'].map(label => <View key={label}><Text>{label}</Text><Text>待核验</Text></View>)}</View>
      <DemoNote text={detail.sourceNote || datasetNote} />
      <Button className='ux-primary fl-sheet-primary' onClick={() => openAlert(detail.price)}>为这条航线设价格提醒</Button>
      <Button className='fl-trip-link' onClick={() => { setDetail(null); onOpenTrip() }}>{searchDataset.tripLinkLabel || '看看相关行程样例'}<Icon name='arrow-right' /></Button>
    </Sheet> : null}
    {sheet === 'filter' ? <Sheet title='找到更适合的航班' onClose={() => setSheet(null)}>
      <Text className='fl-section-label'>每人含税示例价格</Text><View className='fl-filter-chips'>{[0, 5000, 6000].map(price => <Button key={price} className={`fl-chip ${draftFilters.price === price ? 'is-active' : ''}`} onClick={() => setDraftFilters({ ...draftFilters, price })}>{price ? `¥${money(price)} 内` : '不限价格'}</Button>)}</View>
      <Text className='fl-section-label'>中转次数</Text><View className='fl-filter-chips'>{[false, true].map(oneStop => <Button key={String(oneStop)} className={`fl-chip ${draftFilters.oneStop === oneStop ? 'is-active' : ''}`} onClick={() => setDraftFilters({ ...draftFilters, oneStop })}>{oneStop ? '最多 1 次' : '不限次数'}</Button>)}</View>
      <Button className='fl-filter-toggle' onClick={() => setDraftFilters({ ...draftFilters, protectedOnly: !draftFilters.protectedOnly })}><View><Text className='fl-section-label'>排除自行中转</Text><Text className='fl-small'>减少提取行李、重新值机的安排</Text></View><View className={`fl-toggle ${draftFilters.protectedOnly ? 'is-active' : ''}`}><View /></View></Button>
      <View className='fl-filter-actions'><Button className='ux-secondary' onClick={() => setDraftFilters(DEFAULT_FILTERS)}>重置</Button><Button className='ux-primary' onClick={() => { setFilters(draftFilters); setSheet(null) }}>查看结果</Button></View>
    </Sheet> : null}
    {sheet === 'compare' ? <Sheet title='把两种出发放在一起' onClose={() => setSheet(null)}>
      <Text className='fl-subtitle'>相同路线与日期 · 每人单程经济舱 · 固定样例</Text>
      <View className='fl-compare-grid'>
        <View className='fl-compare-table-row fl-compare-table-head'><Text>航班</Text>{compareFlights.map(flight => <View key={flight.id}><Text className='fl-compare-airline'>{flight.airline}</Text><Text className='fl-small'>{flight.monogram}</Text></View>)}</View>
        {[
          { label: '价格', render: (flight: Flight) => knownAmount(flight.price) ? `¥${money(flight.price)}` : '待核验' },
          { label: '总用时', render: (flight: Flight) => duration(flight.minutes) },
          { label: '出发', render: (flight: Flight) => flight.departure || '待核验' },
          { label: '到达', render: (flight: Flight) => `${flight.arrival || '待核验'}${flight.nextDay ? ' 次日' : ''}` },
          { label: '中转', render: (flight: Flight) => `${stopsLabel(flight.stops)}${flight.via ? ` · ${flight.via}` : ''}` },
          { label: '自行中转', render: (flight: Flight) => flight.selfTransfer === true ? '有 · 需再次托运' : flight.selfTransfer === false ? '数据未包含' : '待核验' },
          { label: '行李/退改', render: () => '待核验' }
        ].map(row => <View className='fl-compare-table-row' key={row.label}><Text>{row.label}</Text>{compareFlights.map(flight => <Text key={flight.id}>{row.render(flight)}</Text>)}</View>)}
        <View className='fl-compare-table-row fl-compare-table-actions'><Text>更多</Text>{compareFlights.map(flight => <Button key={flight.id} onClick={() => { setSheet(null); setDetail(flight) }}>看详情<Icon name='chevron-right' /></Button>)}</View>
      </View>
      <DemoNote text='价格低不代表总成本更低。自行中转、额外行李与退改费用需要在购票前核实。此处不提供购票。' />
      <Button className='ux-secondary fl-sheet-primary' onClick={() => setSheet(null)}>返回航班列表</Button>
    </Sheet> : null}
    {sheet === 'alert' ? <Sheet title='等一个心动的价格' onClose={() => setSheet(null)}>
      <View className='fl-alert-route'><Icon name='plane' /><View><Text className='fl-alert-title'>{search.from} → {search.to}</Text><Text className='fl-subtitle'>{search.date} · 单程经济舱 · 每人含税价</Text></View></View>
      <Text className='fl-section-label'>我的目标价格</Text><View className='fl-target-input'><Text>¥</Text><Input type='number' ariaLabel='目标价格，人民币元' value={targetPrice} maxlength={6} onInput={event => { setTargetPrice(event.detail.value); setAlertError('') }} /><Text>以下</Text></View>
      {alertError ? <View className='fl-form-error' ariaRole='alert'>{alertError}</View> : null}
      <View className='fl-info-panel'>{!hasKnownQuote ? '当前没有已知报价，请自行填写目标价格。' : ''}保存后可在「我的 → 价格提醒」查看和删除。本次只保存本地演示记录，尚未连接价格查询或通知服务。</View>
      <Button className='ux-primary fl-sheet-primary' onClick={saveAlert}>保存本地提醒</Button>
    </Sheet> : null}
  </>
}
